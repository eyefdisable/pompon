/**
 * Формула расчёта (одна для браузера и сервера; сервер всегда пересчитывает сам).
 *
 * Для каждой позиции с известной ценой:
 *   unit = base
 *   если матрас и «вторая сторона»: unit = unit × (1 + secondSidePct/100)
 *   если «сильные загрязнения»:     unit = unit × (1 + heavyPct/100)
 *   unit округляется до шага roundTo (половина — вверх), затем sum = unit × qty
 * Сумма чистки = Σ sum. Если в заказе нет позиций «по фото» и сумма > 0 —
 *   применяется минимум: cleaning = max(Σ, minOrder).
 * Если есть позиции «по фото» — минимум не применяется к известной части:
 *   итог чистки станет известен после оценки владельцем (и тоже не ниже минимума).
 * Выезд за город — фиксированная доплата ПОСЛЕ минимума, отдельной строкой.
 */
import type { CategoryId, Pricing } from './config';
import { LIMITS } from './config';

export interface CartItem {
  category: CategoryId;
  variant: string | null;      // null для «Другое»
  qty: number;
  heavy: boolean;              // сильные загрязнения
  secondSide: boolean;         // только для матраса
  description: string;         // только для «Другое»
}

export interface QuoteLine {
  key: string; category: CategoryId; variant: string | null;
  title: string; options: string[]; qty: number;
  manual: boolean; unit: number | null; sum: number | null;
}
export interface Quote {
  lines: QuoteLine[];
  knownSubtotal: number;   // Σ известных позиций
  minOrder: number;
  minApplied: boolean;     // сумма поднята до минимума
  cleaning: number;        // сумма чистки с учётом минимума (только известная часть, если есть ручные)
  travelFee: number;       // доплата за город (0, если не нужна)
  knownTotal: number;      // cleaning + travelFee
  manualCount: number;     // сколько предметов «по фото»
  complete: boolean;       // true, если ручных позиций нет
}

export const roundTo = (v: number, step: number) => (step > 0 ? Math.floor(v / step + 0.5) * step : Math.round(v));

export function itemKey(i: CartItem): string {
  const desc = i.category === 'other' ? i.description.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return [i.category, i.variant ?? '-', i.heavy ? 'h' : '', i.category === 'mattress' && i.secondSide ? 's' : '', desc].join('|');
}

/** Объединяет действительно одинаковые позиции, разные настройки оставляет отдельно. */
export function mergeItems(items: CartItem[]): CartItem[] {
  const map = new Map<string, CartItem>();
  for (const it of items) {
    const k = itemKey(it);
    const prev = map.get(k);
    if (prev) prev.qty = Math.min(LIMITS.maxQty, prev.qty + it.qty);
    else map.set(k, { ...it });
  }
  return [...map.values()];
}

export function unitPrice(i: CartItem, p: Pricing): number | null {
  const cat = p.categories[i.category];
  if (!cat || cat.manual) return null;
  const v = cat.variants.find((x) => x.id === i.variant);
  if (!v) return null;
  let unit = v.price;
  if (i.category === 'mattress' && i.secondSide) unit *= 1 + p.mattressSecondSidePct / 100;
  if (i.heavy) unit *= 1 + p.heavySoilingPct / 100;
  return roundTo(unit, p.roundTo);
}

export function describe(i: CartItem, p: Pricing): { title: string; options: string[] } {
  const cat = p.categories[i.category];
  const v = cat?.variants.find((x) => x.id === i.variant);
  const options: string[] = [];
  if (i.category === 'mattress' && i.secondSide) options.push('+ вторая сторона');
  if (i.heavy) options.push('сильные загрязнения');
  const title = i.category === 'other' ? `Другое: ${i.description.trim()}` : `${cat?.label ?? i.category}, ${v?.label.toLowerCase() ?? '?'}`;
  return { title, options };
}

export function quote(items: CartItem[], p: Pricing, outOfTown: boolean): Quote {
  const lines: QuoteLine[] = items.map((i) => {
    const unit = unitPrice(i, p);
    const manual = unit === null;
    const d = describe(i, p);
    return { key: itemKey(i), category: i.category, variant: i.variant, title: d.title, options: d.options, qty: i.qty, manual, unit, sum: manual ? null : unit! * i.qty };
  });
  const knownSubtotal = lines.reduce((a, l) => a + (l.sum ?? 0), 0);
  const manualCount = lines.filter((l) => l.manual).reduce((a, l) => a + l.qty, 0);
  const complete = manualCount === 0;
  const minApplied = complete && knownSubtotal > 0 && knownSubtotal < p.minOrder;
  const cleaning = minApplied ? p.minOrder : knownSubtotal;
  const travelFee = outOfTown && lines.length ? p.outOfTownFee : 0;
  return { lines, knownSubtotal, minOrder: p.minOrder, minApplied, cleaning, travelFee, knownTotal: cleaning + travelFee, manualCount, complete };
}

export const formatUAH = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₴';
