# Official documentation consulted

Consulted during implementation on 2026-10-06. Dependency versions were checked against the npm registry and pinned through `package-lock.json`; no API price or guaranteed free allowance was guessed.

- Vite current getting started and Node compatibility: https://vite.dev/guide/
- Fastify supported major/LTS policy: https://fastify.dev/docs/latest/Reference/LTS/
- Node SQLite API and runtime stability: https://nodejs.org/api/sqlite.html
- OpenAI Responses creation, tool calls, `store:false`, function outputs and web-search citations: https://platform.openai.com/docs/api-reference/responses/create
- Google official JavaScript SDK, current `GoogleGenAI`/`generateContent` examples and model alias: https://github.com/googleapis/js-genai and the installed `@google/genai` README
- Google Gemini Developer API quickstart, models, pricing, rate limits, API keys and function calling: https://ai.google.dev/gemini-api/docs/quickstart, https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/rate-limits, https://ai.google.dev/gemini-api/docs/api-key, https://ai.google.dev/gemini-api/docs/function-calling
- Google AI Studio API-key entry point: https://aistudio.google.com/apikey
- Ollama official JavaScript client and local API: https://github.com/ollama/ollama-js and https://docs.ollama.com/api
- Ollama official Gemma 3 model sizes/tags: https://ollama.com/library/gemma3
- Browser recognition capability/permissions, partial/final transcripts, stop/abort and network dependence: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- Chromium PDF printing: https://playwright.dev/docs/api/class-page#page-pdf
- Telegram HTTPS API, `getMe`, `getUpdates`, `getWebhookInfo`, `sendMessage`, `sendDocument`, confirmation objects: https://core.telegram.org/bots/api
- Telegram bot creation/deep-link verification: https://core.telegram.org/bots/features#botfather
- Windows DPAPI CurrentUser protection: https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=windowsdesktop-9.0
- Windows offline speech recognition and grammar APIs: https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine and https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.grammarbuilder
- Faster-Whisper CPU int8/local model implementation: https://github.com/SYSTRAN/faster-whisper
- Pinned multilingual small model: https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120
- Official eSpeak-NG 1.52.0 release: https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0. The release's `src/libespeak-ng/speech.c` was inspected to fix project-local Windows data lookup using `ESPEAK_DATA_PATH`, without system installation/registry changes.
- PyAV 15.1.0 official wheel metadata (Windows CPython 3.13 supported): https://pypi.org/pypi/av/15.1.0/json. The compatible decoder pin was verified by actual offline transcription; the installed PyAV 19.0.1 rejected Faster-Whisper's `metadata_errors` argument.

The Meta Instagram platform/insights pages attempted during the session returned HTTP 400/404. Current eligibility, OAuth scopes and insights endpoints were therefore **not verified or invented**. The implemented analytics integration is the documented owner-imported CSV path. Direct Instagram API connection is labelled unsupported until its current official eligibility, permissions and endpoint behavior can be verified with a real authorized account.

The Google AI documentation URLs above were attempted during this session but the documentation fetcher returned transport errors. The implementation therefore treats Google’s pricing/free-tier pages as the authority and does not claim a guaranteed free allowance; verify the current model quota in Google AI Studio before use. The installed official SDK README does currently use `gemini-flash-latest` in its `generateContent` examples.

PDF.js 6's installed TypeScript declarations were also checked to use its supported loading-task cleanup and rendering interfaces rather than obsolete options. This release does not embed custom JavaScript from documents or execute uploaded code.
