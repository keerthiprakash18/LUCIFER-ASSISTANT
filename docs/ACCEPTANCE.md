# Acceptance verification

Performed on 2026-10-05 using Node 24.21.0, real Chromium, and available native Windows Node/PowerShell. Tests use labelled synthetic fixtures; no personal account analytics are asserted.

| Journey | Result | Evidence / boundary |
|---|---|---|
| Typed request triggers a real tool | Passed | Chromium sign-in → “What is the time?” → actual clock, task events, persisted reply |
| AI onboarding saves and tests the selected protocol | Passed with mocked Responses contract | Provider selector boundary, metadata-only SQLite, encrypted ciphertext and real-shaped test response; live credential not used |
| Chat/settings survive restart | Passed | Backend restart test + browser reload/theme test |
| Tamil/Tanglish voice produces the right instruction | Awaiting device and model configuration | No microphone recognition was performed |
| Speech network error is distinguished from AI provider error | Passed by code path/unit inspection | Browser message explicitly identifies browser-managed recognition service; no automatic retry |
| Voice stop/mute controls behave as labelled | UI state passed; audio awaiting device | Realtime → mute → stopped session; no acoustic test claimed |
| Mobile interface reaches selected paired transport | Passed in 390×844 Chromium viewport | Authenticated device registration → UI action → actual scoped Linux file handler → returned result |
| Native Windows actions | Passed separately | Actual scoped read/create, approved Node launch, fixed version command, local denial, junction escape rejection, DPAPI round-trip |
| Installed background Windows actions | Passed 2026-10-06 | Actual native device → background worker → Notepad; harmless note create/read/find; confirmed result, private-vault/automatic-move denial |
| Native microphone and speech controls | Passed programmatically | Real mic closed/reopened using registered hotkeys; native English speech interrupted with Ctrl+Alt+Esc; Tamil WAV generation passed. Audible quality remains physical |
| Native startup/duplicate/recovery | Passed programmatically | Current-user registration enable/disable, duplicate launch prevented, forced tray crash recovered with one worker/model stack, production backend restart recovered automatically |
| Local wake and transcription | Passed with synthetic English audio | Real SAPI grammar confidence ~0.932, actual local Whisper transcript “Lucifer, Open Notepad.”; CPU int8/offline, zero provider requests |
| Native physical wake/Tamil/follow-up/reboot | Awaiting owner | Run the short [Windows acceptance sequence](WINDOWS-VOICE.md#minimal-physical-acceptance); registration and synthetic speech are not physical acceptance |
| Physical phone → Windows companion → VS Code | Awaiting device testing | Independent transport/native checks do not substitute for this hardware journey |
| Unavailable device | Passed | Offline heartbeat → API/UI error; no stale execution |
| Unauthorized or revoked device | Passed | Missing/invalid credential and revoked device cannot poll/execute |
| File cannot escape approved folders | Passed | Traversal, drive-qualified path, Linux symlink and Windows junction rejection |
| Analytics contain only supplied metrics | Passed | Known fixture sums, selected dates, incomplete fields and zero-denominator cases |
| Exactly six ideas | Passed | Six evidence-linked briefs in report records and nine-page rendered document |
| PDF opens and renders | Passed | Actual PDF downloaded, parsed, nine pages rasterized; English/Tamil contact sheets and idea pages visually inspected |
| Live Telegram delivery, no duplicates | Awaiting configuration | Mock contract verifies receipt deduplication; no live bot send was performed |
| Expired credentials recoverable | Telegram adapter passed with mock response | HTTP 401 message instructs token repair; live expiration not induced |
| Reminder persists and does not duplicate | Passed | SQLite close/reopen → due in-app reminder → single persistent notification across another restart |
| Integration disconnection prevents use | Passed in adapter permission test | No new Telegram request after permission disabled |
| Untrusted instructions cannot grant execution | Passed with malicious mock model | Uploaded instruction plus fabricated unrestricted tool call rejected; zero shell/device/delivery actions |
| Cancelling task prevents next external step | Passed | Abort check before external step; zero side effects |
| Emergency stop blocks new actions | Passed | Browser control, persisted stopped state, action/proposal rejection |
| Dependency/build checks | Passed | TypeScript + Vite; ten focused tests; `npm audit`: zero reported vulnerabilities |

## Run the remaining real journeys

1. Gemini is already Connected. Ask a Tamil/Tanglish document question using an actual uploaded file. Check the answer against the source and inspect tool events. No credential re-entry is required for the installed native acceptance sequence.
2. On Android Chrome over HTTPS, allow the microphone deliberately. Say “Lucifer, laptop-la VS Code open panni selected project load pannu.” Check the final transcript and proposed target/folder before authorizing it. Verify the laptop window and returned device outcome. Repeat with the companion stopped; expect an offline error.
3. Test microphone permission denial, silence, background noise, unplugged audio, speaking interruption, mute, and stop. Confirm no partial transcript executes a task.
4. Configure a dedicated Telegram bot, verify the private destination, inspect a real branded PDF, and send once. Record the returned `message_id`. Click send again for the same file/destination and confirm the existing receipt is reused rather than another message being sent.
5. Disconnect Telegram and attempt delivery; expect a blocked request. Restore configuration and verification deliberately.
6. Schedule an in-app reminder for a near-future explicit local time, stop/restart the server, and inspect the one delivered inbox item. Repeat through Telegram only after live verification.
7. For uncertain delivery, inspect Telegram before using the reconciliation form. Do not clear the ledger or regenerate the report to force a retry.

The standalone native Windows script's app launch is **Node**, not VS Code. Its artifacts report this explicitly. No live hardware/provider test should be relabelled passed merely because configuration fields are filled in.
