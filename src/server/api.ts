/** REST API: публичная часть (выбор, фото, заявка, статус, игра) и кабинет владельца. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { db, env, getSettings, saveSettings, todayLocal, sha256, orderToken, randomToken, rateLimit, ensureOwner,
  createSession, checkSession, verifyPassword, hashPassword, SESSION_COOKIE, SESSION_DAYS } from './core';
import { HttpError, json, readJson, readMultipart, processPhoto, cookies, setCookie, clientIp, checkOrigin } from './http';
import { quote } from '../shared/pricing';
import { validateItems, validateClient, validateSettings, validateOwnerUpdate } from '../shared/validate';
import { LIMITS, STATUS_LABEL, type Settings, type Status } from '../shared/config';
import { PgError } from './pg';

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; ip: string };

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isKey = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(s);

async function limit(ctx: Ctx, bucket: string, max: number, windowMin: number) {
  if (!(await rateLimit(`${bucket}:${ctx.ip}`, max, windowMin))) throw new HttpError(429, 'Слишком много запросов. Попробуйте через несколько минут.');
}

export function publicConfig(s: Settings) {
  const { company, pricing, game, characters } = s;
  return { company, pricing, characters, game: { mode: game.mode, bonusAmount: game.bonusAmount, bonusValidDays: game.bonusValidDays, bonusMinOrder: game.bonusMinOrder } };
}

/* ======================= ПУБЛИЧНЫЕ ======================= */

async function uploadPhoto(ctx: Ctx) {
  checkOrigin(ctx.req);
  await limit(ctx, 'photo', 40, 10);
  const { fields, file } = await readMultipart(ctx.req);
  if (!isKey(fields.draftKey)) throw new HttpError(400, 'Нет ключа черновика');
  if (!file || !file.data.length) throw new HttpError(422, 'Файл не получен', { photo: 'Выберите файл' });
  const p = await processPhoto(file.data);
  const draftHash = sha256('draft:' + fields.draftKey);
  const cnt = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM photos WHERE draft_hash = $1 AND order_id IS NULL', [draftHash]);
  if (cnt.rows[0].n >= 12) throw new HttpError(429, 'Слишком много загрузок для одного черновика');
  const r = await db().query<{ id: string }>('INSERT INTO photos (draft_hash, mime, width, height, size, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [draftHash, p.mime, p.width, p.height, p.size, p.data]);
  db().query("DELETE FROM photos WHERE order_id IS NULL AND created_at < now() - interval '1 day'").catch(() => {});
  json(ctx.res, 201, { id: r.rows[0].id, width: p.width, height: p.height, size: p.size });
}

async function deletePhoto(ctx: Ctx, id: string) {
  checkOrigin(ctx.req);
  const body = await readJson(ctx.req);
  if (!isUuid(id) || !isKey(body.draftKey)) throw new HttpError(400, 'Неверный запрос');
  await db().query('DELETE FROM photos WHERE id = $1 AND draft_hash = $2 AND order_id IS NULL', [id, sha256('draft:' + body.draftKey)]);
  json(ctx.res, 200, { ok: true });
}

async function createOrder(ctx: Ctx) {
  checkOrigin(ctx.req);
  await limit(ctx, 'order', 12, 10);
  const body = await readJson(ctx.req);
  if (!isKey(body.idempotencyKey) || !isKey(body.draftKey)) throw new HttpError(400, 'Нет ключа запроса');
  const s = await getSettings(true);
  const items = validateItems(body.items, s.pricing);
  const client = validateClient(body.client, todayLocal());
  const errors = { ...(items.ok ? {} : items.errors), ...(client.ok ? {} : client.errors) };
  const photoIds: string[] = Array.isArray(body.photoIds) ? body.photoIds.filter((x: unknown) => typeof x === 'string' && isUuid(x)) : [];
  if (photoIds.length > LIMITS.maxPhotos) errors.photos = `Не больше ${LIMITS.maxPhotos} фото`;
  if (items.ok && items.value.some((i) => i.category === 'other') && photoIds.length === 0) errors.photos = 'Для «Другое» приложите хотя бы одно фото';
  if (Object.keys(errors).length) throw new HttpError(422, 'Проверьте поля формы', errors);
  if (!items.ok || !client.ok) throw new HttpError(422, 'Проверьте поля формы');

  // сервер считает сам; сумма из браузера игнорируется
  const q = quote(items.value, s.pricing, client.value.outOfTown);
  const payloadHash = sha256(JSON.stringify({ i: items.value, c: client.value, p: [...photoIds].sort() }));
  const token = orderToken(body.idempotencyKey);
  const draftHash = sha256('draft:' + body.draftKey);

  const result = await db().tx(async (t) => {
    const ins = await t.query<{ id: number; number: string }>(
      `WITH n AS (SELECT nextval('orders_id_seq') AS id)
       INSERT INTO orders (id, number, token_hash, idempotency_key, payload_hash, client, items, quote, pricing_snapshot)
       SELECT n.id, 'П-' || lpad(n.id::text, 5, '0'), $1, $2, $3, $4, $5, $6, $7 FROM n
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, number`,
      [sha256(token), body.idempotencyKey, payloadHash, { ...client.value, consentAt: new Date().toISOString() }, items.value, q, s.pricing]);
    if (!ins.rows.length) {
      // повтор после сбоя сети: тот же ключ — та же заявка, без дубля
      const ex = await t.query<{ id: number; number: string; payload_hash: string }>('SELECT id, number, payload_hash FROM orders WHERE idempotency_key = $1', [body.idempotencyKey]);
      const o = ex.rows[0];
      if (!o || o.payload_hash !== payloadHash) throw new HttpError(409, 'Этот ключ уже использован для другой заявки. Обновите страницу.');
      return { number: o.number, replay: true };
    }
    const order = ins.rows[0];
    if (photoIds.length) {
      const up = await t.query('UPDATE photos SET order_id = $1 WHERE id = ANY($2::uuid[]) AND draft_hash = $3 AND order_id IS NULL', [order.id, `{${photoIds.join(',')}}`, draftHash]);
      if (up.rowCount !== photoIds.length) throw new HttpError(422, 'Часть фото не найдена — загрузите их заново', { photos: 'Фото устарели или загружены с другого устройства. Загрузите заново.' });
    }
    await t.query("INSERT INTO order_events (order_id, actor, kind, data) VALUES ($1, 'client', 'created', $2)", [order.id, { knownTotal: q.knownTotal, manual: q.manualCount }]);
    return { number: order.number, replay: false };
  });
  json(ctx.res, result.replay ? 200 : 201, { token, number: result.number, replay: result.replay });
}

const PUBLIC_EVENTS = new Set(['created', 'status', 'price', 'time', 'bonus']);

async function loadByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const r = await db().query('SELECT * FROM orders WHERE token_hash = $1', [sha256(token)]);
  return r.rows[0] ?? null;
}

async function getOrderPublic(ctx: Ctx, token: string) {
  await limit(ctx, 'view', 240, 10);
  const o = await loadByToken(token);
  if (!o) throw new HttpError(404, 'Заявка не найдена');
  const s = await getSettings();
  const ev = await db().query('SELECT at, kind, data FROM order_events WHERE order_id = $1 ORDER BY at', [o.id]);
  const ph = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM photos WHERE order_id = $1', [o.id]);
  const bonus = await db().query('SELECT code, amount, min_order, expires_at, status FROM bonus_codes WHERE order_id = $1', [o.id]);
  json(ctx.res, 200, {
    number: o.number, status: o.status, statusLabel: STATUS_LABEL[o.status as Status],
    createdAt: o.created_at, updatedAt: o.updated_at,
    items: o.items, quote: o.quote, finalPrice: o.final_price, agreedAt: o.agreed_at,
    wish: { date: o.client.date, time: o.client.time, outOfTown: o.client.outOfTown },
    photoCount: ph.rows[0].n,
    history: ev.rows.filter((e) => PUBLIC_EVENTS.has(e.kind)).map((e) => ({ at: e.at, kind: e.kind, data: e.kind === 'status' ? { to: e.data.to } : e.data })),
    company: { name: s.company.name, phone: s.company.phone, telegram: s.company.telegram, email: s.company.email, hours: s.company.hours },
    game: { mode: s.game.mode, played: !!o.game, bonus: bonus.rows[0] ?? null, terms: { amount: s.game.bonusAmount, days: s.game.bonusValidDays, minOrder: s.game.bonusMinOrder } },
    characters: s.characters
  });
}

async function finishGame(ctx: Ctx, token: string) {
  checkOrigin(ctx.req);
  await limit(ctx, 'game', 20, 10);
  const o = await loadByToken(token);
  if (!o) throw new HttpError(404, 'Заявка не найдена');
  const body = await readJson(ctx.req);
  const s = await getSettings(true);
  if (s.game.mode === 'off') throw new HttpError(409, 'Игра выключена');
  const ms = Number(body.durationMs);
  // простая проверка правдоподобия; это не защищённый античит
  if (!(ms > 3000 && ms < 3600_000)) throw new HttpError(422, 'Игра не засчитана');
  await db().query('UPDATE orders SET game = COALESCE(game, $2) WHERE id = $1', [o.id, { finishedAt: new Date().toISOString(), durationMs: ms }]);
  let bonus = null;
  if (s.game.mode === 'bonus' && o.status !== 'cancelled') {
    const code = 'PP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const r = await db().query(
      `INSERT INTO bonus_codes (order_id, code, amount, min_order, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5::int))
       ON CONFLICT (order_id) DO NOTHING RETURNING code`, [o.id, code, s.game.bonusAmount, s.game.bonusMinOrder, s.game.bonusValidDays]);
    if (r.rows.length) await db().query("INSERT INTO order_events (order_id, actor, kind, data) VALUES ($1,'system','bonus',$2)", [o.id, { amount: s.game.bonusAmount }]);
    bonus = (await db().query('SELECT code, amount, min_order, expires_at, status FROM bonus_codes WHERE order_id = $1', [o.id])).rows[0];
  }
  json(ctx.res, 200, { ok: true, bonus });
}

/* ======================= КАБИНЕТ ======================= */

async function requireOwner(ctx: Ctx) {
  if (!(await checkSession(cookies(ctx.req)[SESSION_COOKIE]))) throw new HttpError(401, 'Нужен вход в кабинет');
}

async function login(ctx: Ctx) {
  checkOrigin(ctx.req);
  await limit(ctx, 'login', 8, 15);
  const body = await readJson(ctx.req);
  if (!(await ensureOwner())) throw new HttpError(503, 'Кабинет не настроен: задайте OWNER_INITIAL_PASSWORD (от 10 символов) и перезапустите сервер');
  const r = await db().query<{ password_hash: string }>('SELECT password_hash FROM owner_account WHERE id = 1');
  if (typeof body.password !== 'string' || !verifyPassword(body.password, r.rows[0].password_hash)) throw new HttpError(401, 'Неверный пароль', { password: 'Неверный пароль' });
  const token = await createSession(String(ctx.req.headers['user-agent'] || ''));
  setCookie(ctx.res, SESSION_COOKIE, token, SESSION_DAYS * 86400, ctx.req);
  json(ctx.res, 200, { ok: true });
}
async function logout(ctx: Ctx) {
  checkOrigin(ctx.req);
  const t = cookies(ctx.req)[SESSION_COOKIE];
  if (t) await db().query('DELETE FROM owner_sessions WHERE token_hash = $1', [sha256(t)]);
  setCookie(ctx.res, SESSION_COOKIE, '', 0, ctx.req);
  json(ctx.res, 200, { ok: true });
}
async function changePassword(ctx: Ctx) {
  checkOrigin(ctx.req); await requireOwner(ctx);
  await limit(ctx, 'login', 8, 15);
  const b = await readJson(ctx.req);
  const r = await db().query<{ password_hash: string }>('SELECT password_hash FROM owner_account WHERE id = 1');
  if (typeof b.current !== 'string' || !verifyPassword(b.current, r.rows[0].password_hash)) throw new HttpError(422, 'Текущий пароль неверный', { current: 'Текущий пароль неверный' });
  if (typeof b.next !== 'string' || b.next.length < 10 || b.next.length > 200) throw new HttpError(422, 'Новый пароль — от 10 символов', { next: 'Минимум 10 символов' });
  await db().tx(async (t) => {
    await t.query('UPDATE owner_account SET password_hash = $1, changed_at = now() WHERE id = 1', [hashPassword(b.next)]);
    await t.query('DELETE FROM owner_sessions'); // закрываем все прежние сеансы, включая другие устройства
  });
  const token = await createSession(String(ctx.req.headers['user-agent'] || ''));
  setCookie(ctx.res, SESSION_COOKIE, token, SESSION_DAYS * 86400, ctx.req);
  json(ctx.res, 200, { ok: true });
}

async function listOrders(ctx: Ctx) {
  await requireOwner(ctx);
  const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 80);
  const status = ctx.url.searchParams.get('status') || '';
  const params: any[] = []; const where: string[] = [];
  if (status && STATUS_LABEL[status as Status]) { params.push(status); where.push(`status = $${params.length}`); }
  if (q) {
    params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%');
    const p = `$${params.length}`;
    const digits = q.replace(/\D/g, '');
    let phoneClause = '';
    if (digits.length >= 3) { params.push('%' + digits + '%'); phoneClause = ` OR regexp_replace(client->>'phone','\\D','','g') LIKE $${params.length}`; }
    where.push(`(number ILIKE ${p} OR client->>'name' ILIKE ${p} OR client->>'address' ILIKE ${p}${phoneClause})`);
  }
  const r = await db().query(
    `SELECT id, number, status, created_at, updated_at, client->>'name' AS name, client->>'phone' AS phone, client->>'address' AS address,
       (quote->>'knownTotal')::int AS known_total, (quote->>'manualCount')::int AS manual_count, final_price, agreed_at,
       (SELECT count(*)::int FROM photos p WHERE p.order_id = orders.id) AS photos
     FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`, params);
  const counts = await db().query(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`);
  json(ctx.res, 200, { orders: r.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) });
}

async function getOrderAdmin(ctx: Ctx, id: number) {
  await requireOwner(ctx);
  const r = await db().query('SELECT id, number, status, client, items, quote, pricing_snapshot, final_price, agreed_at, owner_note, game, created_at, updated_at FROM orders WHERE id = $1', [id]);
  if (!r.rows.length) throw new HttpError(404, 'Заявка не найдена');
  const photos = await db().query('SELECT id, width, height, size FROM photos WHERE order_id = $1 ORDER BY created_at', [id]);
  const ev = await db().query('SELECT at, actor, kind, data FROM order_events WHERE order_id = $1 ORDER BY at', [id]);
  const bonus = await db().query('SELECT id, code, amount, min_order, expires_at, status FROM bonus_codes WHERE order_id = $1', [id]);
  json(ctx.res, 200, { order: r.rows[0], photos: photos.rows, events: ev.rows, bonus: bonus.rows[0] ?? null });
}

async function updateOrder(ctx: Ctx, id: number) {
  checkOrigin(ctx.req); await requireOwner(ctx);
  const body = await readJson(ctx.req);
  await db().tx(async (t) => {
    const cur = await t.query('SELECT status, final_price, agreed_at, owner_note FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const c = cur.rows[0];
    if (!c) throw new HttpError(404, 'Заявка не найдена');
    const v = validateOwnerUpdate(body, c as any);
    if (!v.ok) throw new HttpError(422, 'Проверьте поля', v.errors);
    const u = v.value; const events: [string, any][] = [];
    if (u.status !== undefined && u.status !== c.status) events.push(['status', { from: c.status, to: u.status }]);
    if (u.finalPrice !== undefined && u.finalPrice !== c.final_price) events.push(['price', { finalPrice: u.finalPrice }]);
    if (u.agreedAt !== undefined && u.agreedAt !== c.agreed_at) events.push(['time', { agreedAt: u.agreedAt }]);
    if (u.note !== undefined && u.note !== c.owner_note) events.push(['note', {}]);
    await t.query(`UPDATE orders SET status = COALESCE($2, status),
        final_price = CASE WHEN $3::bool THEN $4::int ELSE final_price END,
        agreed_at = CASE WHEN $5::bool THEN $6 ELSE agreed_at END,
        owner_note = COALESCE($7, owner_note), updated_at = now() WHERE id = $1`,
      [id, u.status ?? null, u.finalPrice !== undefined, u.finalPrice ?? null, u.agreedAt !== undefined, u.agreedAt ?? null, u.note ?? null]);
    for (const [kind, data] of events) await t.query("INSERT INTO order_events (order_id, actor, kind, data) VALUES ($1,'owner',$2,$3)", [id, kind, data]);
  });
  await getOrderAdmin(ctx, id);
}

async function deleteOrder(ctx: Ctx, id: number) {
  checkOrigin(ctx.req); await requireOwner(ctx);
  const body = await readJson(ctx.req);
  const r = await db().query<{ number: string }>('SELECT number FROM orders WHERE id = $1', [id]);
  if (!r.rows.length) throw new HttpError(404, 'Заявка не найдена');
  if (body.confirmNumber !== r.rows[0].number) throw new HttpError(422, 'Для удаления введите номер заявки', { confirmNumber: `Введите ${r.rows[0].number}` });
  await db().query('DELETE FROM orders WHERE id = $1', [id]); // фото, события и бонус удаляются каскадно
  json(ctx.res, 200, { ok: true });
}

async function photoAdmin(ctx: Ctx, id: string) {
  await requireOwner(ctx);
  if (!isUuid(id)) throw new HttpError(404, 'Нет фото');
  const r = await db().query('SELECT mime, data FROM photos WHERE id = $1 AND order_id IS NOT NULL', [id]);
  if (!r.rows.length) throw new HttpError(404, 'Нет фото');
  ctx.res.writeHead(200, { 'Content-Type': r.rows[0].mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
  ctx.res.end(r.rows[0].data);
}

async function settingsAdmin(ctx: Ctx) {
  await requireOwner(ctx);
  if (ctx.req.method === 'GET') return json(ctx.res, 200, await getSettings(true));
  checkOrigin(ctx.req);
  const body = await readJson(ctx.req);
  const v = validateSettings(body, await getSettings(true));
  if (!v.ok) throw new HttpError(422, 'Проверьте поля', v.errors);
  await saveSettings(v.value);
  json(ctx.res, 200, v.value);
}

async function bonusAdmin(ctx: Ctx, id: number) {
  checkOrigin(ctx.req); await requireOwner(ctx);
  const b = await readJson(ctx.req);
  if (!['issued', 'redeemed', 'void'].includes(b.status)) throw new HttpError(422, 'Неверный статус бонуса');
  await db().query('UPDATE bonus_codes SET status = $2 WHERE id = $1', [id, b.status]);
  json(ctx.res, 200, { ok: true });
}

/* ======================= МАРШРУТИЗАЦИЯ ======================= */

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const ctx: Ctx = { req, res, url, ip: clientIp(req) };
  const p = url.pathname; const m = req.method || 'GET';
  let mm: RegExpExecArray | null;
  try {
    if (p === '/api/public/config' && m === 'GET') return json(res, 200, publicConfig(await getSettings()));
    if (p === '/api/photos' && m === 'POST') return await uploadPhoto(ctx);
    if ((mm = /^\/api\/photos\/([\w-]+)$/.exec(p)) && m === 'DELETE') return await deletePhoto(ctx, mm[1]);
    if (p === '/api/orders' && m === 'POST') return await createOrder(ctx);
    if ((mm = /^\/api\/orders\/([\w-]+)$/.exec(p)) && m === 'GET') return await getOrderPublic(ctx, mm[1]);
    if ((mm = /^\/api\/orders\/([\w-]+)\/game$/.exec(p)) && m === 'POST') return await finishGame(ctx, mm[1]);

    if (p === '/api/admin/login' && m === 'POST') return await login(ctx);
    if (p === '/api/admin/logout' && m === 'POST') return await logout(ctx);
    if (p === '/api/admin/me' && m === 'GET') { await requireOwner(ctx); return json(res, 200, { ok: true }); }
    if (p === '/api/admin/password' && m === 'POST') return await changePassword(ctx);
    if (p === '/api/admin/orders' && m === 'GET') return await listOrders(ctx);
    if ((mm = /^\/api\/admin\/orders\/(\d+)$/.exec(p))) {
      const id = Number(mm[1]);
      if (m === 'GET') return await getOrderAdmin(ctx, id);
      if (m === 'PATCH') return await updateOrder(ctx, id);
      if (m === 'DELETE') return await deleteOrder(ctx, id);
    }
    if ((mm = /^\/api\/admin\/photos\/([\w-]+)$/.exec(p)) && m === 'GET') return await photoAdmin(ctx, mm[1]);
    if (p === '/api/admin/settings' && (m === 'GET' || m === 'PUT')) return await settingsAdmin(ctx);
    if ((mm = /^\/api\/admin\/bonus\/(\d+)$/.exec(p)) && m === 'POST') return await bonusAdmin(ctx, Number(mm[1]));
    throw new HttpError(404, 'Не найдено');
  } catch (e: any) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message, errors: e.errors });
    console.error('[api]', m, p, e instanceof PgError ? `${e.code} ${e.message}` : e);
    json(res, 500, { error: 'Внутренняя ошибка сервера. Попробуйте ещё раз.' });
  }
}

export { randomToken, env };
