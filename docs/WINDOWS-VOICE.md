# Windows background voice

Installed and directly checked on **2026-10-06** in this existing checkout. The native tray is running independently of the browser. The production dashboard is **http://localhost:3001**; Vite and a visible terminal are not needed for everyday use.

The tray now uses the project's **pink LUCIFER emblem** with a status dot and tooltip **`LUCIFER - Listening`** (or Paused/Working/Error). This app's notification-area entry is promoted for the current user. The executable and Voice settings window also use the branded icon.

## Manual recovery and microphone window

The existing installed executable is:

`C:\Users\micha\Music\LUCIFER-ASSISTANT\.local\native\LUCIFER.exe`

From Windows PowerShell, start it and open Voice settings/calibration:

```powershell
& "C:\Users\micha\Music\LUCIFER-ASSISTANT\.local\native\LUCIFER.exe" --supervise --settings
```

If it is already running, this command reuses the existing instance and opens/activates its single settings window. It does not load another worker/model stack. The wrapper `& .\scripts\start-native.ps1 -OpenSettings` additionally checks fresh current-session desktop metadata and promotes only this application's icon. Choose the **Microphone input** dropdown in the settings window; calibration remains an explicit owner action.

For a source-only tray rebuild/relaunch that retains the already-running production backend and all account/device configuration, use `& .\scripts\build-native-tray.ps1 -Restart -OpenSettings`. Compilation is staged before the installed tray is gracefully stopped; no forced replacement is performed if it cannot exit.

## Daily use

1. At the owner's Windows sign-in, `LUCIFER.exe --supervise` starts the tray and its hidden local workers. Wait for **Listening**.
2. Say **“Lucifer”**, then your instruction. The local multilingual utterance detector checks for the marker and gives a cue only after acceptance. Ambient non-wake utterances remain local. The capture stops after approximately 1.1 seconds of silence, with a 20-second maximum.
3. Replies use local speech output. A six-second follow-up window opens after a reply; subsequent turns retain the existing conversation context. When that window closes, say “Lucifer” again.
4. Right-click the tray to open the dashboard, pause/resume the actual microphone, stop, change voice settings, grant a folder, change sign-in startup, or exit.

**Ctrl+Alt+Esc** stops speech and requests cancellation of the current action. The runtime first tries **Ctrl+Alt+L** for pause/resume and uses **Ctrl+Alt+Shift+L** if it is unavailable. The tray displays the selected shortcut, which can differ after a restart as other Windows registrations change. The Shift fallback was exercised successfully during verification; both registration results are recorded in local status.

English “stop” is recognized locally during capture/transcription/work. “Stop” / “நிறுத்து” are also interpreted from an activated command or follow-up transcript. During speech output, use the global stop shortcut or tray; self-speech is excluded from wake recognition. Cancellation cannot undo an OS launch or completed file creation.

### One-time microphone calibration

Open **Tray → Voice settings and microphone calibration**. Select the real input and use `auto` for mixed English/Tamil transcription. Choose the reply language separately (`auto`, `en`, `ta`). Calibration measures two seconds of background noise, then records eight seconds for a Lucifer + short sentence test. It displays actual local wake detections and the locally transcribed sentence for comparison. It does not execute the sentence or send it to Gemini; its temporary audio is deleted.

Say **“Lucifer, தமிழில் பேசு”** to persist Tamil replies while keeping multilingual input, or “Lucifer, speak English” to switch back. Language accuracy, voice quality and noise tolerance still require your own speech check. This release does not claim speaker authentication or a speaker-trained wake model.

## Actual local components

| Component | Installed implementation |
|---|---|
| Tray, controls, microphone | C# WinForms / WinMM, .NET Framework x64; built using Windows' existing compiler |
| Continuous local wake | Local multilingual Faster-Whisper utterance detector; accepted marker and post-marker command stay local until dispatch |
| Command transcription | Faster-Whisper **1.2.1**, multilingual **small**, CPU **int8**, four threads |
| Audio decoding | PyAV **15.1.0** (pinned; 19.0.1 broke the decoder API used by Faster-Whisper 1.2.1) |
| Speech model | `Systran/faster-whisper-small`, revision `536b0662742c02347bc0e980a01041f333bce120`, approximately 486 MB |
| English output | Installed Microsoft English desktop system voice |
| Tamil output | Project-local eSpeak-NG **1.52.0**, `ta`; robotic voice, approximately 12.8 MB MSI |
| Device transport | Hidden Windows Node 24 worker, existing authenticated outbound device protocol |
| Production server | Hidden managed WSL Ubuntu process, `npm start`, built UI on port 3001 |
| Sign-in launch | Current-user Run value `LUCIFER Assistant`; no elevation |

The inspected machine has an i5-10300H, 15.8 GB RAM, and GTX 1650 with approximately 4 GB VRAM. Speech uses CPU int8 to avoid a CUDA installation. Windows Python is 3.13.7; its decoder wheel is approximately 31.3 MB. No paid speech service or billing fallback is enabled. Conversation requiring Gemini uses the already-configured selected provider and its applicable quota.

Ambient PCM stays in a bounded local memory ring. Command WAVs exist only during activated transcription and are deleted afterward. Pre-wake text is trimmed locally at the last Lucifer marker; an initial command without a recognizable marker is withheld and the runtime requests a repeat. The six-second follow-up window is part of the activated conversation. Recognition pauses action activation during LUCIFER's speech output.

## Authorized actions

The separately provisioned native device preserves earlier device pairing. Routine tools can open advertised app aliases, open HTTPS sites in the dedicated browser, observe public page state, open an approved VS Code project/document, read/search approved folders, create new text notes without overwrite, analyze supplied CSVs/create verified PDF reports, and manage explicitly requested in-app reminders. Existing report tools remain available within their permissions. Every action argument is schema-validated and every routine outcome is awaited.

Default native scopes on this installation:

- `notes`: this project's `.local/notes`.
- `workspace`: this project root, enabled with VS Code. Private application state remains blocked.
- Apps discovered here: Notepad, VS Code, Edge, Chrome, and the browser alias.
- HTTPS website opening is explicitly enabled in the native policy.

**Tray → Grant an additional folder** requires an owner folder selection and confirmation. The model cannot expand its own access. Private `.local`, `.git`, `.env*`, dependency directories, vault files and device credentials are blocked as relative path components. Search skips private directories and junctions/symlinks; it is bounded to depth three, 1,000 entries and 50 matches.

Destruction, arbitrary shell execution, file moves, purchases, message/file delivery, and access expansion are excluded from automatic native actions. Sensitive supported workflows use explicit dashboard authorization. A confirmed launch means Windows accepted the request; it does not prove arbitrary window contents. Failure, cancellation and unconfirmed timeouts never count as success.

## Repeatable setup for this laptop

The installer targets the inspected owner **micha**, the existing **Ubuntu** WSL distribution and WSL Node `/home/micha/.nvm/versions/node/v24.21.0/bin/node`. Windows Node/Python and the installed en-US speech recognizer must remain available. This is a configured-machine installation, not a universal installer for other owners/distributions.

From Windows PowerShell in `C:\Users\micha\Music\LUCIFER-ASSISTANT`:

```powershell
& .\scripts\install-native.ps1
# Rebuild/reinstall using the model already downloaded:
& .\scripts\install-native.ps1 -SkipSpeechDownload
```

The installer prepares the Node bundles/backend helpers, builds the production UI using WSL Node, preserves existing native policy and credential, checks the speech dependency pins, prepares the local model, extracts eSpeak inside the project, actually checks Tamil WAV synthesis, compiles the tray, registers startup, and launches it. `-SkipSpeechDownload` skips the large model preparation; it still checks dependency compatibility. The existing WSL dependency tree is used; do not replace it with a concurrent Windows `npm ci`. Owner setup is not repeated and no account/database is reset.

### Startup and uninstall controls

```powershell
& .\scripts\install-native.ps1 -DisableStartup
& .\scripts\install-native.ps1 -Uninstall
```

DisableStartup turns off next-sign-in launch. Uninstall also stops the tray and this project's managed backend. Both retain the owner account, chat, memory, reports, encrypted provider/device credentials, pairing records and model downloads. Re-running installation enables startup again. The tray exposes startup enable/disable directly; Exit ends the native voice workers. Revoking the native device from Devices invalidates its bearer credential.

## Verification and diagnostics

These explicit Windows diagnostics perform real actions and project-only restarts:

```powershell
# Bundles are prepared by the installer (or npm run native:build in WSL).
node .local/verification/native-runtime.mjs
node .local/verification/native-speech.mjs
& .\scripts\native-control.ps1 -Action state
```

`native-runtime.mjs` launches Notepad, creates/reads/finds a harmless scoped note, rejects a move/private-vault read, injects the registered pause/resume/stop shortcuts, generates a Tamil WAV, toggles startup, tests duplicate launch, forces a tray crash, and restarts only this project's managed production backend. `native-speech.mjs` synthesizes an English fixture, checks the real local wake grammar and real Whisper transcription, briefly stops the tray to release the single-model lock, and restarts it. Neither diagnostic makes a provider request or substitutes for physical speech.

Evidence in `.local/verification`:

- `native-runtime-results.json`: all direct runtime checks passed, including native Tamil UTF-8 instruction/response transport and speech start; final Listening state.
- `native-speech-results.json`: local synthetic wake confidence approximately 0.932; Whisper returned “Lucifer, Open Notepad.” An out-of-audio-directory fixture was rejected and remained intact. No physical accuracy claim.
- `native-settings.png`: real production Settings/provider/native status UI.
- `native-preservation-baseline.json`: local hashes; existing owner records, file storage and protected credentials checked after installation/actions/restarts. Intentional diagnostic messages/tasks are additional records; native heartbeats are mutable.
- `tray-recovery-results.json`: registered icon, visible settings/microphone selector, current session/desktop, 30-second unchanged process-ID check, duplicate recovery-launch reuse and unchanged protected credential files. This is a software visibility check, not physical microphone/wake acceptance.
- `tray-icon-visible.png`: cropped actual notification-area emblem, excluding the rest of the desktop.

Runtime metadata: `.local/native/status.json`. Backend log: `.local/native/backend.log`. Device bearer credentials use **DPAPI CurrentUser**; Gemini stays in the existing encrypted server vault. Keys are never command-line arguments or diagnostic output. Startup/tray mutexes, exclusive worker/model ownership, stdin-close shutdown, process-tree stop and durable command outcomes prevent parallel worker stacks and unsafe action replay. Microphone reconnection and sleep/resume handlers are implemented; physical unplug/sleep checks remain outstanding.

Sanitized native lifecycle logs are `.local/native/tray-events.jsonl` and `.local/native/supervisor-events.jsonl`. They include timestamps, process/session IDs, window station/desktop, lifecycle/status events and exception type/HRESULT; they exclude audio, transcripts, model output, credentials and exception messages. `scripts/inspect-native-tray.ps1` checks actual Windows processes, shell icon registration and settings-window controls. Explorer's `TaskbarCreated` broadcast re-registers the icon after an Explorer restart.

The visibility repair found the old supervisor/tray alive in the owner's session 1 on `WinSta0\Default`; Explorer reported a generic information icon in the overflow area. Startup already targeted the correct installed executable. The fix replaced that generic glyph, promoted LUCIFER's own entry, added branded executable identity and a reusable settings launcher, and verified the actual shell/window. A Listening status alone is not treated as proof of icon visibility.

## Minimal physical acceptance

1. In the tray calibration window, confirm Lucifer is detected and your own English/Tamil sentence matches the local transcript.
2. With the dashboard and terminals closed, say **“Lucifer, open Notepad.”** Verify the window and spoken result.
3. Say **“Lucifer, தமிழில் பேசு.”** Verify Tamil output. Give a short follow-up within six seconds and check that it follows the conversation. Press **Ctrl+Alt+Esc** during speech to stop.
4. Sign out/in or reboot. Confirm the tray returns to Listening and repeat the Notepad command. Then check a normal sleep/resume if used.

Startup registration, runtime recovery and local synthetic speech passed; your actual wake/Tamil/Tanglish accuracy, audible Tamil quality, reboot and sleep/resume have **not** been physically verified. The Windows runtime works after sign-in while awake. The existing Android browser remains a foreground chat/voice/dashboard client; background Android wake requires a separate native companion and is not implemented here.
