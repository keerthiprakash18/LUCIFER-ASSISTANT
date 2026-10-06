import { spawn } from 'node:child_process';
export async function dpapi(input: string, decrypt = false): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Credential protection requires Windows DPAPI');
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decrypt ? '[Convert]::FromBase64String($v)' : '[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ${decrypt ? '[Text.Encoding]::UTF8.GetString($r)' : '[Convert]::ToBase64String($r)'}`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false });
    let out = '';
    p.stdout.on('data', b => out += b);
    p.once('error', reject);
    p.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error('Windows credential protection failed')));
    p.stdin.end(input);
  });
}
