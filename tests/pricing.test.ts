import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, mergeItems, type CartItem } from '../src/shared/pricing';
import { validateClient, validateItems, validateOwnerUpdate } from '../src/shared/validate';
import { DEFAULT_SETTINGS } from '../src/shared/config';

const P = DEFAULT_SETTINGS.pricing; // min 800, heavy 30%, 2-я сторона 60%, выезд 300, шаг 10
const it = (category: CartItem['category'], variant: string | null, qty = 1, o: Partial<CartItem> = {}): CartItem => ({ category, variant, qty, heavy: false, secondSide: false, description: '', ...o });

test('простая позиция выше минимума', () => {
  const q = quote([it('sofa', 'seat3')], P, false);
  assert.equal(q.knownTotal, 1200); assert.equal(q.minApplied, false); assert.equal(q.complete, true);
});
test('минимум применяется к чистке', () => {
  const q = quote([it('chair', 'seat', 2)], P, false);
  assert.equal(q.knownSubtotal, 300); assert.equal(q.cleaning, 800); assert.equal(q.minApplied, true);
});
test('выезд за город добавляется после минимума', () => {
  const q = quote([it('chair', 'seat', 2)], P, true);
  assert.equal(q.cleaning, 800); assert.equal(q.travelFee, 300); assert.equal(q.knownTotal, 1100);
});
test('порядок: вторая сторона → загрязнения → округление → количество', () => {
  // 1000 × 1.6 = 1600; × 1.3 = 2080; округление до 10 = 2080; × 2 = 4160
  const q = quote([it('mattress', 'double', 2, { secondSide: true, heavy: true })], P, false);
  assert.equal(q.lines[0].unit, 2080); assert.equal(q.knownTotal, 4160);
});
test('округление до 10 ₴ половина вверх', () => {
  // 230 × 1.3 = 299 → 300; 150 × 1.3 = 195 → 200
  assert.equal(quote([it('chair', 'seatback', 1, { heavy: true })], P, false).lines[0].unit, 300);
  assert.equal(quote([it('chair', 'seat', 1, { heavy: true })], P, false).lines[0].unit, 200);
});
test('вторая сторона игнорируется не для матраса', () => {
  assert.equal(quote([it('sofa', 'seat2', 1, { secondSide: true })], P, false).lines[0].unit, 900);
});
test('смешанный заказ: известная часть + по фото, минимум не применяется, «Другое» не бесплатно', () => {
  const q = quote([it('chair', 'seat', 1), it('other', null, 2, { description: 'пуф' })], P, false);
  assert.equal(q.knownSubtotal, 150); assert.equal(q.cleaning, 150); assert.equal(q.minApplied, false);
  assert.equal(q.complete, false); assert.equal(q.manualCount, 2);
  const other = q.lines.find((l) => l.category === 'other')!;
  assert.equal(other.sum, null); assert.equal(other.manual, true);
});
test('только «Другое»: известной суммы нет', () => {
  const q = quote([it('other', null, 1, { description: 'коляска' })], P, true);
  assert.equal(q.cleaning, 0); assert.equal(q.travelFee, 300); assert.equal(q.complete, false);
});
test('объединение одинаковых позиций и раздельное хранение разных', () => {
  const m = mergeItems([it('sofa', 'seat3'), it('sofa', 'seat3', 2), it('sofa', 'seat3', 1, { heavy: true }),
    it('other', null, 1, { description: 'Пуф  велюр' }), it('other', null, 1, { description: 'пуф велюр' }), it('other', null, 1, { description: 'коляска' })]);
  assert.equal(m.length, 4);
  assert.equal(m.find((x) => x.category === 'sofa' && !x.heavy)!.qty, 3);
  assert.equal(m.find((x) => x.category === 'other' && x.description.toLowerCase().startsWith('пуф'))!.qty, 2);
});
test('валидация: время без даты, «Другое» без описания, неизвестный вариант', () => {
  const c = validateClient({ name: 'Ан', phone: '+380671112233', address: 'ул. Тестовая, 1', time: '10:00', consent: true }, '2026-01-01');
  assert.equal(c.ok, false); assert.ok(!c.ok && c.errors.time);
  const i = validateItems([{ category: 'other', qty: 1, description: '' }, { category: 'sofa', variant: 'xxx', qty: 1 }], P);
  assert.equal(i.ok, false); assert.ok(!i.ok && i.errors['items.0'] && i.errors['items.1']);
  assert.equal(validateItems([{ category: 'sofa', variant: 'seat2', qty: 0 }], P).ok, false);
});
test('валидация: согласие обязательно, дата в прошлом', () => {
  const c = validateClient({ name: 'Анна', phone: '+380671112233', address: 'ул. Тестовая, 1', date: '2025-12-31' }, '2026-01-01');
  assert.ok(!c.ok && c.errors.consent && c.errors.date);
});
test('«Согласована» требует цену и время', () => {
  const r = validateOwnerUpdate({ status: 'agreed' }, { status: 'new', final_price: null, agreed_at: null });
  assert.ok(!r.ok && r.errors.finalPrice && r.errors.agreedAt);
  assert.equal(validateOwnerUpdate({ status: 'agreed', finalPrice: 1500, agreedAt: '2026-05-01T10:00' }, { status: 'new', final_price: null, agreed_at: null }).ok, true);
  assert.equal(validateOwnerUpdate({ finalPrice: null }, { status: 'agreed', final_price: 1500, agreed_at: '2026-05-01T10:00' }).ok, false);
});
