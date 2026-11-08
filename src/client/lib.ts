/** Клиентские утилиты: API, локальное хранилище, ключи, тема, конфигурация. */
import type { Settings } from '../shared/config';
import type { CartItem } from '../shared/pricing';

export type PublicConfig = Pick<Settings, 'company' | 'pricing' | 'characters'> & { game: Settings['game'] };

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors: Record<string, string> = {}, public network = false) { super(message); }
}
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as any) };
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  let res: Response;
  try { res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.', {}, true); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Ошибка ${res.status}`, data.errors || {});
  return data as T;
}

export function readConfig(): PublicConfig | null {
  const el = document.getElementById('pp-config');
  try { return el ? JSON.parse(el.textContent || 'null') : null; } catch { return null; }
}

export const store = {
  get<T>(k: string, def: T): T { try { const v = localStorage.getItem('pp:' + k); return v ? (JSON.parse(v) as T) : def; } catch { return def; } },
  set(k: string, v: unknown) { try { localStorage.setItem('pp:' + k, JSON.stringify(v)); } catch { /* приватный режим/квота */ } },
  del(k: string) { try { localStorage.removeItem('pp:' + k); } catch { /* ignore */ } }
};

export const newKey = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

export interface DraftPhoto { id: string; preview: string; name: string }
export interface Draft {
  name: string; phone: string; address: string; outOfTown: boolean; date: string; time: string; comment: string; consent: boolean;
  photos: DraftPhoto[]; draftKey: string; pendingKey: string | null;
}
export const emptyDraft = (): Draft => ({ name: '', phone: '', address: '', outOfTown: false, date: '', time: '', comment: '', consent: false, photos: [], draftKey: newKey(), pendingKey: null });
export const loadCart = () => store.get<CartItem[]>('cart', []);
export const saveCart = (c: CartItem[]) => store.set('cart', c);
export const loadDraft = (): Draft => ({ ...emptyDraft(), ...store.get<Partial<Draft>>('draft', {}) });
export const saveDraft = (d: Draft) => store.set('draft', d);

export function todayLocal() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
export const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

export function fmtDateTime(s: string | null | undefined) {
  if (!s) return '';
  const [d, t] = s.split('T');
  const date = new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
  return t ? `${date}, ${t.slice(0, 5)}` : date;
}
export const fmtStamp = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function makePreview(file: File, size = 160): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const k = size / Math.max(bmp.width, bmp.height); const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return ''; }
}
