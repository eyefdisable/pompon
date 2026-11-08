/** Проверка входных данных — используется сервером (обязательно) и браузером (для подсказок). */
import { CATEGORY_IDS, LIMITS, type CategoryId, type Settings, type Pricing, STATUSES, type Status } from './config';
import type { CartItem } from './pricing';

export type Errors = Record<string, string>;
export type Result<T> = { ok: true; value: T } | { ok: false; errors: Errors };

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);

export function validateItems(raw: unknown, p: Pricing): Result<CartItem[]> {
  const errors: Errors = {};
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, errors: { items: 'Добавьте хотя бы один предмет' } };
  if (raw.length > LIMITS.maxLines) return { ok: false, errors: { items: `Не больше ${LIMITS.maxLines} позиций` } };
  const items: CartItem[] = [];
  raw.forEach((r: any, idx) => {
    const category = r?.category as CategoryId;
    if (!CATEGORY_IDS.includes(category)) { errors[`items.${idx}`] = 'Неизвестная категория'; return; }
    const cat = p.categories[category];
    const qty = int(r.qty);
    if (!(qty >= 1 && qty <= LIMITS.maxQty)) { errors[`items.${idx}`] = `Количество от 1 до ${LIMITS.maxQty}`; return; }
    let variant: string | null = null;
    let description = '';
    if (cat.manual) {
      description = str(r.description, LIMITS.maxDescription);
      if (description.length < 3) { errors[`items.${idx}`] = 'Опишите предмет «Другое» (от 3 символов)'; return; }
    } else {
      variant = str(r.variant, 40);
      if (!cat.variants.some((v) => v.id === variant)) { errors[`items.${idx}`] = 'Выберите вариант'; return; }
    }
    items.push({ category, variant, qty, heavy: r.heavy === true, secondSide: category === 'mattress' && r.secondSide === true, description });
  });
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: items };
}

export interface ClientForm {
  name: string; phone: string; address: string; outOfTown: boolean;
  date: string; time: string; comment: string; consent: boolean;
}

export function normalizePhone(s: string) { return s.replace(/[^\d+]/g, ''); }

/** today — дата «сегодня» в часовом поясе компании (YYYY-MM-DD). */
export function validateClient(raw: any, today: string): Result<ClientForm> {
  const e: Errors = {};
  const v: ClientForm = {
    name: str(raw?.name, 80), phone: str(raw?.phone, 30), address: str(raw?.address, 200),
    outOfTown: raw?.outOfTown === true, date: str(raw?.date, 10), time: str(raw?.time, 5),
    comment: str(raw?.comment, LIMITS.maxComment), consent: raw?.consent === true
  };
  if (v.name.length < 2) e.name = 'Укажите имя';
  const digits = normalizePhone(v.phone).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13 || !/^[\d\s()+-]+$/.test(v.phone)) e.phone = 'Нужен телефон: 10–13 цифр';
  if (v.address.length < 5) e.address = 'Укажите адрес: улица и дом';
  if (v.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || isNaN(Date.parse(v.date + 'T00:00:00Z'))) e.date = 'Неверная дата';
    else if (v.date < today) e.date = 'Дата уже прошла';
    else if (Date.parse(v.date) - Date.parse(today) > 120 * 864e5) e.date = 'Не дальше чем на 4 месяца';
  }
  if (v.time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) e.time = 'Неверное время';
    else if (!v.date) e.time = 'Для времени выберите дату';
  }
  if (!v.consent) e.consent = 'Нужно согласие на обработку данных';
  return Object.keys(e).length ? { ok: false, errors: e } : { ok: true, value: v };
}

const hex = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : NaN; };

export function validateSettings(raw: any, base: Settings): Result<Settings> {
  const e: Errors = {};
  const s: Settings = structuredClone(base);
  if (raw?.company) {
    const c = raw.company;
    for (const k of ['name', 'tagline', 'city', 'territory', 'phone', 'telegram', 'email', 'hours', 'legalName'] as const) {
      if (k in c) (s.company as any)[k] = str(c[k], 160);
    }
    if ('accent' in c) { if (hex.test(c.accent)) s.company.accent = c.accent; else e['company.accent'] = 'Цвет в формате #RRGGBB'; }
    if (!s.company.name) e['company.name'] = 'Название обязательно';
    if (s.company.phone && normalizePhone(s.company.phone).replace(/\D/g, '').length < 10) e['company.phone'] = 'Телефон: минимум 10 цифр или пусто';
    if (s.company.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.company.email)) e['company.email'] = 'Неверный email';
    if (s.company.telegram && !/^@?[A-Za-z0-9_]{4,32}$/.test(s.company.telegram)) e['company.telegram'] = 'Ник Telegram: латиница, цифры, _';
  }
  if (raw?.pricing) {
    const p = raw.pricing;
    const fields: [keyof Pricing, number, number][] = [['minOrder', 0, 100000], ['heavySoilingPct', 0, 300], ['mattressSecondSidePct', 0, 200], ['outOfTownFee', 0, 50000], ['roundTo', 1, 100]];
    for (const [k, mn, mx] of fields) if (k in p) { const n = num(p[k], mn, mx); if (isNaN(n)) e[`pricing.${k}`] = `От ${mn} до ${mx}`; else (s.pricing as any)[k] = n; }
    if (p.categories) for (const id of CATEGORY_IDS) {
      const src = p.categories[id]; if (!src || s.pricing.categories[id].manual) continue;
      s.pricing.categories[id].variants = s.pricing.categories[id].variants.map((v) => {
        const nv = src.variants?.find((x: any) => x.id === v.id);
        if (!nv) return v;
        const price = num(nv.price, 1, 200000);
        if (isNaN(price)) { e[`pricing.${id}.${v.id}`] = 'Цена от 1 до 200 000'; return v; }
        const label = str(nv.label, 40) || v.label;
        return { ...v, price, label };
      });
    }
  }
  if (raw?.game) {
    const g = raw.game;
    if ('mode' in g) { if (['off', 'fun', 'bonus'].includes(g.mode)) s.game.mode = g.mode; else e['game.mode'] = 'Неизвестный режим'; }
    for (const [k, mn, mx] of [['bonusAmount', 1, 10000], ['bonusValidDays', 1, 730], ['bonusMinOrder', 0, 100000]] as const) {
      if (k in g) { const n = num(g[k], mn, mx); if (isNaN(n)) e[`game.${k}`] = `От ${mn} до ${mx}`; else s.game[k] = n; }
    }
  }
  if (raw?.characters) {
    const c = raw.characters;
    if ('preset' in c) { if (['friendly', 'calm', 'cheeky'].includes(c.preset)) s.characters.preset = c.preset; else e['characters.preset'] = 'Неизвестный характер'; }
    if ('faces' in c) s.characters.faces = c.faces === true;
    if ('phrases' in c) s.characters.phrases = c.phrases === true;
  }
  return Object.keys(e).length ? { ok: false, errors: e } : { ok: true, value: s };
}

export interface OwnerUpdate { status?: Status; finalPrice?: number | null; agreedAt?: string | null; note?: string }
export function validateOwnerUpdate(raw: any, current: { status: string; final_price: number | null; agreed_at: string | null }): Result<OwnerUpdate> {
  const e: Errors = {}; const u: OwnerUpdate = {};
  if ('status' in raw) { if ((STATUSES as readonly string[]).includes(raw.status)) u.status = raw.status; else e.status = 'Неизвестный статус'; }
  if ('finalPrice' in raw) {
    if (raw.finalPrice === null || raw.finalPrice === '') u.finalPrice = null;
    else { const n = num(raw.finalPrice, 1, 1000000); if (isNaN(n)) e.finalPrice = 'Цена от 1 ₴'; else u.finalPrice = n; }
  }
  if ('agreedAt' in raw) {
    if (!raw.agreedAt) u.agreedAt = null;
    else if (/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(raw.agreedAt)) u.agreedAt = raw.agreedAt;
    else e.agreedAt = 'Дата и время в формате ГГГГ-ММ-ДДTЧЧ:ММ';
  }
  if ('note' in raw) u.note = str(raw.note, 4000);
  const price = u.finalPrice !== undefined ? u.finalPrice : current.final_price;
  const at = u.agreedAt !== undefined ? u.agreedAt : current.agreed_at;
  const st = u.status ?? current.status;
  if (st === 'agreed' && (!price || !at)) {
    if (!price) e.finalPrice = 'Для «Согласована» укажите итоговую цену';
    if (!at) e.agreedAt = 'Для «Согласована» укажите время визита';
  }
  return Object.keys(e).length ? { ok: false, errors: e } : { ok: true, value: u };
}
