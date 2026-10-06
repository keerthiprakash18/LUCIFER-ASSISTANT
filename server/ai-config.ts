import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from './store.js';
import { config } from './config.js';
import { GeminiError, type GeminiMetadata } from './gemini-response.js';

export const providers = ['openai', 'gemini', 'ollama', 'freellmapi'] as const;
export type ProviderName = typeof providers[number];
export const protocols = ['responses', 'gemini_generate_content', 'ollama_chat', 'chat_completions'] as const;
export type ProtocolName = typeof protocols[number];
const url = z.string().trim().url().max(500).refine(value => { const parsed = new URL(value); return !parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))); }, 'Use HTTPS, or HTTP for localhost, without URL credentials or query strings');
export const aiConfigInputSchema = z.object({
  provider: z.enum(providers), protocol: z.enum(protocols), model: z.string().trim().min(1).max(120), baseUrl: url,
  apiKey: z.string().trim().max(500).refine(value => !value || !/\s/.test(value), 'API keys cannot contain whitespace'),
  windowsBridge:z.boolean().optional(),freeRouteAllowed:z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const expected = value.provider === 'openai' ? 'responses' : value.provider === 'gemini' ? 'gemini_generate_content' : value.provider==='freellmapi'?'chat_completions':'ollama_chat';
  if (value.protocol !== expected) ctx.addIssue({ code: 'custom', path: ['protocol'], message: `${value.provider} requires ${expected}` });
  if (value.provider !== 'ollama' && !value.apiKey) { /* An existing vault or environment key may be retained. */ }
  if (value.provider === 'ollama' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value.baseUrl).hostname)) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'This local Ollama adapter only accepts a localhost base URL; paid/cloud fallback is disabled.' });
  if(value.windowsBridge&&!['localhost','127.0.0.1','[::1]'].includes(new URL(value.baseUrl).hostname))ctx.addIssue({code:'custom',path:['baseUrl'],message:'The Windows gateway bridge accepts loopback only'});
  if(value.provider==='freellmapi'&&!value.freeRouteAllowed)ctx.addIssue({code:'custom',path:['freeRouteAllowed'],message:'Explicitly enable only a free model route in the selected gateway first'});
});
export type AIConfigInput = z.infer<typeof aiConfigInputSchema>;
export type AIStatus = { provider: string; protocol: string; supported: boolean; configured: boolean; verified: boolean; status: 'awaiting_configuration'|'configured_unverified'|'connected'|'connection_failed'|'disconnected'|'unsupported'; model: string; baseUrl: string; credentialSource: 'runtime_vault'|'environment'|'none'; testedAt?: string; lastError?: string; quotaNote?: string; lastErrorCode?: string; lastDiagnostics?: GeminiMetadata;windowsBridge?:boolean;freeRouteAllowed?:boolean;runtimeFault?:{message:string;code?:string;at:string;httpStatus?:number} };
export type ResolvedAIConfig = { provider: ProviderName; protocol: ProtocolName; model: string; baseUrl: string; apiKey?: string; source: 'runtime_vault'|'environment'|'none';windowsBridge?:boolean;freeRouteAllowed?:boolean };

class LocalCredentialVault {
  private keyPath: string; private dataPath: string;
  constructor(directory: string) { this.keyPath = path.join(directory, 'ai-credentials.key'); this.dataPath = path.join(directory, 'ai-credentials.enc'); }
  private async key() { await mkdir(path.dirname(this.keyPath), { recursive: true, mode: 0o700 }); try { return await readFile(this.keyPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const value = randomBytes(32); await writeFile(this.keyPath, value, { flag: 'wx', mode: 0o600 }); await chmod(this.keyPath, 0o600).catch(() => {}); return value; } }
  private async load(): Promise<{ credentials: Partial<Record<ProviderName, string>> }> { try { const encoded = await readFile(this.dataPath, 'utf8'); const [ivText, tagText, encryptedText] = encoded.split(':'); if (!ivText || !tagText || !encryptedText) throw new Error('AI credential vault format is invalid'); const decipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(ivText, 'base64url')); decipher.setAuthTag(Buffer.from(tagText, 'base64url')); const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8')) as { provider?: ProviderName; apiKey?: string; credentials?: Partial<Record<ProviderName, string>> }; if (value.credentials) return { credentials: value.credentials }; if (value.apiKey) return { credentials: value.provider ? { [value.provider]: value.apiKey } : { openai: value.apiKey } }; return { credentials: {} }; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { credentials: {} }; throw new Error('Stored AI credential could not be opened. Re-enter it in the owner setup flow.'); } }
  private async save(credentials: Partial<Record<ProviderName, string>>) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', await this.key(), iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify({ credentials }), 'utf8'), cipher.final()]); const encoded = `${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`; const temporary = `${this.dataPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`; await writeFile(temporary, encoded, { flag: 'wx', mode: 0o600 }); await chmod(temporary, 0o600).catch(() => {}); await rename(temporary, this.dataPath); }
  async read(provider: ProviderName): Promise<{ provider: ProviderName; apiKey: string }|undefined> { const value = await this.load(); const apiKey = value.credentials[provider]; return apiKey ? { provider, apiKey } : undefined; }
  async write(value: { provider: ProviderName; apiKey: string }) { const current = await this.load(); current.credentials[value.provider] = value.apiKey; await this.save(current.credentials); }
  async clear(provider: ProviderName) { const current = await this.load(); delete current.credentials[provider]; if (Object.keys(current.credentials).length) await this.save(current.credentials); else await unlink(this.dataPath).catch(() => {}); }
}

function defaults(provider: ProviderName) {
  if (provider === 'openai') return { protocol: 'responses' as const, model: config.model, baseUrl: config.baseUrl, envKey: config.apiKey };
  if (provider === 'gemini') return { protocol: 'gemini_generate_content' as const, model: config.geminiModel || 'gemini-flash-latest', baseUrl: 'https://generativelanguage.googleapis.com', envKey: config.geminiApiKey };
  if(provider==='freellmapi')return {protocol:'chat_completions' as const,model:'',baseUrl:'http://127.0.0.1:31415/v1',envKey:''};
  return { protocol: 'ollama_chat' as const, model: config.ollamaModel || 'gemma3:1b', baseUrl: config.ollamaBaseUrl, envKey: '' };
}
const quotaNote = (provider: ProviderName) => provider === 'gemini' ? 'Google AI Studio free-tier quotas vary by model, project, region, and account. Billing and paid routes are off.' : provider === 'ollama' ? 'Local inference uses laptop resources. No model is downloaded automatically.' : provider==='freellmapi'?'Only explicitly enabled free gateway routes are permitted; quotas and tool support depend on the upstream model. No unlimited usage claim.':'Legacy OpenAI Responses configuration is retained; paid production routes are disabled.';

export class AIConfigService {
  private vault: LocalCredentialVault;
  private testing = false;
  constructor(public store: Store, directory: string, private transport: typeof fetch = fetch) { this.vault = new LocalCredentialVault(directory); }
  private record() { return this.store.get<any>('ai_config', 'model'); }
  private async credential(provider: ProviderName) { return this.vault.read(provider); }
  private provider(): ProviderName { const record = this.record(); return (record?.provider || config.provider) as ProviderName; }
  async resolve(target?:ProviderName): Promise<ResolvedAIConfig|undefined> { const selected=this.record();const provider=target||this.provider();const record=!target||target===selected?.provider?selected:this.store.get<any>('ai_profile',provider); if (record?.disconnected) return undefined; if (!providers.includes(provider)) return undefined; const fallback = defaults(provider); const runtime = provider === 'ollama' ? undefined : await this.credential(provider); const apiKey = runtime?.apiKey || fallback.envKey || undefined; const model = record?.model || fallback.model; const baseUrl = record?.baseUrl || fallback.baseUrl; if (!model || (provider !== 'ollama' && !apiKey)) return undefined; return { provider, protocol: record?.protocol || fallback.protocol, model, baseUrl: baseUrl.replace(/\/$/, ''), apiKey, source: runtime?.apiKey ? 'runtime_vault' : apiKey ? 'environment' : 'none',windowsBridge:record?.windowsBridge,freeRouteAllowed:record?.freeRouteAllowed }; }
  routing(){return this.store.get<any>('ai_routing','model')||{id:'model',fallbackEnabled:false,fallback:'gemini',paidRoutes:false};}
  saveRouting(input:unknown){const value=z.object({fallbackEnabled:z.boolean(),fallback:z.enum(['gemini','freellmapi','ollama'])}).strict().parse(input);return this.store.put('ai_routing',{id:'model',...value,paidRoutes:false});}
  profiles(){return providers.map(provider=>{const record=provider===this.record()?.provider?this.record():this.store.get<any>('ai_profile',provider);return record?{provider,protocol:record.protocol,model:record.model,baseUrl:record.baseUrl,windowsBridge:record.windowsBridge,freeRouteAllowed:record.freeRouteAllowed}:undefined;}).filter(Boolean);}
  runtimeFailure(selected:ResolvedAIConfig|undefined,error:unknown){if(!selected)return;const value=error as any;const message=String(value.message||'Model request failed').replaceAll(selected.apiKey||'\0','[REDACTED]');this.store.put('ai_runtime',{id:selected.provider,message,code:value instanceof GeminiError?value.code:undefined,httpStatus:value instanceof GeminiError?value.diagnostics?.httpStatus:value.status,at:new Date().toISOString()});}
  runtimeSuccess(selected:ResolvedAIConfig|undefined){if(selected)this.store.remove('ai_runtime',selected.provider);}
  async status(): Promise<AIStatus> {
    const record = this.record(); const provider = this.provider();
    if (!providers.includes(provider)) return { provider, protocol: 'unknown', supported: false, configured: false, verified: false, status: 'unsupported', model: '', baseUrl: '', credentialSource: 'none' };
    const fallback = defaults(provider); const protocol = record?.protocol || fallback.protocol;
    const supported = (provider === 'openai' && protocol === 'responses') || (provider === 'gemini' && protocol === 'gemini_generate_content') || (provider === 'ollama' && protocol === 'ollama_chat')||(provider==='freellmapi'&&protocol==='chat_completions');
    const metadata={testedAt:record?.testedAt,lastError:record?.lastError,lastErrorCode:record?.lastErrorCode,lastDiagnostics:record?.lastDiagnostics,quotaNote:quotaNote(provider),windowsBridge:!!record?.windowsBridge,freeRouteAllowed:!!record?.freeRouteAllowed,runtimeFault:this.store.get<any>('ai_runtime',provider)};
    if (record?.disconnected) return { provider, protocol, supported, configured: false, verified: false, status: 'disconnected', model: record.model || fallback.model, baseUrl: record.baseUrl || fallback.baseUrl, credentialSource: 'none', ...metadata };
    const runtime = provider === 'ollama' ? undefined : await this.credential(provider); const hasKey = !!runtime?.apiKey || !!fallback.envKey;
    const model = record?.model || fallback.model; const baseUrl = record?.baseUrl || fallback.baseUrl;
    const configured = supported && !!model && (provider === 'ollama' || hasKey); const verified = configured && record?.verified === true;
    return { provider, protocol, supported, configured, verified, status: !supported ? 'unsupported' : !configured ? 'awaiting_configuration' : verified ? 'connected' : record?.lastError ? 'connection_failed' : 'configured_unverified', model, baseUrl, credentialSource: runtime?.apiKey ? 'runtime_vault' : hasKey ? 'environment' : 'none', ...metadata };
  }
  async save(input: unknown) { const value = aiConfigInputSchema.parse(input); const existing = value.provider === 'ollama' ? undefined : await this.credential(value.provider); const fallback = defaults(value.provider); if (value.provider !== 'ollama' && !value.apiKey && !existing?.apiKey && !fallback.envKey) throw new Error(`Enter the ${value.provider} API key in this private LUCIFER setup form.`); if (value.apiKey) await this.vault.write({ provider: value.provider, apiKey: value.apiKey });const previous=this.record();if(previous?.provider)this.store.put('ai_profile',{...previous,id:previous.provider});const record={ id: 'model', provider: value.provider, protocol: value.protocol, model: value.model, baseUrl: value.baseUrl.replace(/\/$/, ''),windowsBridge:value.windowsBridge,freeRouteAllowed:value.freeRouteAllowed, verified: false, testedAt: undefined, lastError: undefined, disconnected: false, updatedAt: new Date().toISOString() };this.store.put('ai_config',record);this.store.put('ai_profile',{...record,id:value.provider}); const settings = this.store.get<any>('settings', 'owner'); if (settings) this.store.put('settings', { ...settings, permissions: { ...settings.permissions, model: true } }); }
  async test(signal?: AbortSignal) {
    if (this.testing) throw Object.assign(new Error('A provider connection test is already running. Wait or cancel it before retrying.'), { statusCode: 409 });
    this.testing = true;
    try {
      const resolved = await this.resolve();
      if (!resolved) throw new Error('AI is not configured. Open Settings → AI provider; local features remain available without credentials.');
      const original = JSON.stringify(this.record());
      try {
        const { testProvider } = await import('./provider.js');
        const result = await testProvider(resolved, this.transport, signal);
        signal?.throwIfAborted();
        if (JSON.stringify(this.record()) !== original) throw new Error('Provider configuration changed during the test. Test the current selection again.');
        const testedAt = new Date().toISOString();
        const diagnostics='diagnostics' in result?result.diagnostics:undefined;
        this.store.put('ai_config', { ...this.record(), id: 'model', provider: resolved.provider, protocol: resolved.protocol, model: resolved.model, baseUrl: resolved.baseUrl, verified: true, testedAt, lastError: undefined, lastErrorCode:undefined,lastDiagnostics:diagnostics,lastResponseFingerprint: createHash('sha256').update(result.text).digest('hex').slice(0, 12) });
        return { verified: true, provider: resolved.provider, model: resolved.model, testedAt,diagnostics };
      } catch (error) {
        const raw = String((error as { message?: unknown })?.message || error);
        const message = resolved.apiKey ? raw.replaceAll(resolved.apiKey, '[REDACTED]') : raw;
        if (!signal?.aborted && JSON.stringify(this.record()) === original) this.store.put('ai_config', { ...this.record(), id: 'model', verified: false, lastError: message, lastErrorCode:error instanceof GeminiError?error.code:undefined,lastDiagnostics:error instanceof GeminiError?error.diagnostics:undefined,testedAt: new Date().toISOString() });
        throw new Error(message);
      }
    } finally { this.testing = false; }
  }
  async disconnect() { const provider = this.provider(); await this.vault.clear(provider); const fallback = defaults(provider); this.store.put('ai_config', { ...(this.record() || {}), id: 'model', provider, protocol: fallback.protocol, model: fallback.model, baseUrl: fallback.baseUrl, disconnected: true, verified: false, lastError: undefined, testedAt: undefined }); const settings = this.store.get<any>('settings', 'owner'); if (settings) this.store.put('settings', { ...settings, permissions: { ...settings.permissions, model: false } }); }
}
