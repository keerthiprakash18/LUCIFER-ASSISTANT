import { GoogleGenAI } from '@google/genai';
import { Store } from '../server/store.js';
import { AIConfigService } from '../server/ai-config.js';
import { config } from '../server/config.js';
import { geminiMetadata } from '../server/gemini-response.js';

// Reproduce the previous 30-token probe once. Never logs SDK errors, response text or credentials.
const store = new Store(config.dataDir);
try {
  const resolved = await new AIConfigService(store, config.dataDir).resolve();
  if (!resolved || resolved.provider !== 'gemini' || !resolved.apiKey) {
    console.log(JSON.stringify({ liveVerification: 'pending', reason: 'No selected Gemini server credential is available.' }));
  } else {
    let httpStatus: number | undefined;
    const signal = AbortSignal.timeout(30000);
    const client = new GoogleGenAI({ apiKey: resolved.apiKey, httpOptions: {
      baseUrl: resolved.baseUrl, timeout: 30000, retryOptions: { attempts: 1 },
      fetch: async (url, init) => { const response = await fetch(url, { ...init, signal }); httpStatus = response.status; return response; },
    } });
    try {
      const response = await client.models.generateContent({ model: resolved.model, contents: 'Reply with exactly: LUCIFER connection test passed.', config: { systemInstruction: 'This is a connection test. Do not use tools.', maxOutputTokens: 30, abortSignal: signal } });
      console.log(JSON.stringify({ phase: 'original-30-token-probe', ...geminiMetadata(response, httpStatus) }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ phase: 'original-30-token-probe', httpStatus, timedOut: signal.aborted, sdkStatus: Number((error as { status?: number })?.status) || undefined, failed: true }));
      process.exitCode = 1;
    }
  }
} finally { store.close(); }
