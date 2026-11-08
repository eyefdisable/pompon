/**
 * Минимальный клиент PostgreSQL (протокол v3) без внешних зависимостей.
 * Поддержка: TLS (sslmode=require), SCRAM-SHA-256 / md5 / cleartext,
 * параметризованные запросы (extended protocol), пул соединений, транзакции.
 * При наличии npm можно заменить на пакет `pg` — интерфейс query/tx совместим по смыслу.
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export type Row = Record<string, any>;
export interface QueryResult<T = Row> { rows: T[]; rowCount: number }
export class PgError extends Error {
  code?: string; detail?: string; constraint?: string;
  constructor(f: Record<string, string>) {
    super(f.M || 'PostgreSQL error');
    this.code = f.C; this.detail = f.D; this.constraint = f.n;
  }
}

interface Cfg { host: string; port: number; user: string; password: string; database: string; ssl: boolean }
export function parseUrl(url: string): Cfg {
  const u = new URL(url);
  const ssl = /sslmode=(require|verify-full|verify-ca)/.test(u.search) || u.searchParams.get('ssl') === 'true';
  return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: u.pathname.slice(1) || 'postgres', ssl };
}

const OID = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, json: 114, float4: 700, float8: 701, numeric: 1700, timestamptz: 1184, timestamp: 1114, date: 1082, jsonb: 3802 };

function parseVal(oid: number, s: string): any {
  switch (oid) {
    case OID.int2: case OID.int4: case OID.float4: case OID.float8: case OID.numeric: return Number(s);
    case OID.int8: { const n = Number(s); return Number.isSafeInteger(n) ? n : s; }
    case OID.bool: return s === 't';
    case OID.json: case OID.jsonb: return JSON.parse(s);
    case OID.bytea: return Buffer.from(s.slice(2), 'hex');
    case OID.timestamptz: case OID.timestamp: return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
    default: return s;
  }
}
function encParam(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

class Writer {
  private parts: Buffer[] = [];
  str(s: string) { this.parts.push(Buffer.from(s + '\0', 'utf8')); return this; }
  i32(n: number) { const b = Buffer.alloc(4); b.writeInt32BE(n); this.parts.push(b); return this; }
  i16(n: number) { const b = Buffer.alloc(2); b.writeInt16BE(n); this.parts.push(b); return this; }
  raw(b: Buffer) { this.parts.push(b); return this; }
  msg(type?: string) {
    const body = Buffer.concat(this.parts); this.parts = [];
    const len = Buffer.alloc(4); len.writeInt32BE(body.length + 4);
    return type ? Buffer.concat([Buffer.from(type), len, body]) : Buffer.concat([len, body]);
  }
}

type Pending = { resolve: (r: QueryResult) => void; reject: (e: any) => void; rows: Row[]; fields: { name: string; oid: number }[]; err?: PgError; count: number };

class Conn {
  private sock!: net.Socket | tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private onAuth?: (type: string, b: Buffer) => void;
  dead = false;
  constructor(private cfg: Cfg) {}

  async connect() {
    let sock: net.Socket | tls.TLSSocket = net.connect(this.cfg.port, this.cfg.host);
    await new Promise<void>((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
    if (this.cfg.ssl) {
      sock.write(new Writer().i32(80877103).msg());
      const ans = await new Promise<Buffer>((res) => sock.once('data', res));
      if (ans[0] !== 0x53) throw new Error('Сервер PostgreSQL не поддерживает SSL');
      sock = tls.connect({ socket: sock as net.Socket, servername: this.cfg.host, rejectUnauthorized: process.env.PGSSL_INSECURE !== '1' });
      await new Promise<void>((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
    }
    this.sock = sock;
    sock.on('data', (d) => this.onData(d));
    sock.on('error', () => { this.dead = true; this.failAll(new Error('Соединение с БД потеряно')); });
    sock.on('close', () => { this.dead = true; this.failAll(new Error('Соединение с БД закрыто')); });
    await this.startup();
  }
  private failAll(e: Error) { const q = this.queue; this.queue = []; q.forEach((p) => p.reject(e)); }

  private startup() {
    return new Promise<void>((resolve, reject) => {
      const w = new Writer().i32(196608).str('user').str(this.cfg.user).str('database').str(this.cfg.database)
        .str('client_encoding').str('UTF8').str('TimeZone').str('UTC').raw(Buffer.from([0]));
      let scram: { nonce: string; first: string; sig?: Buffer } | null = null;
      this.onAuth = (type, b) => {
        if (type === 'E') return reject(new PgError(fields(b)));
        if (type === 'Z') { this.onAuth = undefined; return resolve(); }
        if (type !== 'R') return;
        const code = b.readInt32BE(0);
        if (code === 0) return;
        if (code === 3) this.sock.write(new Writer().str(this.cfg.password).msg('p'));
        else if (code === 5) {
          const salt = b.subarray(4, 8);
          const inner = crypto.createHash('md5').update(this.cfg.password + this.cfg.user).digest('hex');
          const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
          this.sock.write(new Writer().str('md5' + outer).msg('p'));
        } else if (code === 10) {
          const nonce = crypto.randomBytes(18).toString('base64');
          const first = 'n=*,r=' + nonce;
          scram = { nonce, first };
          const payload = Buffer.from('n,,' + first);
          this.sock.write(new Writer().str('SCRAM-SHA-256').i32(payload.length).raw(payload).msg('p'));
        } else if (code === 11 && scram) {
          const server = b.subarray(4).toString();
          const a = Object.fromEntries(server.split(',').map((kv) => [kv[0], kv.slice(2)]));
          if (!a.r.startsWith(scram.nonce)) return reject(new Error('SCRAM: неверный nonce'));
          const salted = crypto.pbkdf2Sync(this.cfg.password.normalize('NFKC'), Buffer.from(a.s, 'base64'), Number(a.i), 32, 'sha256');
          const hmac = (k: Buffer, s: string) => crypto.createHmac('sha256', k).update(s).digest();
          const clientKey = hmac(salted, 'Client Key');
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const withoutProof = 'c=biws,r=' + a.r;
          const authMsg = scram.first + ',' + server + ',' + withoutProof;
          const sig = hmac(storedKey, authMsg);
          const proof = Buffer.from(clientKey.map((x, i) => x ^ sig[i])).toString('base64');
          scram.sig = hmac(hmac(salted, 'Server Key'), authMsg);
          this.sock.write(new Writer().raw(Buffer.from(withoutProof + ',p=' + proof)).msg('p'));
        } else if (code === 12 && scram) {
          const v = b.subarray(4).toString().replace(/^v=/, '');
          if (!scram.sig || v !== scram.sig.toString('base64')) return reject(new Error('SCRAM: подпись сервера не совпала'));
        } else reject(new Error('Неподдерживаемый метод аутентификации PostgreSQL: ' + code));
      };
      this.sock.write(w.msg());
    });
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      if (this.onAuth) { this.onAuth(type, body); continue; }
      this.handle(type, body);
    }
  }
  private handle(type: string, b: Buffer) {
    const p = this.queue[0];
    if (!p) return;
    if (type === 'T') {
      const n = b.readInt16BE(0); let o = 2; p.fields = [];
      for (let i = 0; i < n; i++) {
        const end = b.indexOf(0, o); const name = b.toString('utf8', o, end); o = end + 1;
        const oid = b.readInt32BE(o + 6); o += 18; p.fields.push({ name, oid });
      }
    } else if (type === 'D') {
      const n = b.readInt16BE(0); let o = 2; const row: Row = {};
      for (let i = 0; i < n; i++) {
        const l = b.readInt32BE(o); o += 4;
        const f = p.fields[i];
        row[f.name] = l < 0 ? null : parseVal(f.oid, b.toString('utf8', o, o + l));
        if (l > 0) o += l;
      }
      p.rows.push(row);
    } else if (type === 'C') {
      const m = /(\d+)\0?$/.exec(b.toString('utf8').replace(/\0$/, ''));
      p.count = m ? Number(m[1]) : p.rows.length;
    } else if (type === 'E') p.err = new PgError(fields(b));
    else if (type === 'Z') {
      this.queue.shift();
      if (p.err) p.reject(p.err); else p.resolve({ rows: p.rows, rowCount: p.count });
    }
  }

  query<T = Row>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    if (this.dead) return Promise.reject(new Error('Соединение с БД закрыто'));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve: resolve as any, reject, rows: [], fields: [], count: 0 });
      const parse = new Writer().str('').str(text).i16(0).msg('P');
      const bw = new Writer().str('').str('').i16(0).i16(params.length);
      for (const v of params) {
        const s = encParam(v);
        if (s === null) bw.i32(-1); else { const pb = Buffer.from(s, 'utf8'); bw.i32(pb.length).raw(pb); }
      }
      bw.i16(0);
      const bind = bw.msg('B');
      const describe = new Writer().raw(Buffer.from('P')).str('').msg('D');
      const exec = new Writer().str('').i32(0).msg('E');
      const sync = new Writer().msg('S');
      this.sock.write(Buffer.concat([parse, bind, describe, exec, sync]));
    });
  }
  end() { try { this.sock.write(new Writer().msg('X')); this.sock.end(); } catch { /* ignore */ } this.dead = true; }
}

function fields(b: Buffer) {
  const f: Record<string, string> = {}; let o = 0;
  while (o < b.length && b[o] !== 0) { const t = String.fromCharCode(b[o]); const e = b.indexOf(0, o + 1); f[t] = b.toString('utf8', o + 1, e); o = e + 1; }
  return f;
}

export interface Queryable { query<T = Row>(text: string, params?: any[]): Promise<QueryResult<T>> }

export class Pool implements Queryable {
  private idle: Conn[] = [];
  private total = 0;
  private waiters: ((c: Conn) => void)[] = [];
  private cfg: Cfg;
  constructor(url: string, private max = Number(process.env.PG_POOL_MAX || 5)) { this.cfg = parseUrl(url); }

  private async acquire(): Promise<Conn> {
    while (this.idle.length) { const c = this.idle.pop()!; if (!c.dead) return c; this.total--; }
    if (this.total < this.max) {
      this.total++;
      const c = new Conn(this.cfg);
      try { await c.connect(); return c; } catch (e) { this.total--; throw e; }
    }
    return new Promise((res) => this.waiters.push(res));
  }
  private release(c: Conn) {
    if (c.dead) { this.total--; return; }
    const w = this.waiters.shift();
    if (w) w(c); else this.idle.push(c);
  }
  async query<T = Row>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    const c = await this.acquire();
    try { return await c.query<T>(text, params); } finally { this.release(c); }
  }
  /** Транзакция на одном соединении; при ошибке — ROLLBACK. */
  async tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
    const c = await this.acquire();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally { this.release(c); }
  }
  async end() { this.idle.forEach((c) => c.end()); this.idle = []; }
}
