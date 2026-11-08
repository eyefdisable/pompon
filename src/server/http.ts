/** HTTP-утилиты: ответы, тела запросов, cookie, origin, multipart, фото. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';
import { env } from './core';
import { LIMITS } from '../shared/config';

export class HttpError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string>) { super(message); }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
export function baseHeaders(res: ServerResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(s);
}

export async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const len = Number(req.headers['content-length'] || 0);
  if (len > max) throw new HttpError(413, 'Слишком большой запрос');
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
export async function readJson(req: IncomingMessage, max = 64 * 1024): Promise<any> {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Ожидается JSON');
  const b = await readBody(req, max);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSec: number, req: IncomingMessage) {
  const secure = env.publicOrigin.startsWith('https://') || req.headers['x-forwarded-proto'] === 'https';
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', c);
}

export function clientIp(req: IncomingMessage) {
  if (env.trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || 'unknown';
}

export function requestOrigin(req: IncomingMessage) {
  if (env.publicOrigin) return env.publicOrigin;
  const proto = env.trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']) : 'http';
  return `${proto}://${req.headers.host}`;
}
/** Изменяющие запросы принимаются только со своего origin (защита от CSRF вместе с SameSite=Strict). */
export function checkOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin || origin !== requestOrigin(req)) throw new HttpError(403, 'Запрос с чужого источника отклонён');
}

/* ---------- multipart/form-data (одна часть с файлом + текстовые поля) ---------- */
export async function readMultipart(req: IncomingMessage) {
  const ct = String(req.headers['content-type'] || '');
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
  if (!ct.startsWith('multipart/form-data') || !m) throw new HttpError(415, 'Ожидается multipart/form-data');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const body = await readBody(req, LIMITS.maxPhotoBytes + 64 * 1024);
  const fields: Record<string, string> = {}; let file: { name: string; data: Buffer } | null = null;
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    const start = pos + boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const headEnd = body.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const head = body.subarray(start + 2, headEnd).toString('utf8');
    const next = body.indexOf(boundary, headEnd + 4);
    if (next < 0) break;
    const data = body.subarray(headEnd + 4, next - 2);
    const name = /name="([^"]+)"/.exec(head)?.[1] || '';
    if (/filename="/.test(head)) { if (!file) file = { name, data }; }
    else fields[name] = data.toString('utf8').slice(0, 500);
    pos = next;
  }
  return { fields, file };
}

/* ---------- фото: проверка настоящего формата и сжатие ---------- */
export function sniffImage(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export async function processPhoto(input: Buffer) {
  const kind = sniffImage(input);
  if (!kind) throw new HttpError(422, 'Поддерживаются только JPEG, PNG и WebP', { photo: 'Формат файла не JPEG, PNG или WebP' });
  try {
    const img = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    // EXIF (включая геометку) не сохраняется — sharp по умолчанию не копирует метаданные
    const { data, info } = await img.webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
    return { data, mime: 'image/webp', width: info.width, height: info.height, size: data.length };
  } catch {
    throw new HttpError(422, 'Не удалось прочитать изображение', { photo: 'Файл повреждён или слишком большой (до 40 Мп)' });
  }
}
