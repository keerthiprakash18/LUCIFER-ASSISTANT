# LUCIFER

A working, single-owner personal assistant workspace with a native Windows voice tray and an optional Windows/Android browser dashboard. It combines persistent chat, configurable AI, local Windows wake/transcription/speech, approved laptop actions, controlled memory, imported analytics, general CSV/PDF reports, Telegram delivery, and persistent reminders.

**Current installation:** Windows sign-in startup is enabled and the native tray is running. The production dashboard is **http://localhost:3001**. Real native Notepad, scoped note read/write/search, browser observation, CSV/PDF report creation, reminder cancellation, microphone pause/resume, speech stop, duplicate prevention and crash/backend recovery passed. Gemini's saved connection is verified, while the latest live request is currently reporting HTTP 503; local actions remain available. Physical wake/Tamil/reboot checks remain outstanding; see [Windows voice setup and acceptance](docs/WINDOWS-VOICE.md) and [STATUS.md](STATUS.md).

The native source now includes a movable dark floating LUCIFER panel, local **“Yes boss”** acknowledgement, single-utterance wake+command preservation, observed task-state progress, Talk/Stop/text controls, idle launcher collapse, and a registered **Ctrl+Alt+Space** summon shortcut with a truthful fallback if Windows refuses registration. This source capability is not the same as an installed/physically verified laptop result: rebuild/reinstall the native tray, then perform the physical acceptance in the Windows voice guide.

Everyday voice use requires the tray rather than an open browser or terminal. Right-click it for controls and calibration. **Ctrl+Alt+Esc** stops; the tray shows the active pause/resume shortcut (**Ctrl+Alt+L**, or **Ctrl+Alt+Shift+L** if reserved). Repeatable setup is `& .\scripts\install-native.ps1` from Windows PowerShell in this project; existing model reuse is `-SkipSpeechDownload`. The guide documents the inspected WSL/Windows runtimes and preserved owner data.

The recognizable tray icon is LUCIFER's pink emblem with a status dot. For manual recovery and microphone selection, run `& "C:\Users\micha\Music\LUCIFER-ASSISTANT\.local\native\LUCIFER.exe" --supervise --settings` in Windows PowerShell. An existing instance is reused; its Voice settings/calibration window opens without another worker stack.

## Five useful commands

1. `Open Notepad.`
2. `Create note notes/today.txt: review the launch checklist; then find and read it.`
3. `Open https://example.com and tell me what you see.`
4. Attach a CSV and say `Analyze the attached CSV and create a PDF report.`
5. `Remind me in 30 minutes to review the report.`

Routine reversible operations use owner-approved scopes and return observed results. Overwrites, moves, sending, publishing, purchases, installations, security changes, and access expansion require an exact confirmation. Stop cancels future steps; an already-started operating-system action cannot be undone.

The AI setup supports the existing Gemini configuration, local Ollama, and an explicitly enabled free OpenAI-compatible gateway route through a secure Windows-loopback bridge for WSL. Paid production routes remain disabled. Optional fallback is off until enabled by the owner and configured separately. The current gateway endpoint responds with HTTP 401 until a LUCIFER-authorized gateway key and free model route are entered privately; no credentials are copied from other applications.

## Start on Windows

Use **Windows Node.js 24.14 or newer in the Node 24 line**, and PowerShell. Run all commands in this `LUCIFER-ASSISTANT` folder.

```powershell
npm ci
Copy-Item .env.example .env
npm run browser:install
npm run setup
npm run dev
```

`setup` asks for a hidden owner password of at least 12 characters. Open **http://localhost:5173**, sign in, and type **“What is the time?”**. This invokes the actual system-clock tool without API credentials. Tasks shows the real result and events.

Existing `.env` files must be preserved; only copy the example when `.env` does not exist. `npm ci` installs the versions locked in `package-lock.json`. The browser installer keeps its downloads inside `.local/browsers`. Do not run Windows and WSL dependency installations simultaneously in the same `node_modules` tree.

For the built application:

```powershell
npm run build
npm start
```

Open **http://localhost:3001**. The backend serves the built UI. `npm run doctor` reports configuration readiness without exposing secrets or making external calls.

For development, use **http://localhost:5173**. The Vite dev server uses file polling for this Windows/WSL-mounted checkout and refuses to silently move to a second port. If a long-running instance shows old UI, restart this project's `npm run dev` process and refresh the browser. Opening `Settings → Configure AI provider` or `Skills & integrations → Configure AI provider` does not require credentials or a running model service.

### Ubuntu / WSL

```bash
npm ci
cp .env.example .env
npm run browser:install
npm run browser:linux
npm run setup
npm run dev
```

`browser:linux` downloads and extracts the three missing Chromium libraries observed in this environment **inside this project**, without administrator privileges or system-package installation. It requires Ubuntu's `apt-get` and `dpkg-deb`. Other Linux distributions may need their platform's Chromium dependencies; Windows does not need this helper.

## Architecture

**React 19 + Vite 8 + TypeScript** provides the responsive interface. **Fastify 5** runs one modular backend. SQLite persists conversations, durable memory, settings, tasks, device commands, schedules, notification occurrences, and delivery receipts. Node 24's `node:sqlite` API is still labelled experimental by that runtime; it is isolated behind the `Storage` interface. Chromium prints PDFs; PDF.js extracts text and rasterizes the actual PDF pages with an embedded Tamil font.

The Windows companion polls the backend over authenticated outbound HTTPS (loopback HTTP on this laptop) and has no inbound HTTP listener. The native tray adds local speech and current-user named-pipe controls; it manages the production backend in WSL. Model calls use one explicitly selected provider: the official OpenAI Responses endpoint, the official Google `@google/genai` SDK, or the official Ollama JavaScript client for a local server. Paid and cross-provider fallback are disabled.

```
src/          Responsive workspace, browser speech, API client
shared/       Validated contracts and structured device-action schemas
server/       Authentication, models, tools, tasks, memory, files, reports,
              pairing, Telegram, scheduling, authorization proposals
companion/    Windows action policy, native C# tray/audio, local Whisper,
              background polling client, DPAPI credentials
tests/        Backend/security tests, Chromium journeys, native Windows checks
scripts/      Native Windows setup/build/diagnostics, Chromium helpers
.local/       Ignored local databases, files, browser downloads, test artifacts
```

An AI tool can read attached files, obtain the actual time, discover devices, create a local report, or prepare a scoped action card. Native owner voice can directly perform routine reversible actions within its separately granted device/folder scopes, awaiting confirmed outcomes. Sensitive actions retain owner authorization. Fixed development commands and file moves require approval in the interactive companion; they are disabled for automatic native voice. There is no arbitrary model-generated shell tool.

## Model onboarding and voice setup

The default for a new workspace is **Google Gemini Developer API** through the official `@google/genai` SDK. The setup form also supports the existing **OpenAI Responses** adapter and optional **local Ollama** through the official `ollama` client. The selected provider is stored as metadata; credentials remain server-side and encrypted. There is no automatic paid or cross-provider fallback.

The setup UI also has a **Custom provider** profile for owner-managed OpenAI-compatible endpoints. Give it a display name, choose **Chat Completions** or **Responses**, enter the exact model/base URL, and optionally store an API key in the same encrypted vault. Remote endpoints must use HTTPS; HTTP is allowed only for localhost. A Windows-loopback bridge can be enabled for a local endpoint when the production backend is running in WSL. Custom routes require an explicit owner acknowledgement of the provider's quota/billing policy. `Save and test connection` performs a harmless structured function-call check, so a custom route is not marked Connected merely because it returned HTTP 200 or plain text.

```dotenv
MODEL_PROVIDER=gemini
OPENAI_API_KEY=YOUR_SERVER_SIDE_API_KEY
OPENAI_MODEL=YOUR_ACTUAL_RESPONSES_COMPATIBLE_MODEL
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_API_KEY=YOUR_GEMINI_DEVELOPER_API_KEY
GEMINI_MODEL=gemini-flash-latest
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:1b
ENABLE_WEB_SEARCH=false
```

You can configure these values owner-only from **Settings → AI provider → Configure AI provider**. The AI card in **Skills & integrations** opens the same flow. Choose Gemini, OpenAI, or Ollama; the protocol is selected automatically. Gemini’s form uses `gemini-flash-latest`, the current model example in the installed official SDK README. Google AI Studio free-tier quotas are model/project/region/account dependent, so check the current [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [rate-limit](https://ai.google.dev/gemini-api/docs/rate-limits) pages before relying on free usage; this project does not enable billing. Create a Gemini key through [Google AI Studio](https://aistudio.google.com/apikey). The official SDK and API behavior are documented in Google’s [Gemini quickstart](https://ai.google.dev/gemini-api/docs/quickstart), [models](https://ai.google.dev/gemini-api/docs/models), and [function-calling](https://ai.google.dev/gemini-api/docs/function-calling) pages.

OpenAI uses `POST {base URL}/responses`; a Chat Completions-only endpoint is rejected. Ollama uses its local API at `http://127.0.0.1:11434` and requires the selected model to already be installed. For this machine’s 16 GB RAM / 4 GB GPU, start with the official `gemma3:1b` library entry (listed around 815 MB); do not select `gemma3:4b` until you intentionally install it and confirm available memory. Ollama setup does not download models automatically. The explicit native installer separately downloads its local speech model. See the official [Ollama API](https://docs.ollama.com/api) and [Gemma 3 library](https://ollama.com/library/gemma3) pages.

The key is sent only to the authenticated LUCIFER server, encrypted in `.local/ai-credentials.enc`, and never returned to the browser. The encrypted vault key is `.local/ai-credentials.key`; both are ignored by Git and should remain owner-readable. A blank key keeps the selected provider’s existing server-side key or environment key. **Save configuration** saves without connecting. **Save and test connection** explicitly performs a minimal request for the selected provider, with visible progress, cancellation, and a 30-second server timeout. `configured · unverified` is not treated as connected. Statuses distinguish awaiting configuration, configured/unverified, connected, failed, disconnected, and unsupported. Unsaved model/endpoint/key fields stay in component memory across provider switches and recoverable errors; credentials are never persisted to browser storage. Refresh retains the selected page/open form, not an unsaved credential.

There is no FlagshipRouter adapter in this project. Your OmniRush login, subscription, or credentials in another project do not provide runtime API access here. Do not enter those credentials into LUCIFER. Web search is only exposed to the OpenAI Responses adapter when `ENABLE_WEB_SEARCH=true`; Gemini and Ollama receive the same owner/tool boundary without an invented web-search capability.

### Gemini connection diagnostics

The Gemini connection probe is a text-only request with a bounded **2048-token** output budget and a 30-second timeout. Thinking can consume output tokens: the previous 30-token probe returned HTTP 200 with `MAX_TOKENS` and no visible text for the currently resolved `gemini-3.8-flash` model. This is now classified as output exhaustion, not a bad key/model. Movable aliases use model-default thinking settings rather than hard-coded model-specific controls. SDK automatic retries are disabled, including on quota errors; no billing or provider fallback is enabled.

The integration card shows distinct errors plus optional sanitized connection diagnostics: HTTP status, resolved model version, finish reason, prompt block reason, response part types, and token counts. Request content, generated text, headers, credentials, and thought signatures are excluded. Connected requires actual nonempty visible model text. Normal chat function-call-only responses enter the existing permission/schema-validated tool loop; opaque Gemini thought signatures are retained only in memory for tool continuation.

Normal mode: type, attach documents, press the microphone, inspect the final transcript, and send. Realtime mode: a foreground **turn-based** browser voice session; press the microphone for each turn, final transcripts send automatically, and replies use speech synthesis. Pressing the microphone interrupts current speech. **Mute** pauses the session; **Stop** aborts listening and speaking. Cancel an executing task separately in Tasks, or use Emergency stop.

Browser recognition uses the Web Speech API in supporting browsers. Chrome/Edge may send audio to a browser-operated recognition service. HTTPS or localhost and microphone permission are required. A `network` speech error concerns that browser service; no automatic retry is enabled. Set `ta-IN` for Tamil/mixed speech or `en-IN` for English. Browser modes are foreground and turn-based. **Windows background voice is separate:** its native tray continuously checks the local Lucifer grammar, locally transcribes activated audio, and uses local speech output. Settings → Windows background voice shows its actual heartbeat and controls; see [the native guide](docs/WINDOWS-VOICE.md).

## Pair the Windows companion

```powershell
Copy-Item companion/config.example.json companion/config.json
```

Edit the new configuration: use real absolute `.exe` paths, your approved folder aliases, approved HTTPS website origins, and any fixed command specifications. The example folder is a placeholder **inside this project**; create or select your own authorized working folder. Keep all testing for this handover inside this project. No old LUCIFER or unrelated repository is referenced.

For development on the same laptop, `server` may be `http://localhost:3001`. For phone access use your private HTTPS server URL; HTTP on a remote IP is rejected. In Devices, create a pairing challenge, then run:

```powershell
npm run companion
```

Enter the five-minute challenge in the terminal. The device then advertises its enabled app/folder/command aliases. Select that device explicitly in the UI. Opening a project uses the `vscode` app alias plus an approved folder alias.

Credentials are encrypted with Windows **DPAPI CurrentUser** under `.local/companion`. Revoking the device invalidates its credential. New commands require a heartbeat within 15 seconds, expire after 20 seconds if not claimed, and are never silently replayed after a backend restart. Commands have durable IDs and retained outcomes; a retried result upload does not rerun the action. Emergency stop reaches the companion on its next poll, approximately three seconds while connected.

### Approved development commands

Add a fixed specification to `commands`. For npm scripts on Windows, run Node with the actual npm CLI path rather than `.cmd` or a shell:

```json
"build": {
  "executable": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "run", "build"],
  "folders": ["selected-project"]
}
```

Confirm those paths on your installation. Repository scripts execute code, so the terminal requires explicit approval for each command. Commands have a 60-second timeout, bounded/redacted output, an exit code, and process-tree termination on cancellation. `.cmd`, `.bat`, shell interpreters, arbitrary arguments from the model, installations, elevation, and destructive deletion are not exposed as general tools.

File operations require relative paths under an approved folder. Traversal, drive-qualified paths, alternate data streams, reserved filenames, and symlink/junction escapes are rejected. Creation is plain `.txt` with no overwrite. Organization is a same-scope copy-then-remove with no overwrite; a partial failure is reported. Path checks do not protect against a malicious local process racing filesystem changes; use approved folders under your control.

## Android connection

1. Serve the built app using an **already authorized HTTPS reverse proxy or private tunnel** to the loopback backend. Set `PUBLIC_ORIGIN` to that exact HTTPS origin and `COOKIE_SECURE=true`, then restart. No proxy, tunnel, hosting subscription, or inbound laptop service was installed for you.
2. Open that URL in Android Chrome, sign in as the owner, and add it to the home screen where supported.
3. Use chat, voice, uploads, task progress, report previews, reminders, and the explicit target-device controls.
4. Pair the Windows companion to the same HTTPS backend. The phone uses its authenticated web session; the laptop uses its revocable device credential.

The PWA includes a private-data-free offline page. It does **not** cache chats or reports, queue offline device actions, or claim native Android app control. Closed-browser/background notifications are provided through configured Telegram, not native push. Android accessibility automation, lock-screen actions, background wake word, and native application automation are unsupported in this release.

## Instagram → six ideas → PDF → Telegram

1. Export actual post-level analytics, normalize them to [docs/IMPORTS.md](docs/IMPORTS.md), and import the CSV in Files & reports. Upload a PNG/JPEG brand logo if desired.
2. Select the account, brand, date range, timezone, logo, and English or Tamil. The default range includes the last 30 publication dates in your timezone.
3. Generate the report. Tasks shows real analysis/rendering events. Metrics are calculated from supplied values; unavailable data stays unavailable.
4. Review the **actual PDF page raster previews**. Exactly six evidence-linked, rule-based creative briefs are included. Each has a title, evidence, hook, format, duration, scene outline, talking points, caption, CTA, and evaluation metric.
5. Approve the inspected layout, open/download the PDF, then authorize sending it to the verified Telegram destination.

Reports include data provenance, retrieval time, reporting period, metric coverage, denominator definitions, and limitations. Post reach is not mislabelled as unique account reach. Publication-date filtering does not manufacture period-specific observation windows. Direct Instagram OAuth/API access, follower history, demographics, account-level metrics, previous-period comparison, and AI-written bespoke scripts are not implemented; this release supports the actual CSV import path and clearly labelled rule-based briefs.

### Telegram

Create a dedicated bot with official **@BotFather** and set `TELEGRAM_BOT_TOKEN` server-side. Restart. In Skills & integrations choose Verify Telegram destination, open the bot's private chat, and send the displayed `/start` code. Check verification in the app. The destination is connected only after the matching short-lived inbound message is verified. A bot with an existing webhook needs a deliberate change or a separate bot; the application does not remove unrelated webhooks.

Delivery succeeds only when Telegram returns a usable `message_id`. Receipts are retained. Confirmed file/destination combinations are not resent. After a timeout, unreadable response, or server restart during a send, the outcome is **uncertain** and automatic retry is blocked. Check Telegram, reconcile the outcome in Skills & integrations, then explicitly retry the same available report if necessary. A failed send does not regenerate the PDF.

## Reminders and memory

Tasks supports one-time, daily, and weekly reminders, viewing/editing/cancellation, and in-app or verified Telegram delivery. The initial timezone is **Asia/Kolkata**. Schedules persist in SQLite. Missed occurrences deliver on the next running scheduler pass; recurring backlog is coalesced to one notification and then advanced. Ambiguous or nonexistent daylight-saving times are rejected with a focused error. The server must be running to deliver; scheduled does not mean delivered.

Memory supports separate project/brand contexts, provenance, update dates, editing, deletion, export, and disabling retrieval. It is not automatically populated from uploaded documents or chat. Explicit chat memory requests produce owner-reviewable cards. Passwords, API keys, and labelled credentials are rejected. Integration tokens stay in `.env` or OS credential protection, not memory.

## Verification and demonstration

```powershell
npm run build
npm test
npm run test:e2e
npm run test:provider-ui
# In Windows PowerShell with Windows dependencies:
npm run test:windows
```

Tests use clearly labelled synthetic data in separate ignored test directories. They do not connect to your Instagram account, spend API credit, send live Telegram messages, or record your microphone. Browser tests launch a real Chromium instance and exercise the authenticated UI, responsive viewport, paired transport with a real scoped file handler, imports, report generation, download, memory, and stop controls. Native Windows checks actually execute the Windows policy handler, a harmless approved Node launch, a fixed version command, junction rejection, and DPAPI protection. Physical Android and VS Code remain separate checks.

`test:provider-ui` exercises both provider entry paths with no keys, all three choices, draft retention, cancellation/double-submit prevention, failed/slow/malformed backend responses, refresh, theme/layout navigation, contained rendering errors, and a synthetic speech-network error with no automatic microphone retry. `npm run test:live-ui` is a diagnostic for the already-running no-credential checkout at `http://127.0.0.1:5173`; it uses a temporary session removed afterward, checks both entry paths, and hashes owner records/protected files before and after without changing them. Neither is live AI verification.

Verification artifacts are in `.local/verification`: desktop/mobile screenshots, English/Tamil test PDFs, actual PDF page previews, and browser/native result JSON. They are intentionally excluded from Git.

**Demo checklist:** sign in → typed clock tool → persist/reload conversation → pair laptop → open configured VS Code project → try an offline device → import actual CSV and logo → inspect six-idea PDF → verify Telegram and send once → schedule a reminder, restart, and inspect delivery → revoke a permission/device → use Emergency stop. Credential/hardware-dependent items must be checked on your configured devices before calling those journeys verified.

## Documentation and source references

- [STATUS.md](STATUS.md): implemented, verified, configuration, hardware, unsupported status.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, boundaries, execution and recovery.
- [docs/IMPORTS.md](docs/IMPORTS.md): precise CSV contract and data semantics.
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): performed checks and remaining live journeys.
- [docs/SOURCES.md](docs/SOURCES.md): official documentation consulted for this release.
- [docs/WINDOWS-VOICE.md](docs/WINDOWS-VOICE.md): installed native voice, permissions, repeatable setup/uninstall, verified recovery and physical acceptance.

Git is initialized. Secrets, credentials, databases, generated reports, browser binaries and build outputs are ignored. Source and the dependency lockfile are ready for an intentional commit; no commit or push was requested or performed.
