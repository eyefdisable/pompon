/** Конфигурация окружения, доступ к БД, настройки, безопасность. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool, type Queryable } from './pg';
import { DEFAULT_SETTINGS, type Settings } from '../shared/config';
import { validateSettings } from '../shared/validate';

export const env = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  appSecret: process.env.APP_SECRET || '',
  ownerInitialPassword: process.env.OWNER_INITIAL_PASSWORD || '',
  trustProxy: process.env.TRUST_PROXY === '1',
  tz: process.env.APP_TZ || 'Europe/Kyiv',
  root: process.env.APP_ROOT || process.cwd()
};

export function assertEnv() {
  const miss = [];
  if (!env.databaseUrl) miss.push('DATABASE_URL');
  if (env.appSecret.length < 32) miss.push('APP_SECRET (минимум 32 символа)');
  if (miss.length) throw new Error('Не заданы переменные окружения: ' + miss.join(', '));
}

let pool: Pool | null = null;
export const db = () => (pool ??= new Pool(env.databaseUrl));

export async function migrate() {
  const sql = fs.readFileSync(path.join(env.root, 'db/schema.sql'), 'utf8');
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await db().query(stmt);
  await db().query('INSERT INTO settings (id, value) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [DEFAULT_SETTINGS]);
}

/* ---------- настройки компании (кэш на экземпляр, 5 секунд) ---------- */
let cache: { at: number; s: Settings } | null = null;
export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < 5000) return cache.s;
  const r = await db().query<{ value: any }>('SELECT value FROM settings WHERE id = 1');
  // мягкое слияние с умолчаниями: новые поля из обновлений кода получают значения по умолчанию
  const stored = r.rows[0]?.value ?? {};
  const merged = validateSettings(stored, DEFAULT_SETTINGS);
  const s = merged.ok ? merged.value : DEFAULT_SETTINGS;
  cache = { at: Date.now(), s };
  return s;
}
export async function saveSettings(s: Settings) {
  await db().query('UPDATE settings SET value = $1, updated_at = now() WHERE id = 1', [s]);
  cache = { at: Date.now(), s };
}

/** «Сегодня» в часовом поясе компании, YYYY-MM-DD. */
export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/* ---------- криптография ---------- */
export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
/** Приватный токен заявки выводится из секрета сервера и случайного ключа идемпотентности клиента:
 * повтор того же запроса получает ту же ссылку, а подобрать её без ключа и секрета нельзя. */
export const orderToken = (idempotencyKey: string) => crypto.createHmac('sha256', env.appSecret).update('order:' + idempotencyKey).digest('base64url');

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'base64'));
}

/* ---------- лимиты запросов (в БД — работает и на нескольких экземплярах) ---------- */
export async function rateLimit(key: string, max: number, windowMin: number): Promise<boolean> {
  const r = await db().query<{ hits: number }>(
    `INSERT INTO rate_limits (key, window_start, hits)
     VALUES ($1, date_bin(make_interval(mins => $2::int), now(), '2000-01-01'::timestamptz), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`, [key, windowMin]);
  if (Math.random() < 0.02) db().query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'").catch(() => {});
  return r.rows[0].hits <= max;
}

/* ---------- владелец ---------- */
export const SESSION_COOKIE = 'pp_owner';
export const SESSION_DAYS = 14;

export async function ensureOwner(q: Queryable = db()) {
  const r = await q.query('SELECT 1 FROM owner_account WHERE id = 1');
  if (r.rows.length) return true;
  if (env.ownerInitialPassword.length < 10) return false;
  await q.query('INSERT INTO owner_account (id, password_hash) VALUES (1, $1) ON CONFLICT DO NOTHING', [hashPassword(env.ownerInitialPassword)]);
  return true;
}
export async function createSession(ua: string) {
  const token = randomToken();
  await db().query(`INSERT INTO owner_sessions (token_hash, expires_at, user_agent) VALUES ($1, now() + make_interval(days => $2::int), $3)`, [sha256(token), SESSION_DAYS, ua.slice(0, 200)]);
  return token;
}
export async function checkSession(token: string | undefined) {
  if (!token || token.length > 100) return false;
  const r = await db().query('SELECT 1 FROM owner_sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
  return r.rows.length > 0;
}
