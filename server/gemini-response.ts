import { BlockedReason, FinishReason, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { randomUUID } from 'node:crypto';
import type { ResolvedAIConfig } from './ai-config.js';
import type { ProviderToolCall } from '../shared/contracts.js';

export const GEMINI_PROBE_OUTPUT_TOKENS = 2048;
export type GeminiErrorCode = 'invalid_credentials'|'access_denied'|'model_unavailable'|'quota'|'blocked'|'token_exhausted'|'timeout'|'cancelled'|'no_candidates'|'empty_response'|'unexpected_tool_response'|'invalid_tool_response'|'configuration'|'unavailable';
export class GeminiError extends Error {
  constructor(public code: GeminiErrorCode, message: string, public diagnostics?: GeminiMetadata) { super(message); }
}

/** Allowlisted response metadata only: never prompts, generated text, parts, headers or keys. */
export function geminiMetadata(response: GenerateContentResponse, httpStatus?: number) {
  const token = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  const finish = (value: unknown) => Object.values(FinishReason).includes(value as FinishReason) ? String(value) : 'UNKNOWN';
  const block = response.promptFeedback?.blockReason;
  return {
    httpStatus: httpStatus ?? response.sdkHttpResponse?.responseInternal?.status,
    modelVersion: /^gemini-[a-z0-9_.:-]{1,100}$/i.test(response.modelVersion || '') ? response.modelVersion : undefined,
    candidateCount: response.candidates?.length || 0,
    candidates: (response.candidates || []).map(candidate => ({
      finishReason: finish(candidate.finishReason),
      partTypes: (candidate.content?.parts || []).flatMap(part => {
        const types: string[] = [];
        if (typeof part.text === 'string') types.push(part.thought ? 'thoughtText' : 'text');
        for (const name of ['functionCall', 'functionResponse', 'inlineData', 'fileData', 'executableCode', 'codeExecutionResult', 'thoughtSignature'] as const) if (part[name] !== undefined) types.push(name);
        return types;
      }),
    })),
    promptFeedback: response.promptFeedback ? { blockReason: Object.values(BlockedReason).includes(block as BlockedReason) ? block : undefined } : undefined,
    usageMetadata: response.usageMetadata ? {
      promptTokenCount: token(response.usageMetadata.promptTokenCount),
      candidatesTokenCount: token(response.usageMetadata.candidatesTokenCount),
      thoughtsTokenCount: token(response.usageMetadata.thoughtsTokenCount),
      totalTokenCount: token(response.usageMetadata.totalTokenCount),
      cachedContentTokenCount: token(response.usageMetadata.cachedContentTokenCount),
      toolUsePromptTokenCount: token(response.usageMetadata.toolUsePromptTokenCount),
    } : undefined,
  };
}
export type GeminiMetadata = ReturnType<typeof geminiMetadata>;

/** The SDK text getter concatenates non-thought text in the first candidate.
 * Inspect the same parts explicitly so tool-only responses do not log getter warnings. */
export function readGeminiResponse(response: GenerateContentResponse, diagnostics = geminiMetadata(response), probe = false) {
  const first = response.candidates?.[0];
  const blockedReasons = ['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY','IMAGE_PROHIBITED_CONTENT'];
  if ((response.promptFeedback?.blockReason && response.promptFeedback.blockReason !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) || blockedReasons.includes(first?.finishReason || '')) throw new GeminiError('blocked','Gemini blocked this request or response under its content policy. Rephrase the request and review the safety reason; changing credentials will not resolve this block.',diagnostics);
  if (!first) throw new GeminiError('no_candidates','Gemini returned no response candidates and no reported safety block. Retry the simple text test later; check the model service status if it persists.',diagnostics);
  const parts = first.content?.parts || [];
  const text = parts.filter(part => typeof part.text === 'string' && part.thought !== true).map(part => part.text).join('').trim();
  const calls: ProviderToolCall[] = parts.filter(part => part.functionCall).map(part => {
    const call = part.functionCall!;
    if (!call.name?.trim() || (call.args !== undefined && (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)))) throw new GeminiError('invalid_tool_response','Gemini returned malformed function-call arguments. No tool was executed. Narrow the request and retry.',diagnostics);
    return { id: call.id || `gemini-call-${randomUUID()}`, name: call.name, arguments: JSON.stringify(call.args || {}), ...(part.thoughtSignature ? { geminiThoughtSignature: part.thoughtSignature } : {}) };
  });
  if (probe && calls.length) throw new GeminiError('unexpected_tool_response','Gemini returned a function call during a text-only connection probe. No tool was executed; a nonempty text response is required to verify the connection.',diagnostics);
  if (['MALFORMED_FUNCTION_CALL','UNEXPECTED_TOOL_CALL'].includes(first.finishReason || '')) throw new GeminiError('invalid_tool_response','Gemini could not produce a valid function call. No tool was executed. Narrow the request and retry.',diagnostics);
  // A valid normal-chat tool call goes through Assistant's schema/permission checks,
  // even when there is no text. Opaque thought signatures stay in memory for continuation.
  if (calls.length && !probe) return { text, calls, diagnostics };
  if (first.finishReason === FinishReason.MAX_TOKENS) throw new GeminiError('token_exhausted','Gemini exhausted the output budget before completing its response (MAX_TOKENS). Thinking tokens can consume this budget. The connection probe now allows 2048 tokens; retry once with the updated code, or narrow a long chat request.',diagnostics);
  if (!text) throw new GeminiError('empty_response','Gemini returned no nonempty visible text, no usable function call, and no reported safety or token-limit reason. Retry the simple text test later and check the model service status if it persists.',diagnostics);
  return { text, calls, diagnostics };
}

export function geminiRequestError(error: unknown, httpStatus?: number, signal?: AbortSignal): GeminiError {
  if (error instanceof GeminiError) return error;
  const value = error as { status?: number; statusCode?: number; message?: string; name?: string };
  const status = httpStatus || Number(value?.status || value?.statusCode) || undefined;
  // Raw SDK error messages can contain request details. Inspect them only to classify;
  // none of their free text, URLs, headers or bodies are returned or logged.
  const detail = String(value?.message || '').toLowerCase();
  const diagnostics: GeminiMetadata = { httpStatus: status, candidateCount: 0, candidates: [], modelVersion: undefined, promptFeedback: undefined, usageMetadata: undefined };
  if (signal?.aborted || /timeout|timed out/.test(detail) || value?.name === 'TimeoutError') return new GeminiError(signal?.aborted && signal.reason?.name !== 'TimeoutError' ? 'cancelled' : 'timeout', signal?.aborted && signal.reason?.name !== 'TimeoutError' ? 'Gemini request cancelled.' : 'Gemini request timed out. Check connectivity and the model service, then retry once.', diagnostics);
  if (status === 429 || /resource_exhausted|quota|rate.?limit/.test(detail)) return new GeminiError('quota','Gemini quota or rate limit reached. Automatic quota retries, paid fallback and cross-provider fallback are disabled. Check AI Studio quota and wait before testing again.',diagnostics);
  if (status === 401 || /api_key_invalid|api key not valid|invalid api.?key|expired api.?key/.test(detail)) return new GeminiError('invalid_credentials','Gemini rejected the API credential. Check the saved key validity and its restrictions in AI Studio; do not put it in chat.',diagnostics);
  if (status === 403) return new GeminiError('access_denied','Gemini denied API access. Check project/API permissions, key restrictions and regional eligibility in AI Studio.',diagnostics);
  if (status === 408 || status === 504) return new GeminiError('timeout','Gemini service timed out. Retry later; changing the credential or model is not required by this response.',diagnostics);
  if (status && status >= 500) return new GeminiError('unavailable','Gemini service is temporarily unavailable. Wait and retry later. This server error does not indicate an invalid credential or unavailable model; no fallback was used.',diagnostics);
  if (status === 404 || /model.*(?:not found|not supported|unavailable)|not_found/.test(detail)) return new GeminiError('model_unavailable','Gemini could not access the selected model or generateContent endpoint. Check the exact model availability for this project and the configured Gemini base URL.',diagnostics);
  if (status === 400) return new GeminiError('configuration','Gemini rejected the request configuration. Check model/API compatibility and supported generation settings. No provider was switched.',diagnostics);
  return new GeminiError('unavailable','Gemini service request failed. Check connectivity/service availability and retry later. No paid or cross-provider fallback was used.',diagnostics);
}

export async function requestGemini(resolved: ResolvedAIConfig, parameters: Omit<GenerateContentParameters,'model'>, { signal: cancellation, transport = fetch, timeoutMs = 30000 }: { signal?: AbortSignal; transport?: typeof fetch; timeoutMs?: number } = {}) {
  const signal = cancellation ? AbortSignal.any([cancellation,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let httpStatus: number | undefined;
  const client = new GoogleGenAI({ apiKey: resolved.apiKey, httpOptions: {
    baseUrl: resolved.baseUrl, timeout: timeoutMs, retryOptions: { attempts: 1 },
    fetch: async (url,init) => { const response = await transport(url,{...init,signal});httpStatus=response.status;return response; },
  } });
  try {
    signal.throwIfAborted();
    const response = await client.models.generateContent({ ...parameters, model: resolved.model, config: { ...parameters.config, abortSignal: signal } });
    signal.throwIfAborted();
    return { response, diagnostics: geminiMetadata(response,httpStatus) };
  } catch(error) { throw geminiRequestError(error,httpStatus,signal); }
}
