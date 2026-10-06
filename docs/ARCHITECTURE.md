# Architecture and execution boundaries

## Modular monolith

The browser speaks to one authenticated Fastify API. The Windows companion is a separate outbound client because desktop capabilities belong on the target computer. No broker, vector database, container platform, or unrelated service is required.

| Interface | Implementation | Location |
|---|---|---|
| `ModelProvider` | Explicitly selected Google Gemini `@google/genai`, local Ollama, retained OpenAI Responses metadata, or an owner-enabled free OpenAI-compatible gateway; provider-neutral turns/tools and configurable model | `shared/contracts.ts`, `server/provider.ts`, `server/gateway.ts`, `server/ai-config.ts` |
| `SpeechProvider` | Capability-checked Web Speech recognition/synthesis | `src/voice.ts` |
| Native Windows speech | C# tray/WinMM, local multilingual Faster-Whisper utterance wake/transcription, system English speech and local eSpeak Tamil | `companion/native/`, `companion/background.ts` |
| `Storage` | Prepared SQLite statements; persistent JSON records | `server/store.ts` |
| `Tool` | Zod schema, permission, structured handler and context | `server/assistant.ts` |
| `Skill` | Purpose, inputs, integrations, permissions, tools, outputs, checks, recovery | `server/skills.ts` |
| `DeviceTransport` | Expiring authenticated polling commands | `server/devices.ts` |
| `FileStorage` | UUID-named private files, validation, retention and deletion | `server/files.ts` |
| `DeliveryChannel` | Verified Telegram destination, durable receipt states | `server/telegram.ts` |

## Assistant flow

1. Receive a **completed** text instruction. Interim speech only updates the visible transcript.
2. Persist the user message separately from durable memory.
3. Retrieve at most eight relevant memory entries in the selected context.
4. Offer only permission-enabled structured tools to the model. The tool loop is bounded to eight model turns and side-effect receipts prevent duplicate execution within a task.
5. Validate every tool argument again. Recheck permissions before each new step.
6. Run local read/report tools or prepare a narrowly scoped owner action card. An authorized native voice turn additionally exposes routine Windows action and in-app reminder tools for the exact native target.
7. Persist actual execution events and results. Owner controls authorize device actions, schedules, memory updates, and delivery.
8. Verify external outcomes from the device or Telegram receipt; do not infer delivery from intent.

Documents, memory text, model output, and tool responses are untrusted. They have no credential or permission authority. No unrestricted shell tool or model-controlled Telegram recipient is exposed. Private reasoning is not persisted or displayed.

## Native Windows voice

The current-user sign-in entry starts a single supervisor and tray. The tray owns the microphone/audio ring, local multilingual utterance wake detector, command capture, local transcription worker, output and bounded follow-up window. Ambient audio is never submitted to the provider. Initial transcripts require a local Lucifer marker; pre-marker text is trimmed. Native voice endpoints require an existing device bearer credential plus a separately granted `voiceAuthorized` record. Windows action tools validate routine schemas/capabilities and wait for actual command results; timeout/cancellation does not imply completion. Language preference and existing history reach the selected model.

The Windows Node worker uses the existing device poll/result transport, DPAPI credential, local folder/app policy and durable no-replay outcomes. Native destructive/shell/delivery/purchase/access-expansion requests retain the owner boundary. A local owner-confirmed folder picker can expand scopes; the model cannot. The tray has same-user pipe controls and registered global shortcuts. Startup/tray mutexes and exclusive worker/model locks prevent duplicate stacks; stdin closure aborts requests and stops workers. The supervisor recovers a crashed tray; the tray starts/checks the production WSL backend using project-local flock/PID helpers, without Vite or a visible terminal. Real duplicate/crash/backend/hotkey checks passed; reboot, sleep and physical speech checks are separate. See [WINDOWS-VOICE.md](WINDOWS-VOICE.md).

## Tasks and recovery

Task states implement queued, running, awaiting input, awaiting authorization, completed, partially completed, failed, and cancelled. Independent report rendering and Telegram delivery have separate tasks and receipts, so a delivery failure keeps the PDF.

Cancellation aborts model/PDF work and prevents new steps. Device cancellation is transmitted during polling and terminates an approved command process tree where possible. A launched app or a message already accepted externally cannot be undone by cancelling. Outcomes arriving after cancellation are retained as events.

On backend startup, previously active tasks are marked partial and pending/claimed device commands are failed rather than replayed. Delivery states that were `sending` become `uncertain`. Schedules survive restart. In-app occurrence insertion and reminder advancement are transactional; external Telegram sends use a durable key/receipt ledger and do not automatically retry an uncertain outcome.

OpenAI/Ollama retries are bounded to three attempts for selected explicit HTTP 429/500/502/503 and temporary-unavailability errors. Gemini requests are single-attempt: the SDK's default retries are disabled, and quota errors do not trigger automatic retries. Gemini connection probes use a 2048-token text-only budget, model-default thinking settings, and a 30-second timeout. Sanitized metadata distinguishes output exhaustion, blocking, unavailable models, credentials, quotas, timeouts and empty responses. Gemini tool-call signatures stay in memory for authorized continuation. Fallback is off by default and, when explicitly enabled, switches once to a separately configured permitted route while retaining completed receipts; it never claims unlimited usage. Device actions and uncertain Telegram sends are not automatically retried. Result uploads can be retried without executing the device command again.

## Security

- Single owner created through the local hidden-password CLI; salted scrypt hash.
- Random session cookies stored as hashes, HttpOnly, SameSite Strict, seven-day expiry; Secure when served remotely.
- Origin and explicit request-header checks on state-changing browser requests; authentication is based on the matched API route.
- Request rate limits and bounded body/upload/model/tool/output sizes.
- Server-side `.env` integration secrets; Windows DPAPI-encrypted device credentials; revocable hashed backend device credentials.
- Runtime AI credentials entered by the owner are AES-GCM encrypted under the ignored local vault files and never returned by status endpoints. The environment key path remains supported for an already protected server configuration; no credential is copied from another project.
- Pairing challenges are random, five-minute, single-use tokens.
- Laptop paths require approved aliases, validated relative paths, canonical boundaries, and no symlink/junction components. New files do not overwrite.
- Owner-written development commands use fixed executable/argument arrays with no shell and explicit local approval.
- Known credential patterns are redacted from activity and outputs; labelled credentials are rejected in memory/chat. Do not use conversation storage for secrets.
- PDF HTML is escaped; fonts/images are embedded, and browser network requests are blocked during report rendering.
- Authenticated files remain server-side; the PWA offline page never caches private API responses.

The application is intended for a controlled personal server. It does not provide multi-user tenancy, hardware-backed passkeys, encrypted-at-rest conversation databases, robust defense against a malicious same-user filesystem race, or arbitrary OS automation.
