import { build } from 'esbuild';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('.local/native',{recursive:true});
await build({entryPoints:['companion/background.ts'],bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external',outfile:'.local/native/companion-worker.cjs'});
await mkdir('.local/verification',{recursive:true});
await build({entryPoints:['scripts/verify-native.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:'.local/verification/native-runtime.mjs'});
await build({entryPoints:['tests/native-speech.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:'.local/verification/native-speech.mjs'});
const nodeDirectory=path.dirname(process.execPath);
await writeFile('.local/native/start-backend.sh',`#!/usr/bin/env bash
set -eu
exec 9>.local/native/backend.lock
flock -n 9 || exit 0
export PATH="${nodeDirectory}:$PATH"
printf '%s' "$" >.local/native/backend.pid
exec setsid npm start >>.local/native/backend.log 2>&1
`,{mode:0o700});
await writeFile('.local/native/stop-backend.sh',`#!/usr/bin/env bash
set -eu
if test -f .local/native/backend.pid; then
  read -r pid <.local/native/backend.pid || true
  case "$pid" in *[!0-9]*|'') exit 1;; esac
  if test "$(readlink /proc/$pid/cwd 2>/dev/null || true)" = "$PWD"; then kill -- -"$pid" 2>/dev/null || true; fi
  rm -f .local/native/backend.pid
fi
`,{mode:0o700});
console.log('Native Windows worker bundled; production backend launch/stop helpers prepared.');
