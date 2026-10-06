import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Store } from './store.js';
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function setOwner(store:Store,password:string) {
  if(password.length<12) throw new Error('Use at least 12 characters');
  const salt=randomBytes(32).toString('hex');
  store.put('owner',{id:'owner',salt,passwordHash:scryptSync(password,salt,64).toString('hex')});
  store.db.exec('DELETE FROM sessions');
}
export function login(store:Store,password:string):string|undefined {
  const owner=store.get<{salt:string;passwordHash:string}>('owner','owner');
  const salt=owner?.salt||'missing';
  const actual=scryptSync(password,salt,64), expected=Buffer.from(owner?.passwordHash||'00'.repeat(64),'hex');
  if(!timingSafeEqual(actual,expected)||!owner)return;
  const token=randomBytes(32).toString('base64url');
  store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),Date.now()+86400000*7);
  return token;
}
export function validSession(store:Store,token:string|undefined) { if(!token)return false; const r=store.db.prepare('SELECT expires FROM sessions WHERE hash=?').get(hash(token)) as {expires:number}|undefined;return !!r&&r.expires>Date.now(); }
export const secretPattern=/(sk-[\w-]{8,}|AIza[\w-]{20,}|\b\d{6,}:[\w-]{20,}|(?:password|api[_ -]?key|token|secret)\s*[:=]\s*\S+)/gi;
export function redact(text:string) { return text.replace(secretPattern,'[REDACTED]'); }
