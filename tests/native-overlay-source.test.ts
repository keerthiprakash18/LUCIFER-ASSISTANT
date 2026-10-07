import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native desktop panel is wired to the real wake and task pipeline',async()=>{
  const [tray,overlay,build,worker,speech]=await Promise.all([
    readFile('companion/native/Tray.cs','utf8'),
    readFile('companion/native/Overlay.cs','utf8'),
    readFile('scripts/build-native-tray.ps1','utf8'),
    readFile('companion/background.ts','utf8'),
    readFile('companion/native/speech_worker.py','utf8')
  ]);
  assert.match(overlay,/sealed class AssistantOverlay/);
  assert.match(overlay,/ShowWithoutActivation/);
  assert.match(overlay,/Waveform/);
  assert.match(overlay,/Confirmation required|currentState/);
  assert.match(tray,/Acknowledge\(Action next\)/);
  assert.match(tray,/ackSynth\.SpeakAsync\("Yes boss"\)/);
  assert.match(tray,/AcknowledgeAndDispatch\(command\)/,'single-utterance wake commands must dispatch without waiting for acknowledgement speech to finish');
  assert.match(tray,/RegisterHotKey\(Handle,3,0x4003,0x20\)/,'global summon shortcut must be registered explicitly');
  assert.match(tray,/overlay\.UpdateRuntime\(/,'panel state must come from runtime state');
  assert.match(tray,/if\(exitCode==10\)break/,'supervisor must restart unexpected tray exits and stop only on explicit exit');
  assert.match(build,/Overlay\.cs/,'native build must compile the real panel');
  assert.match(worker,/kind:'progress'/,'panel progress must originate from observed backend task states');
  assert.match(worker,/setTimeout\(r,120\)/,'native result polling should stay low latency');
  assert.match(tray,/TotalMilliseconds>650/,'command endpointing should be tuned for short local voice turns');
  assert.match(tray,/TotalMilliseconds>380/,'wake endpointing should be tuned for fast local activation');
  assert.match(overlay,/bool listening=state=="Listening"/,'robot animation must react to runtime state');
  assert.match(overlay,/sealed class WakeHero/,'wake activation must have a dedicated cinematic scene');
  assert.match(overlay,/LinearGradientBrush/,'wake scene should use layered premium gradients');
  assert.match(tray,/overlay\.ShowWakeScene\(\)/,'real wake activation must open the cinematic scene');
  assert.match(speech,/lucyfer\|lusifer\|lousifer\|loosefer\|loocifer/,'wake matcher must tolerate common Lucifer transcriptions');
  assert.match(speech,/edit_distance\(token, "lucifer"\) <= 2/,'wake matcher must include bounded local fuzzy matching');
  assert.match(speech,/லூசிபர்\|லூசிஃபர்/,'wake matcher must retain Tamil wake spellings');
  assert.match(tray,/StartFastWakeRecognizer\(\)/,'single-word wake must use an instant local recognizer before Whisper fallback');
  assert.match(tray,/new Choices\(new string\[\]\{"Lucifer","Hey Lucifer","Lucyfer","Lusifer"\}\)/,'fast wake grammar must include common Lucifer pronunciations');
  assert.match(tray,/e\.Result\.Confidence<0\.38f/,'fast wake recognizer must keep an explicit confidence floor');
  assert.match(tray,/stream\.Push\(data\)/,'the same local microphone PCM must feed the fast wake recognizer');
  assert.match(overlay,/const int ExpandedWidth=390/,'expanded voice card must stay compact');
  assert.match(overlay,/const int ExpandedHeight=292/,'expanded voice card must not regress to the oversized debug panel');
  assert.doesNotMatch(overlay,/TotalMilliseconds>520\)ShowTaskPanel/,'working state must not auto-replace the cinematic wake HUD');
  assert.match(overlay,/if\(wakeScene\)\{EnsureVisibleOnScreen\(\);if\(!Visible\)Show\(\);return;\}/,'voice dispatch must preserve the cinematic wake HUD');
  assert.match(overlay,/Understanding your request|Working on it/,'raw backend task-state text must be replaced with user-facing status');
});
