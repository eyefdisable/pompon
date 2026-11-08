/** Кабинет владельца: заявки, тарифы, компания, игра, персонажи, доступ. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CATEGORY_IDS, PHRASES, STATUSES, STATUS_LABEL, type Settings, type Status, type CategoryId } from '../shared/config';
import { formatUAH, type Quote, type CartItem } from '../shared/pricing';
import { api, ApiError, fmtDateTime, fmtStamp } from './lib';
import { QuoteView } from './app-quote';

type Section = 'orders' | 'tariffs' | 'company' | 'game' | 'characters' | 'access';
const SECTIONS: [Section, string][] = [['orders', 'Заявки'], ['tariffs', 'Тарифы'], ['company', 'Компания'], ['game', 'Игра'], ['characters', 'Персонажи'], ['access', 'Доступ']];

function useHashSection(): [Section, (s: Section) => void] {
  const get = () => (SECTIONS.find(([k]) => '#' + k === location.hash)?.[0] ?? 'orders');
  const [s, setS] = useState<Section>(get);
  useEffect(() => { const f = () => setS(get()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return [s, (n) => { location.hash = n; setS(n); }];
}

function Field({ label, error, children, hint }: { label: string; error?: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span className="label">{label}</span>{children}{hint && <small className="muted">{hint}</small>}<small className="err">{error}</small></label>;
}

/* ---------- вход ---------- */
function Login({ onIn }: { onIn(): void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/admin/login', { method: 'POST', json: { password: pw } }); onIn(); }
    catch (x: any) { setErr(x instanceof ApiError ? (x.errors.password || x.message) : 'Ошибка входа'); } finally { setBusy(false); }
  }
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={go}>
        <h1>Кабинет владельца</h1>
        <Field label="Пароль" error={err}><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus aria-invalid={!!err} /></Field>
        <button className="btn btn-primary btn-block" disabled={busy || !pw}>{busy ? 'Входим…' : 'Войти'}</button>
        <a className="link" href="/">← На сайт</a>
      </form>
    </div>
  );
}

/* ---------- заявки ---------- */
interface Row { id: number; number: string; status: Status; created_at: string; name: string; phone: string; address: string; known_total: number; manual_count: number; final_price: number | null; agreed_at: string | null; photos: number }

function Orders() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState<string>('');
  const [data, setData] = useState<{ orders: Row[]; counts: Record<string, number> } | null>(null);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api(`/api/admin/orders?q=${encodeURIComponent(q)}&status=${status}`)); setErr(''); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [q, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const t = setInterval(() => { if (!document.hidden && openId === null) load(); }, 45000); return () => clearInterval(t); }, [load, openId]);
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  if (openId !== null) return <OrderDetail id={openId} onBack={() => { setOpenId(null); load(); }} />;
  return (
    <section>
      <div className="admin-toolbar">
        <input type="search" placeholder="Поиск: номер, имя, телефон, адрес" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск заявок" />
        <button className="btn" type="button" onClick={load} disabled={loading}>{loading ? 'Обновляем…' : '↻ Обновить'}</button>
      </div>
      <div className="filter-chips" role="radiogroup" aria-label="Статус">
        <button type="button" className={!status ? 'on' : ''} onClick={() => setStatus('')}>Все <em>{total}</em></button>
        {STATUSES.map((s) => <button type="button" key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{STATUS_LABEL[s]} <em>{data?.counts[s] ?? 0}</em></button>)}
      </div>
      {err && <p className="banner" role="alert">{err} <button className="link" onClick={load}>Повторить</button></p>}
      {data && !data.orders.length && <div className="card empty-state"><h2>Заявок нет</h2><p className="muted">{q || status ? 'Измените поиск или фильтр.' : 'Новые заявки с сайта появятся здесь.'}</p></div>}
      <ul className="order-list">
        {data?.orders.map((o) => (
          <li key={o.id}><button type="button" className="order-row" onClick={() => setOpenId(o.id)}>
            <span className={`status status-${o.status}`}>{STATUS_LABEL[o.status]}</span>
            <b>{o.number}</b>
            <span className="or-name">{o.name}<small className="muted">{o.phone}</small></span>
            <span className="or-addr muted">{o.address}</span>
            <span className="or-sum">{o.final_price ? formatUAH(o.final_price) : <>{o.known_total ? '≈ ' + formatUAH(o.known_total) : ''}{o.manual_count ? <small className="muted"> + по фото</small> : ''}</>}</span>
            <span className="or-when muted">{o.agreed_at ? '🗓 ' + fmtDateTime(o.agreed_at) : fmtStamp(o.created_at)}{o.photos ? ` · 📷${o.photos}` : ''}</span>
          </button></li>))}
      </ul>
    </section>
  );
}

interface Detail { order: { id: number; number: string; status: Status; client: any; items: CartItem[]; quote: Quote; final_price: number | null; agreed_at: string | null; owner_note: string; game: any; created_at: string };
  photos: { id: string; width: number; height: number }[]; events: { at: string; actor: string; kind: string; data: any }[]; bonus: any }

function OrderDetail({ id, onBack }: { id: number; onBack(): void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [form, setForm] = useState({ status: 'new' as Status, finalPrice: '', agreedAt: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null); const [del, setDel] = useState(''); const [delOpen, setDelOpen] = useState(false);
  const fill = (x: Detail) => { setD(x); setForm({ status: x.order.status, finalPrice: x.order.final_price ? String(x.order.final_price) : '', agreedAt: x.order.agreed_at ?? '', note: x.order.owner_note }); };
  const load = useCallback(() => api<Detail>(`/api/admin/orders/${id}`).then(fill).catch((e) => setMsg(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <section><button className="link" onClick={onBack}>← К списку</button><p>{msg || 'Загрузка…'}</p></section>;
  const o = d.order; const c = o.client;
  async function save(e?: React.FormEvent) {
    e?.preventDefault(); setBusy(true); setMsg(''); setErrors({});
    try { fill(await api<Detail>(`/api/admin/orders/${id}`, { method: 'PATCH', json: { status: form.status, finalPrice: form.finalPrice === '' ? null : Number(form.finalPrice), agreedAt: form.agreedAt || null, note: form.note } })); setMsg('Сохранено — клиент увидит изменения по своей ссылке.'); }
    catch (x: any) { if (x instanceof ApiError) { setErrors(x.errors); setMsg(x.message); } else setMsg('Ошибка сохранения'); } finally { setBusy(false); }
  }
  async function remove() {
    try { await api(`/api/admin/orders/${id}`, { method: 'DELETE', json: { confirmNumber: del.trim() } }); onBack(); }
    catch (x: any) { setErrors(x.errors || {}); setMsg(x.message); }
  }
  async function bonus(status: string) { await api(`/api/admin/bonus/${d!.bonus.id}`, { method: 'POST', json: { status } }); load(); }
  return (
    <section className="detail">
      <div className="detail-head"><button className="link" type="button" onClick={onBack}>← К списку</button><h2>Заявка {o.number}</h2><span className={`status status-${o.status}`}>{STATUS_LABEL[o.status]}</span></div>
      <div className="detail-grid">
        <div className="panel">
          <h3>Клиент</h3>
          <dl className="facts">
            <div><dt>Имя</dt><dd>{c.name}</dd></div>
            <div><dt>Телефон</dt><dd><a href={`tel:${String(c.phone).replace(/[^\d+]/g, '')}`}>{c.phone}</a></dd></div>
            <div><dt>Адрес</dt><dd>{c.address}{c.outOfTown && <span className="tag">за городом</span>}</dd></div>
            <div><dt>Пожелание</dt><dd>{c.date ? fmtDateTime(c.date + (c.time ? 'T' + c.time : '')) : 'не указано'}</dd></div>
            {c.comment && <div><dt>Комментарий</dt><dd className="pre">{c.comment}</dd></div>}
            <div><dt>Отправлена</dt><dd>{fmtStamp(o.created_at)} · согласие {c.consentAt ? fmtStamp(c.consentAt) : '—'}</dd></div>
          </dl>
          <h3>Состав и предварительный расчёт</h3>
          <QuoteView q={o.quote} />
          {d.photos.length > 0 && <><h3>Фото ({d.photos.length})</h3><div className="admin-photos">{d.photos.map((p) => <button type="button" key={p.id} onClick={() => setZoom(p.id)}><img src={`/api/admin/photos/${p.id}`} alt="Фото клиента" loading="lazy" /></button>)}</div></>}
          {d.bonus && <><h3>Бонус за игру</h3><p><code className="code">{d.bonus.code}</code> {formatUAH(d.bonus.amount)} от {formatUAH(d.bonus.min_order)}, до {new Date(d.bonus.expires_at).toLocaleDateString('ru-RU')} — <b>{d.bonus.status === 'issued' ? 'выдан' : d.bonus.status === 'redeemed' ? 'погашен' : 'аннулирован'}</b></p>
            {d.bonus.status === 'issued' && <div className="row-btns"><button className="btn btn-small" onClick={() => bonus('redeemed')}>Отметить погашенным</button><button className="btn btn-small" onClick={() => bonus('void')}>Аннулировать</button></div>}</>}
        </div>
        <form className="panel" onSubmit={save}>
          <h3>Согласование</h3>
          <Field label="Статус" error={errors.status}><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></Field>
          <Field label="Итоговая цена, ₴" error={errors.finalPrice} hint={o.quote.complete ? `Предварительно: ${formatUAH(o.quote.knownTotal)}` : `Известная часть: ${formatUAH(o.quote.knownTotal)} + ${o.quote.manualCount} по фото`}>
            <input type="number" inputMode="numeric" min={1} value={form.finalPrice} onChange={(e) => setForm({ ...form, finalPrice: e.target.value })} aria-invalid={!!errors.finalPrice} />
          </Field>
          {o.quote.complete && !form.finalPrice && <button type="button" className="link" onClick={() => setForm({ ...form, finalPrice: String(o.quote.knownTotal) })}>Подставить предварительную сумму</button>}
          <Field label="Согласованное время визита" error={errors.agreedAt}><input type="datetime-local" value={form.agreedAt} onChange={(e) => setForm({ ...form, agreedAt: e.target.value })} aria-invalid={!!errors.agreedAt} /></Field>
          <Field label="Приватная заметка" hint="Видна только в кабинете"><textarea rows={4} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          {msg && <p className={Object.keys(errors).length ? 'banner' : 'ok'} role="status">{msg}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
          <h3>История</h3>
          <ol className="timeline">{d.events.map((e, i) => <li key={i}><time>{fmtStamp(e.at)}</time><span>{e.actor === 'owner' ? 'Вы: ' : e.actor === 'system' ? 'Система: ' : 'Клиент: '}{e.kind === 'created' ? 'заявка отправлена' : e.kind === 'status' ? `${STATUS_LABEL[e.data.from as Status]} → ${STATUS_LABEL[e.data.to as Status]}` : e.kind === 'price' ? `цена ${e.data.finalPrice ? formatUAH(e.data.finalPrice) : 'снята'}` : e.kind === 'time' ? `время ${e.data.agreedAt ? fmtDateTime(e.data.agreedAt) : 'снято'}` : e.kind === 'note' ? 'заметка изменена' : e.kind === 'bonus' ? 'выдан бонус' : e.kind}</span></li>)}</ol>
          <div className="danger-zone">
            {!delOpen ? <button type="button" className="link danger" onClick={() => setDelOpen(true)}>Удалить заявку и фото…</button> : <>
              <Field label={`Введите ${o.number}, чтобы удалить навсегда (вместе с ${d.photos.length} фото)`} error={errors.confirmNumber}><input value={del} onChange={(e) => setDel(e.target.value)} /></Field>
              <div className="row-btns"><button type="button" className="btn btn-danger" disabled={del.trim() !== o.number} onClick={remove}>Удалить</button><button type="button" className="btn" onClick={() => { setDelOpen(false); setDel(''); }}>Отмена</button></div></>}
          </div>
        </form>
      </div>
      {zoom && <div className="lightbox" role="dialog" aria-label="Фото" onClick={() => setZoom(null)}><img src={`/api/admin/photos/${zoom}`} alt="Фото клиента" /></div>}
    </section>
  );
}

/* ---------- настройки ---------- */
function useSettings() {
  const [s, setS] = useState<Settings | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<Settings>('/api/admin/settings').then(setS).catch((e) => setErr(e.message)); }, []);
  return { s, setS, err };
}
function SaveBar({ onSave, state }: { onSave(): void; state: { busy: boolean; msg: string; errors: Record<string, string> } }) {
  return <div className="savebar">{state.msg && <span className={Object.keys(state.errors).length ? 'err' : 'ok'} role="status">{state.msg}</span>}<button className="btn btn-primary" type="button" onClick={onSave} disabled={state.busy}>{state.busy ? 'Сохраняем…' : 'Сохранить'}</button></div>;
}
function useSaver(setS: (s: Settings) => void) {
  const [st, setSt] = useState({ busy: false, msg: '', errors: {} as Record<string, string> });
  const save = async (patch: Partial<Settings>) => {
    setSt({ busy: true, msg: '', errors: {} });
    try { setS(await api<Settings>('/api/admin/settings', { method: 'PUT', json: patch })); setSt({ busy: false, msg: 'Сохранено', errors: {} }); }
    catch (e: any) { setSt({ busy: false, msg: e.message, errors: e.errors || {} }); }
  };
  return { st, save };
}

function Tariffs() {
  const { s, setS, err } = useSettings(); const { st, save } = useSaver(setS);
  const [p, setP] = useState<Settings['pricing'] | null>(null);
  useEffect(() => { if (s) setP(structuredClone(s.pricing)); }, [s]);
  if (!p) return <p>{err || 'Загрузка…'}</p>;
  const num = (k: keyof Settings['pricing'], label: string, hint?: string) => (
    <Field label={label} error={st.errors[`pricing.${k}`]} hint={hint}><input type="number" inputMode="numeric" value={p[k] as number} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></Field>);
  return (
    <section className="settings">
      <p className="hint">Новые цены применяются к новым заявкам. Отправленные заявки хранят прайс на момент отправки.</p>
      <div className="settings-grid">
        {CATEGORY_IDS.filter((c) => !p.categories[c].manual).map((c) => (
          <div className="panel" key={c}><h3>{p.categories[c].label}</h3>
            {p.categories[c].variants.map((v, i) => (
              <div className="field-pair" key={v.id}>
                <Field label="Название"><input value={v.label} onChange={(e) => { const n = structuredClone(p); n.categories[c].variants[i].label = e.target.value; setP(n); }} /></Field>
                <Field label="Цена, ₴" error={st.errors[`pricing.${c}.${v.id}`]}><input type="number" inputMode="numeric" value={v.price} onChange={(e) => { const n = structuredClone(p); n.categories[c].variants[i].price = Number(e.target.value); setP(n); }} /></Field>
              </div>))}
          </div>))}
        <div className="panel"><h3>Правила</h3>
          {num('minOrder', 'Минимальный заказ на чистку, ₴', 'Выезд за город добавляется сверху')}
          {num('heavySoilingPct', 'Сильные загрязнения, %')}
          {num('mattressSecondSidePct', 'Вторая сторона матраса, %')}
          {num('outOfTownFee', 'Выезд за город, ₴ (фиксированно)')}
          {num('roundTo', 'Округление цены позиции, ₴')}
        </div>
      </div>
      <SaveBar state={st} onSave={() => save({ pricing: p })} />
    </section>
  );
}

function Company() {
  const { s, setS, err } = useSettings(); const { st, save } = useSaver(setS);
  const [c, setC] = useState<Settings['company'] | null>(null);
  useEffect(() => { if (s) setC({ ...s.company }); }, [s]);
  if (!c) return <p>{err || 'Загрузка…'}</p>;
  const f = (k: keyof Settings['company'], label: string, hint?: string, type = 'text') => (
    <Field label={label} error={st.errors[`company.${k}`]} hint={hint}><input type={type} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></Field>);
  return (
    <section className="settings">
      <div className="settings-grid">
        <div className="panel"><h3>Бренд</h3>{f('name', 'Название')}{f('tagline', 'Подзаголовок')}
          <Field label="Акцентный цвет" error={st.errors['company.accent']} hint="Логотип, полная палитра и PWA-иконки меняются в исходниках"><div className="color-row"><input type="color" value={c.accent} onChange={(e) => setC({ ...c, accent: e.target.value })} /><input value={c.accent} onChange={(e) => setC({ ...c, accent: e.target.value })} /></div></Field>
          {f('legalName', 'Оператор данных (для политики)')}</div>
        <div className="panel"><h3>Контакты</h3>{f('phone', 'Телефон', 'Пусто — кнопка звонка не показывается', 'tel')}{f('telegram', 'Telegram (ник без ссылки)')}{f('email', 'Email', undefined, 'email')}{f('hours', 'Режим работы')}</div>
        <div className="panel"><h3>География</h3>{f('city', 'Город')}{f('territory', 'Территория выезда')}</div>
      </div>
      <SaveBar state={st} onSave={() => save({ company: c })} />
    </section>
  );
}

function Game() {
  const { s, setS, err } = useSettings(); const { st, save } = useSaver(setS);
  const [g, setG] = useState<Settings['game'] | null>(null);
  useEffect(() => { if (s) setG({ ...s.game }); }, [s]);
  if (!g) return <p>{err || 'Загрузка…'}</p>;
  return (
    <section className="settings"><div className="settings-grid"><div className="panel">
      <h3>Режим мини-игры после заявки</h3>
      {([['off', 'Выключена'], ['fun', 'Играть без скидки'], ['bonus', 'Бонус на следующий заказ']] as const).map(([k, l]) =>
        <label className="radio" key={k}><input type="radio" name="gm" checked={g.mode === k} onChange={() => setG({ ...g, mode: k })} /> {l}</label>)}
      {g.mode === 'bonus' && <>
        <Field label="Сумма бонуса, ₴" error={st.errors['game.bonusAmount']}><input type="number" value={g.bonusAmount} onChange={(e) => setG({ ...g, bonusAmount: Number(e.target.value) })} /></Field>
        <Field label="Срок действия, дней" error={st.errors['game.bonusValidDays']}><input type="number" value={g.bonusValidDays} onChange={(e) => setG({ ...g, bonusValidDays: Number(e.target.value) })} /></Field>
        <Field label="Минимум следующей чистки, ₴" error={st.errors['game.bonusMinOrder']}><input type="number" value={g.bonusMinOrder} onChange={(e) => setG({ ...g, bonusMinOrder: Number(e.target.value) })} /></Field>
      </>}
      <p className="hint">Один код на заявку, текущий заказ не дешевеет. Бонус применяется вручную после проверки — в карточке заявки отметьте его погашенным. Защищённого античита нет: сервер лишь проверяет правдоподобность времени игры.</p>
    </div></div><SaveBar state={st} onSave={() => save({ game: g })} /></section>
  );
}

function Characters() {
  const { s, setS, err } = useSettings(); const { st, save } = useSaver(setS);
  const [c, setC] = useState<Settings['characters'] | null>(null);
  useEffect(() => { if (s) setC({ ...s.characters }); }, [s]);
  if (!c) return <p>{err || 'Загрузка…'}</p>;
  return (
    <section className="settings"><div className="settings-grid">
      <div className="panel"><h3>Характер</h3>
        {([['friendly', 'Дружелюбный'], ['calm', 'Сдержанный'], ['cheeky', 'С юмором']] as const).map(([k, l]) => <label className="radio" key={k}><input type="radio" name="cp" checked={c.preset === k} onChange={() => setC({ ...c, preset: k })} /> {l}</label>)}
        <label className="check"><input type="checkbox" checked={c.faces} onChange={(e) => setC({ ...c, faces: e.target.checked })} /> Показывать лица и руки</label>
        <label className="check"><input type="checkbox" checked={c.phrases} disabled={!c.faces} onChange={(e) => setC({ ...c, phrases: e.target.checked })} /> Показывать реплики</label>
      </div>
      <div className="panel"><h3>Реплики «{c.preset === 'friendly' ? 'Дружелюбный' : c.preset === 'calm' ? 'Сдержанный' : 'С юмором'}»</h3>
        <ul className="phrases">{CATEGORY_IDS.map((k) => <li key={k}><b>{k === 'sofa' ? 'Диван' : k === 'armchair' ? 'Кресло' : k === 'mattress' ? 'Матрас' : k === 'chair' ? 'Стул' : 'Другое'}</b>{PHRASES[c.preset][k as CategoryId].map((t, i) => <span key={i}>«{t}»</span>)}</li>)}</ul>
        <p className="hint">Тексты реплик и новые характеры правятся в <code>src/shared/config.ts</code>.</p></div>
    </div><SaveBar state={st} onSave={() => save({ characters: c })} /></section>
  );
}

function Access({ onOut }: { onOut(): void }) {
  const [f, setF] = useState({ current: '', next: '', repeat: '' }); const [errors, setErrors] = useState<Record<string, string>>({}); const [msg, setMsg] = useState('');
  async function change(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (f.next !== f.repeat) { setErrors({ repeat: 'Пароли не совпадают' }); return; }
    try { await api('/api/admin/password', { method: 'POST', json: { current: f.current, next: f.next } }); setErrors({}); setF({ current: '', next: '', repeat: '' }); setMsg('Пароль изменён. Все прежние сеансы на других устройствах закрыты.'); }
    catch (x: any) { setErrors(x.errors || {}); setMsg(x.message); }
  }
  async function out() { await api('/api/admin/logout', { method: 'POST', json: {} }).catch(() => {}); onOut(); }
  return (
    <section className="settings"><div className="settings-grid">
      <form className="panel" onSubmit={change}><h3>Смена пароля</h3>
        <Field label="Текущий пароль" error={errors.current}><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="Новый пароль" error={errors.next} hint="Минимум 10 символов"><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Повторите" error={errors.repeat}><input type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} /></Field>
        {msg && <p className={Object.keys(errors).length ? 'banner' : 'ok'} role="status">{msg}</p>}
        <button className="btn btn-primary">Сменить пароль</button>
      </form>
      <div className="panel"><h3>Сеанс</h3><p className="muted">Сеанс действует 14 дней на этом устройстве.</p><button className="btn" type="button" onClick={out}>Выйти</button></div>
    </div></section>
  );
}

function Admin() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [sec, setSec] = useHashSection();
  useEffect(() => { api('/api/admin/me').then(() => setAuth('in')).catch(() => setAuth('out')); }, []);
  useEffect(() => { const h = (e: PromiseRejectionEvent) => { if (e.reason instanceof ApiError && e.reason.status === 401) setAuth('out'); }; window.addEventListener('unhandledrejection', h); return () => window.removeEventListener('unhandledrejection', h); }, []);
  if (auth === 'checking') return <p className="page">Проверяем доступ…</p>;
  if (auth === 'out') return <Login onIn={() => setAuth('in')} />;
  return (
    <div className="admin">
      <header className="admin-top">
        <a className="brand" href="/" title="На сайт">Кабинет</a>
        <nav className="admin-nav" aria-label="Разделы кабинета">{SECTIONS.map(([k, l]) => <a key={k} href={'#' + k} aria-current={sec === k ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setSec(k); }}>{l}</a>)}</nav>
        <button className="icon-btn" data-theme-toggle aria-label="Сменить тему" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg></button>
      </header>
      <main className="admin-main">
        <h1 className="sr-only">{SECTIONS.find(([k]) => k === sec)![1]}</h1>
        {sec === 'orders' && <Orders />}{sec === 'tariffs' && <Tariffs />}{sec === 'company' && <Company />}
        {sec === 'game' && <Game />}{sec === 'characters' && <Characters />}{sec === 'access' && <Access onOut={() => setAuth('out')} />}
      </main>
    </div>
  );
}

const root = document.getElementById('admin');
if (root) createRoot(root).render(<Admin />);
