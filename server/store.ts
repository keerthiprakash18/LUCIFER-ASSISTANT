import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export interface Storage { get<T>(kind:string,id:string):T|undefined; list<T>(kind:string):T[]; put<T extends {id:string}>(kind:string,value:T):T; remove(kind:string,id:string):void }
export class Store implements Storage {
  db:DatabaseSync;
  constructor(directory:string) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(directory,'lucifer.db'),{timeout:5000});
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  }
  get<T>(kind:string,id:string):T|undefined { const r=this.db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,id) as {value:string}|undefined; return r?JSON.parse(r.value):undefined; }
  list<T>(kind:string):T[] { return (this.db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid').all(kind) as {value:string}[]).map(r=>JSON.parse(r.value)); }
  put<T extends {id:string}>(kind:string,value:T):T { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,value.id,JSON.stringify(value));return value; }
  remove(kind:string,id:string) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  close() { this.db.close(); }
}
export const id=()=>randomUUID();
export const now=()=>new Date().toISOString();
