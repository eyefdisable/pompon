/** Клиентская часть: выбор мебели, корзина, оформление, приватная страница заявки, игра. */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORY_IDS, LIMITS, STATUS_LABEL, type CategoryId, type Status } from '../shared/config';
import { quote, mergeItems, unitPrice, formatUAH, type CartItem, type Quote } from '../shared/pricing';
import { validateClient, validateItems } from '../shared/validate';
import { Stage3D, type StageHandle } from './Stage3D';
import { QuoteView } from './app-quote';
import { api, ApiError, readConfig, loadCart, saveCart, loadDraft, saveDraft, emptyDraft, newKey, todayLocal, fmtDateTime, fmtStamp, makePreview, store, type PublicConfig, type Draft, type DraftPhoto } from './lib';

const VERSION = (document.querySelector('script[src*="/assets/app.js"]') as HTMLScriptElement | null)?.src.split('v=')[1] ?? '';
const ICON: Record<CategoryId, string> = { sofa: '🛋️', armchair: '💺', mattress: '🛏️', chair: '🪑', other: '✨' };

/* ======================= общие кусочки ======================= */

function Toast({ text, action, onAction, onClose }: { text: string; action?: string; onAction?(): void; onClose(): void }) {
  useEffect(() => { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); }, [text, onClose]);
  return <div className="toast" role="status"><span>{text}</span>{action && <button type="button" className="toast-action" onClick={onAction}>{action}</button>}<button type="button" className="toast-x" aria-label="Закрыть" onClick={onClose}>×</button></div>;
}
function Stepper({ value, onChange, min = 1, max = LIMITS.maxQty, label }: { value: number; onChange(v: number): void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Меньше">−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Больше">+</button>
    </div>
  );
}
function Toggle({ checked, onChange, children, hint }: { checked: boolean; onChange(v: boolean): void; children: React.ReactNode; hint?: string }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="toggle-ui" aria-hidden="true" /><span>{children}{hint && <small className="muted"> {hint}</small>}</span></label>;
}

/* ======================= выбор и корзина ======================= */

interface Cfg { variant: string | null; qty: number; heavy: boolean; secondSide: boolean; description: string }
const defaultCfg = (c: PublicConfig, id: CategoryId): Cfg => ({ variant: c.pricing.categories[id].variants[0]?.id ?? null, qty: id === 'chair' ? 4 : 1, heavy: false, secondSide: false, description: '' });

function Shop({ cfg }: { cfg: PublicConfig }) {
  const P = cfg.pricing;
  const initialCat = (() => { const c = new URLSearchParams(location.search).get('c') as CategoryId; return CATEGORY_IDS.includes(c) ? c : store.get<CategoryId>('cat', 'sofa'); })();
  const [cat, setCat] = useState<CategoryId>(initialCat);
  const [configs, setConfigs] = useState<Record<CategoryId, Cfg>>(() => Object.fromEntries(CATEGORY_IDS.map((id) => [id, defaultCfg(cfg, id)])) as any);
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [view, setView] = useState<'select' | 'checkout'>(location.hash === '#zakaz' && loadCart().length ? 'checkout' : 'select');
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [descErr, setDescErr] = useState('');
  const stage = useRef<StageHandle>(null);

  useEffect(() => { saveCart(cart); document.querySelectorAll('[data-order-link]').forEach((a) => { a.textContent = cart.length ? `Заказ · ${cart.reduce((s, i) => s + i.qty, 0)}` : 'Заказ'; }); }, [cart]);
  useEffect(() => { store.set('cat', cat); }, [cat]);
  useEffect(() => {
    const onHash = () => { if (location.hash === '#zakaz') setView('checkout'); else if (location.hash === '#vybor') setView('select'); };
    window.addEventListener('hashchange', onHash);
    const links = document.querySelectorAll('[data-order-link]');
    const click = (e: Event) => { e.preventDefault(); setView('checkout'); history.replaceState(null, '', '#zakaz'); window.scrollTo({ top: 0 }); };
    links.forEach((l) => l.addEventListener('click', click));
    return () => { window.removeEventListener('hashchange', onHash); links.forEach((l) => l.removeEventListener('click', click)); };
  }, []);

  const c = configs[cat];
  const setC = (patch: Partial<Cfg>) => setConfigs((s) => ({ ...s, [cat]: { ...s[cat], ...patch } }));
  const preview: CartItem = { category: cat, variant: c.variant, qty: c.qty, heavy: c.heavy, secondSide: cat === 'mattress' && c.secondSide, description: c.description };
  const unit = unitPrice(preview, P);
  const q = useMemo(() => quote(cart, P, loadDraft().outOfTown), [cart, P]);

  function add() {
    if (cat === 'other' && c.description.trim().length < 3) { setDescErr('Опишите предмет: что это и из какой ткани'); return; }
    setDescErr('');
    setCart((cs) => mergeItems([...cs, { ...preview, description: preview.description.trim() }]));
    setToast({ text: `${P.categories[cat].label} — в заказе` });
    stage.current?.stage?.greet();
    if (cat === 'other') setC({ description: '' });
  }
  function remove(idx: number) {
    const removed = cart[idx]; const before = cart;
    setCart(cart.filter((_, i) => i !== idx));
    setToast({ text: 'Позиция удалена', undo: () => { setCart(before); setToast(null); } });
    void removed;
  }
  function update(idx: number, patch: Partial<CartItem>) { setCart((cs) => mergeItems(cs.map((it, i) => (i === idx ? { ...it, ...patch } : it)))); }

  const sizeNote = cat === 'sofa' || cat === 'mattress' || cat === 'armchair' || cat === 'chair' ? 'Модель показывает категорию — размер и вариант влияют на цену, а не на 3D.' : 'Пуф — пример. Опишите ваш предмет и приложите фото.';

  return (
    <>
      {view === 'select' ? (
        <section className="shop" id="vybor" aria-labelledby="shop-h">
          <div className="shop-head">
            <p className="eyebrow">{cfg.company.tagline} · {cfg.company.city}</p>
            <h1 id="shop-h">Мебель снова свежая — без вывоза из дома</h1>
          </div>
          <div className="shop-grid">
            <div className="shop-stage">
              <Stage3D ref={stage} category={cat} characters={cfg.characters} label={P.categories[cat].label} caption={sizeNote} version={VERSION} />
            </div>
            <div className="panel config" aria-live="polite">
              <div className="cat-tabs" role="tablist" aria-label="Категория">
                {CATEGORY_IDS.map((id) => (
                  <button key={id} role="tab" type="button" aria-selected={id === cat} className={id === cat ? 'on' : ''} onClick={() => setCat(id)}>
                    <span aria-hidden="true">{ICON[id]}</span>{P.categories[id].label}
                  </button>))}
              </div>
              {P.categories[cat].manual ? (
                <div className="field">
                  <label htmlFor="other-desc">Что почистить?</label>
                  <textarea id="other-desc" rows={3} maxLength={LIMITS.maxDescription} value={c.description} placeholder="Например: пуф велюровый, детское автокресло, мягкое изголовье 160 см"
                    onChange={(e) => { setC({ description: e.target.value }); if (descErr) setDescErr(''); }} aria-invalid={!!descErr} aria-describedby="other-desc-err" />
                  <small id="other-desc-err" className="err">{descErr}</small>
                  <p className="hint">Стоимость — <b>по фото</b>: приложите хотя бы одно при оформлении.</p>
                </div>
              ) : (
                <div className="field">
                  <span className="label">Вариант</span>
                  <div className="chips" role="radiogroup" aria-label="Вариант">
                    {P.categories[cat].variants.map((v) => (
                      <button key={v.id} type="button" role="radio" aria-checked={c.variant === v.id} className={`chip-opt${c.variant === v.id ? ' on' : ''}`} onClick={() => setC({ variant: v.id })}>
                        <span>{v.label}</span><small>{formatUAH(v.price)}</small>
                      </button>))}
                  </div>
                </div>
              )}
              <div className="field row">
                <span className="label">Количество</span>
                <Stepper value={c.qty} onChange={(qty) => setC({ qty })} label="Количество" />
              </div>
              {cat === 'mattress' && <Toggle checked={c.secondSide} onChange={(v) => setC({ secondSide: v })} hint={`+${P.mattressSecondSidePct}%`}>Почистить вторую сторону</Toggle>}
              <Toggle checked={c.heavy} onChange={(v) => setC({ heavy: v })} hint={`+${P.heavySoilingPct}%`}>Сильные загрязнения: пятна, запах, шерсть</Toggle>
              <div className="config-price">
                <span>{unit === null ? 'Стоимость' : c.qty > 1 ? `${formatUAH(unit)} × ${c.qty}` : 'Цена'}</span>
                <strong>{unit === null ? 'По фото' : formatUAH(unit * c.qty)}</strong>
              </div>
              <button className="btn btn-primary btn-block" type="button" onClick={add}>Добавить в заказ</button>
              {cart.length > 0 && (
                <button className="cart-peek" type="button" onClick={() => { setView('checkout'); history.replaceState(null, '', '#zakaz'); window.scrollTo({ top: 0 }); }}>
                  <span>В заказе: {cart.reduce((s, i) => s + i.qty, 0)} предм.</span>
                  <b>{q.complete ? formatUAH(q.knownTotal) : (q.knownTotal ? formatUAH(q.knownTotal) + ' + по фото' : 'по фото')}</b>
                  <span className="arrow">Оформить →</span>
                </button>)}
            </div>
          </div>
        </section>
      ) : (
        <Checkout cfg={cfg} cart={cart} onBack={() => { setView('select'); history.replaceState(null, '', '#vybor'); }} onRemove={remove} onUpdate={update} onSent={() => setCart([])} />
      )}
      {toast && <Toast text={toast.text} action={toast.undo ? 'Вернуть' : undefined} onAction={toast.undo} onClose={() => setToast(null)} />}
    </>
  );
}

function CartLine({ it, P, onRemove, onUpdate }: { it: CartItem; P: PublicConfig['pricing']; onRemove(): void; onUpdate(p: Partial<CartItem>): void }) {
  const cat = P.categories[it.category]; const unit = unitPrice(it, P);
  return (
    <li className="cart-line">
      <div className="cart-line-head">
        <span className="cart-ico" aria-hidden="true">{ICON[it.category]}</span>
        <div className="cart-line-title">
          <b>{cat.label}</b>
          {cat.manual ? <span className="muted small">{it.description}</span> : (
            <select aria-label="Вариант" value={it.variant ?? ''} onChange={(e) => onUpdate({ variant: e.target.value })}>
              {cat.variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>)}
        </div>
        <b className={`cart-sum${unit === null ? ' manual' : ''}`}>{unit === null ? 'по фото' : formatUAH(unit * it.qty)}</b>
      </div>
      <div className="cart-line-opts">
        <Stepper value={it.qty} onChange={(qty) => onUpdate({ qty })} label={`Количество: ${cat.label}`} />
        {it.category === 'mattress' && <Toggle checked={it.secondSide} onChange={(v) => onUpdate({ secondSide: v })}>2-я сторона</Toggle>}
        <Toggle checked={it.heavy} onChange={(v) => onUpdate({ heavy: v })}>Сильные загрязнения</Toggle>
        <button type="button" className="link danger" onClick={onRemove}>Удалить</button>
      </div>
    </li>
  );
}

/* ======================= фото ======================= */

interface PhotoTile extends DraftPhoto { state: 'uploading' | 'done' | 'error'; error?: string; file?: File; local: string }

function PhotoField({ draftKey, initial, onChange, error, required }: { draftKey: string; initial: DraftPhoto[]; onChange(p: DraftPhoto[]): void; error?: string; required: boolean }) {
  const [tiles, setTiles] = useState<PhotoTile[]>(() => initial.map((p) => ({ ...p, state: 'done', local: p.preview })));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { onChange(tiles.filter((t) => t.state === 'done').map(({ id, preview, name }) => ({ id, preview, name }))); }, [tiles]); // eslint-disable-line

  async function upload(tile: PhotoTile) {
    setTiles((ts) => ts.map((t) => (t.local === tile.local ? { ...t, state: 'uploading', error: undefined } : t)));
    const fd = new FormData(); fd.append('draftKey', draftKey); fd.append('photo', tile.file!, tile.name);
    try {
      const r = await api<{ id: string }>('/api/photos', { method: 'POST', body: fd });
      setTiles((ts) => ts.map((t) => (t.local === tile.local ? { ...t, id: r.id, state: 'done' } : t)));
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.errors.photo || e.message) : 'Не удалось загрузить';
      setTiles((ts) => ts.map((t) => (t.local === tile.local ? { ...t, state: 'error', error: msg } : t)));
    }
  }
  async function pick(files: FileList | null) {
    if (!files) return;
    const free = LIMITS.maxPhotos - tiles.length;
    const list = Array.from(files).slice(0, free);
    for (const f of list) {
      const okType = ['image/jpeg', 'image/png', 'image/webp'].includes(f.type);
      const local = URL.createObjectURL(f);
      const tile: PhotoTile = { id: '', name: f.name, preview: await makePreview(f), local, file: f, state: 'uploading' };
      if (!okType || f.size > LIMITS.maxPhotoBytes) {
        setTiles((ts) => [...ts, { ...tile, state: 'error', error: !okType ? 'Только JPEG, PNG или WebP' : 'Файл больше 10 МБ' }]); continue;
      }
      setTiles((ts) => [...ts, tile]); upload(tile);
    }
    if (input.current) input.current.value = '';
  }
  async function removeTile(t: PhotoTile) {
    setTiles((ts) => ts.filter((x) => x.local !== t.local));
    if (t.id) api(`/api/photos/${t.id}`, { method: 'DELETE', json: { draftKey } }).catch(() => {});
  }
  return (
    <div className="field">
      <span className="label" id="photos-l">Фото мебели {required ? <em className="req">обязательно для «Другое»</em> : <small className="muted">до {LIMITS.maxPhotos}, по желанию</small>}</span>
      <div className="photos" aria-labelledby="photos-l">
        {tiles.map((t) => (
          <figure key={t.local} className={`photo photo-${t.state}`}>
            {t.local || t.preview ? <img src={t.local || t.preview} alt={t.name} /> : <div className="photo-blank" />}
            {t.state === 'uploading' && <span className="photo-badge"><span className="spinner" /> Загрузка</span>}
            {t.state === 'error' && <figcaption><span>{t.error}</span>{t.file && !/JPEG|10 МБ/.test(t.error || '') && <button type="button" className="link" onClick={() => upload(t)}>Повторить</button>}</figcaption>}
            <button type="button" className="photo-x" aria-label={`Удалить фото ${t.name}`} onClick={() => removeTile(t)}>×</button>
          </figure>))}
        {tiles.length < LIMITS.maxPhotos && (
          <label className="photo-add">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pick(e.target.files)} aria-describedby="photos-err" />
            <span aria-hidden="true">＋</span><small>Добавить фото</small>
          </label>)}
      </div>
      <small id="photos-err" className="err">{error}</small>
    </div>
  );
}

/* ======================= оформление ======================= */

function Checkout({ cfg, cart, onBack, onRemove, onUpdate, onSent }: { cfg: PublicConfig; cart: CartItem[]; onBack(): void; onRemove(i: number): void; onUpdate(i: number, p: Partial<CartItem>): void; onSent(): void }) {
  const P = cfg.pricing;
  const [d, setD] = useState<Draft>(loadDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { saveDraft(d); }, [d]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); if (errors[k as string]) setErrors((e) => ({ ...e, [k]: '' })); };
  const q = useMemo(() => quote(cart, P, d.outOfTown), [cart, P, d.outOfTown]);
  const needPhoto = cart.some((i) => i.category === 'other');
  const photosUploading = false;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBanner('');
    const errs: Record<string, string> = {};
    const items = validateItems(cart, P); if (!items.ok) Object.assign(errs, { items: Object.values(items.errors)[0] });
    const cl = validateClient(d, todayLocal()); if (!cl.ok) Object.assign(errs, cl.errors);
    if (needPhoto && d.photos.length === 0) errs.photos = 'Для «Другое» приложите хотя бы одно фото';
    setErrors(errs);
    if (Object.keys(errs).length) { focusFirst(errs); return; }
    const key = d.pendingKey ?? newKey();
    if (!d.pendingKey) { const nd = { ...d, pendingKey: key }; setD(nd); saveDraft(nd); }
    setSending(true);
    try {
      const r = await api<{ token: string }>('/api/orders', { method: 'POST', json: {
        idempotencyKey: key, draftKey: d.draftKey, items: cart, photoIds: d.photos.map((p) => p.id),
        client: { name: d.name, phone: d.phone, address: d.address, outOfTown: d.outOfTown, date: d.date, time: d.time, comment: d.comment, consent: d.consent } } });
      // успех — только после записи в базе (сервер вернул 200/201)
      saveDraft({ ...emptyDraft(), name: d.name, phone: d.phone, address: d.address });
      saveCart([]); onSent();
      store.set('lastOrder', r.token);
      location.assign('/z/' + r.token);
    } catch (err: any) {
      setSending(false);
      if (err instanceof ApiError && err.status === 422) { setErrors(err.errors); focusFirst(err.errors); setBanner(err.message); }
      else if (err instanceof ApiError && err.status === 409) { const nd = { ...d, pendingKey: null }; setD(nd); setBanner('Данные изменились после прошлой попытки. Нажмите «Отправить» ещё раз.'); }
      else setBanner((err as ApiError).network ? 'Нет связи с сервером. Данные сохранены — нажмите «Отправить» ещё раз, дубля не будет.' : (err as Error).message);
    }
  }
  function focusFirst(errs: Record<string, string>) {
    const k = Object.keys(errs).find((x) => errs[x]); if (!k) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${k}"]`) ?? formRef.current?.querySelector<HTMLElement>(`#${k}-err`);
    el?.focus?.(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // изменение состава/формы после неудачной попытки — новая заявка с новым ключом
  const fp = JSON.stringify([cart, d.name, d.phone, d.address, d.outOfTown, d.date, d.time, d.comment, d.photos.map((p) => p.id)]);
  const lastFp = useRef(fp);
  useEffect(() => { if (lastFp.current !== fp && d.pendingKey && !sending) setD((x) => ({ ...x, pendingKey: null })); lastFp.current = fp; }, [fp]); // eslint-disable-line

  if (!cart.length) return (
    <section className="page narrow">
      <div className="card empty-state">
        <div className="empty-ico" aria-hidden="true">🧺</div>
        <h1>В заказе пока пусто</h1>
        <p className="muted">Выберите диван, кресло, матрас, стулья или опишите другой предмет — цена посчитается сразу.</p>
        <button className="btn btn-primary" type="button" onClick={onBack}>К выбору мебели</button>
      </div>
    </section>
  );

  const fe = (k: string) => ({ name: k, 'aria-invalid': !!errors[k] || undefined, 'aria-describedby': `${k}-err` });
  return (
    <section className="checkout" aria-labelledby="co-h">
      <div className="checkout-head"><button className="link back" type="button" onClick={onBack}>← Добавить ещё</button><h1 id="co-h">Ваш заказ</h1></div>
      <div className="checkout-grid">
        <div className="panel">
          <h2 className="h3">Состав</h2>
          <ul className="cart">{cart.map((it, i) => <CartLine key={i + JSON.stringify(it)} it={it} P={P} onRemove={() => onRemove(i)} onUpdate={(p) => onUpdate(i, p)} />)}</ul>
          <small id="items-err" className="err">{errors.items}</small>
          <QuoteView q={q} compact />
          <p className="hint">Это предварительный расчёт. Мастер перезвонит, уточнит детали и подтвердит цену и время. Онлайн-оплаты нет — оплата после работы.</p>
        </div>
        <form className="panel form" onSubmit={submit} noValidate ref={formRef}>
          <h2 className="h3">Контакты и адрес</h2>
          <div className="field"><label htmlFor="f-name">Имя</label><input id="f-name" autoComplete="given-name" value={d.name} onChange={(e) => set('name', e.target.value)} {...fe('name')} /><small id="name-err" className="err">{errors.name}</small></div>
          <div className="field"><label htmlFor="f-phone">Телефон</label><input id="f-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+380 __ ___ __ __" value={d.phone} onChange={(e) => set('phone', e.target.value)} {...fe('phone')} /><small id="phone-err" className="err">{errors.phone}</small></div>
          <div className="field"><label htmlFor="f-address">Адрес</label><input id="f-address" autoComplete="street-address" placeholder="Улица, дом, квартира" value={d.address} onChange={(e) => set('address', e.target.value)} {...fe('address')} /><small id="address-err" className="err">{errors.address}</small></div>
          <Toggle checked={d.outOfTown} onChange={(v) => set('outOfTown', v)} hint={`+${formatUAH(P.outOfTownFee)}`}>Выезд за город ({cfg.company.territory})</Toggle>
          <div className="field-pair">
            <div className="field"><label htmlFor="f-date">Желаемая дата <small className="muted">необязательно</small></label><input id="f-date" type="date" min={todayLocal()} value={d.date} onChange={(e) => set('date', e.target.value)} {...fe('date')} /><small id="date-err" className="err">{errors.date}</small></div>
            <div className="field"><label htmlFor="f-time">Время</label><input id="f-time" type="time" step={1800} min="08:00" max="21:00" value={d.time} disabled={!d.date} onChange={(e) => set('time', e.target.value)} {...fe('time')} /><small id="time-err" className="err">{errors.time}</small>{!d.date && !errors.time && <small className="muted">Сначала выберите дату</small>}</div>
          </div>
          <p className="hint">Дата и время — пожелание. Мастер подтвердит запись после разговора.</p>
          <PhotoField draftKey={d.draftKey} initial={d.photos} required={needPhoto} error={errors.photos} onChange={(photos) => setD((x) => (JSON.stringify(x.photos) === JSON.stringify(photos) ? x : { ...x, photos }))} />
          <div className="field"><label htmlFor="f-comment">Комментарий <small className="muted">необязательно</small></label><textarea id="f-comment" rows={3} maxLength={LIMITS.maxComment} placeholder="Этаж, домофон, пятна от кофе, есть кот…" value={d.comment} onChange={(e) => set('comment', e.target.value)} {...fe('comment')} /></div>
          <label className="check"><input type="checkbox" checked={d.consent} onChange={(e) => set('consent', e.target.checked)} {...fe('consent')} /><span>Согласен(на) на обработку персональных данных согласно <a href="/privacy" target="_blank">политике</a></span></label>
          <small id="consent-err" className="err">{errors.consent}</small>
          <div className="submit-box">
            <QuoteView q={q} compact />
            {banner && <p className="banner" role="alert">{banner}</p>}
            <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={sending || photosUploading}>{sending ? 'Отправляем…' : 'Отправить заявку'}</button>
          </div>
        </form>
      </div>
    </section>
  );
}

/* ======================= приватная страница заявки ======================= */

interface PublicOrder {
  number: string; status: Status; statusLabel: string; createdAt: string; updatedAt: string;
  items: CartItem[]; quote: Quote; finalPrice: number | null; agreedAt: string | null;
  wish: { date: string; time: string; outOfTown: boolean }; photoCount: number;
  history: { at: string; kind: string; data: any }[];
  company: { name: string; phone: string; telegram: string; email: string; hours: string };
  game: { mode: 'off' | 'fun' | 'bonus'; played: boolean; bonus: any; terms: { amount: number; days: number; minOrder: number } };
  characters: PublicConfig['characters'];
}

function OrderPage({ token }: { token: string }) {
  const [o, setO] = useState<PublicOrder | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setO(await api<PublicOrder>(`/api/orders/${token}`)); setErr(null); } catch (e: any) { setErr(e); } finally { setRefreshing(false); }
  }, [token]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    const f = () => load(); window.addEventListener('focus', f);
    return () => { clearInterval(t); window.removeEventListener('focus', f); };
  }, [load]);
  async function copy() {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { const i = document.getElementById('order-link') as HTMLInputElement; i?.select(); }
  }
  if (err && !o) return (
    <section className="page narrow"><div className="card empty-state">
      <h1>{err.status === 404 ? 'Заявка не найдена' : 'Не удалось загрузить заявку'}</h1>
      <p className="muted">{err.status === 404 ? 'Проверьте ссылку — она приходит только после отправки заявки.' : err.message}</p>
      {err.status !== 404 && <button className="btn" type="button" onClick={load}>Повторить</button>}
    </div></section>
  );
  if (!o) return <section className="page narrow"><div className="card skeleton" aria-busy="true">Загружаем заявку…</div></section>;
  const tg = o.company.telegram.replace(/^@/, '');
  const steps: Status[] = ['new', 'agreed', 'done'];
  return (
    <section className="page order-page">
      <div className="order-head">
        <div><p className="eyebrow">Заявка {o.number}</p><h1>{o.status === 'new' ? 'Заявка принята' : o.statusLabel}</h1>
          <p className="muted">{o.status === 'new' ? 'Мы свяжемся с вами, чтобы согласовать цену и время визита.' : o.status === 'agreed' ? 'Визит согласован. До встречи!' : o.status === 'done' ? 'Работа выполнена. Спасибо!' : 'Заявка отменена.'}</p></div>
        <span className={`status status-${o.status}`}>{o.statusLabel}</span>
      </div>
      {o.status !== 'cancelled' && <ol className="progress-steps">{steps.map((s, i) => <li key={s} className={steps.indexOf(o.status) >= i ? 'on' : ''}>{STATUS_LABEL[s]}</li>)}</ol>}
      <div className="order-grid">
        <div className="panel">
          <h2 className="h3">Стоимость и время</h2>
          <dl className="facts">
            <div><dt>Итоговая цена</dt><dd>{o.finalPrice ? <b className="big">{formatUAH(o.finalPrice)}</b> : <span className="muted">ещё согласуем</span>}</dd></div>
            <div><dt>Визит</dt><dd>{o.agreedAt ? <b>{fmtDateTime(o.agreedAt)}</b> : <span className="muted">ещё согласуем</span>}</dd></div>
            <div><dt>Ваше пожелание</dt><dd>{o.wish.date ? fmtDateTime(o.wish.date + (o.wish.time ? 'T' + o.wish.time : '')) : 'не указано'}</dd></div>
            <div><dt>Фото</dt><dd>{o.photoCount ? `${o.photoCount} шт. — видны только владельцу` : 'нет'}</dd></div>
          </dl>
          <h2 className="h3">Предварительный расчёт</h2>
          <QuoteView q={o.quote} />
          <p className="hint">Условия зафиксированы на момент отправки — изменение прайса их не меняет.</p>
        </div>
        <div className="panel">
          <h2 className="h3">Ссылка на заявку</h2>
          <p className="muted small">Сохраните её — по ней видно статус. Не пересылайте посторонним.</p>
          <div className="copy-row"><input id="order-link" readOnly value={typeof location !== 'undefined' ? location.href : ''} onFocus={(e) => e.target.select()} /><button className="btn" type="button" onClick={copy}>{copied ? 'Скопировано ✓' : 'Скопировать'}</button></div>
          <button className="link" type="button" onClick={load} disabled={refreshing}>{refreshing ? 'Обновляем…' : '↻ Обновить статус'}</button>
          <h2 className="h3">История</h2>
          <ol className="timeline">{o.history.map((h, i) => <li key={i}><time>{fmtStamp(h.at)}</time><span>{h.kind === 'created' ? 'Заявка отправлена' : h.kind === 'status' ? `Статус: ${STATUS_LABEL[h.data.to as Status] ?? h.data.to}` : h.kind === 'price' ? (h.data.finalPrice ? `Цена: ${formatUAH(h.data.finalPrice)}` : 'Цена снята') : h.kind === 'time' ? (h.data.agreedAt ? `Время визита: ${fmtDateTime(h.data.agreedAt)}` : 'Время снято') : h.kind === 'bonus' ? 'Получен бонус за игру' : h.kind}</span></li>)}</ol>
          <h2 className="h3">Связаться</h2>
          <div className="contact-buttons">
            {o.company.phone && <a className="btn" href={`tel:${o.company.phone.replace(/[^\d+]/g, '')}`}>📞 {o.company.phone}</a>}
            {tg && <a className="btn" href={`https://t.me/${tg}`} rel="noopener">✈️ Telegram</a>}
            {o.company.email && <a className="btn" href={`mailto:${o.company.email}?subject=${encodeURIComponent('Заявка ' + o.number)}`}>✉️ Email</a>}
            {!o.company.phone && !tg && !o.company.email && <p className="muted small">Компания свяжется с вами по телефону из заявки.</p>}
          </div>
        </div>
      </div>
      {o.game.mode !== 'off' && o.status !== 'cancelled' && <GameCard token={token} order={o} onDone={load} />}
    </section>
  );
}

/* ======================= игра ======================= */

function GameCard({ token, order, onDone }: { token: string; order: PublicOrder; onDone(): void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'clean' | 'rotate'>('clean');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ bonus: any } | null>(order.game.played ? { bonus: order.game.bonus } : null);
  const [err, setErr] = useState('');
  const started = useRef(0); const stage = useRef<StageHandle>(null); const sent = useRef(false);
  const cat = (order.items.find((i) => i.category !== 'other')?.category ?? 'sofa') as CategoryId;
  useEffect(() => {
    if (progress >= 0.85 && !sent.current) {
      sent.current = true;
      api(`/api/orders/${token}/game`, { method: 'POST', json: { durationMs: Math.round(performance.now() - started.current) } })
        .then((r: any) => { setResult({ bonus: r.bonus }); onDone(); }).catch((e: any) => { sent.current = false; setErr(e.message); });
    }
  }, [progress]); // eslint-disable-line
  const t = order.game.terms;
  if (result) return (
    <div className="panel game-done">
      <h2 className="h3">🫧 Чисто!</h2>
      {result.bonus ? <p>Ваш код на следующий заказ: <code className="code">{result.bonus.code}</code> — скидка {formatUAH(result.bonus.amount)} при заказе от {formatUAH(result.bonus.min_order)}, до {new Date(result.bonus.expires_at).toLocaleDateString('ru-RU')}. Назовите код мастеру — бонус применяется вручную после проверки. Текущий заказ не дешевеет.</p>
        : <p>Спасибо, что поиграли! Это просто развлечение — на стоимость заказа не влияет.</p>}
    </div>);
  return (
    <div className="panel game">
      <div className="game-head">
        <div><h2 className="h3">Мини-игра: почистите сами</h2>
          <p className="muted small">{order.game.mode === 'bonus' ? `Сотрите пятна пальцем — получите код на ${formatUAH(t.amount)} для следующего заказа от ${formatUAH(t.minOrder)} (действует ${t.days} дн.). Текущий заказ не меняется.` : 'Просто для настроения: сотрите пятна пальцем или мышью.'}</p></div>
        {!open && <button className="btn btn-primary" type="button" onClick={() => { setOpen(true); started.current = performance.now(); }}>Играть</button>}
      </div>
      {open && <>
        <div className="seg" role="radiogroup" aria-label="Режим">
          <button type="button" role="radio" aria-checked={mode === 'clean'} className={mode === 'clean' ? 'on' : ''} onClick={() => setMode('clean')}>🧽 Чистить</button>
          <button type="button" role="radio" aria-checked={mode === 'rotate'} className={mode === 'rotate' ? 'on' : ''} onClick={() => setMode('rotate')}>↻ Вращать</button>
        </div>
        <Stage3D ref={stage} category={cat} characters={order.characters} label="Игра" game mode={mode} onProgress={setProgress} version={VERSION}
          onReady={() => setTimeout(() => stage.current?.stage?.enableDirt(Date.now() % 1000), 700)} />
        <div className="game-progress"><div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div><span>{Math.round(progress * 100)}%</span></div>
        {err && <p className="banner" role="alert">{err} <button className="link" type="button" onClick={() => { setErr(''); setProgress((p) => p); sent.current = false; setProgress(0.8501); }}>Повторить</button></p>}
      </>}
    </div>
  );
}

/* ======================= запуск ======================= */

function Root() {
  const cfg = readConfig();
  const route = document.getElementById('app')?.dataset.route;
  if (route === 'order') return <OrderPage token={location.pathname.split('/').pop()!} />;
  if (!cfg) return <p className="page">Не удалось загрузить настройки. Обновите страницу.</p>;
  return <Shop cfg={cfg} />;
}

const el = document.getElementById('app');
if (el) createRoot(el).render(<Root />);

if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
  navigator.serviceWorker?.register('/sw.js').catch(() => {});
}
