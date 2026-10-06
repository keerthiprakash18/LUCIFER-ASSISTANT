import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native desktop panel is wired to the real wake and task pipeline',async()=>{
  const [tray,overlay,build,worker]=await Promise.all([
    readFile('companion/native/Tray.cs','utf8'),
    readFile('companion/native/Overlay.cs','utf8'),
    readFile('scripts/build-native-tray.ps1','utf8'),
    readFile('companion/background.ts','utf8')
  ]);
  assert.match(overlay,/sealed class AssistantOverlay/);
  assert.match(overlay,/ShowWithoutActivation/);
  assert.match(overlay,/Waveform/);
  assert.match(overlay,/Confirmation required|currentState/);
  assert.match(tray,/Acknowledge\(Action next\)/);
  assert.match(tray,/synth\.SpeakAsync\("Yes boss"\)/);
  assert.match(tray,/Acknowledge\(delegate\{Dispatch\(command\);\}\)/,'single-utterance commands must survive the acknowledgement');
  assert.match(tray,/RegisterHotKey\(Handle,3,0x4003,0x20\)/,'global summon shortcut must be registered explicitly');
  assert.match(tray,/overlay\.UpdateRuntime\(/,'panel state must come from runtime state');
  assert.match(tray,/if\(exitCode==10\)break/,'supervisor must restart unexpected tray exits and stop only on explicit exit');
  assert.match(build,/Overlay\.cs/,'native build must compile the real panel');
  assert.match(worker,/kind:'progress'/,'panel progress must originate from observed backend task states');
});
