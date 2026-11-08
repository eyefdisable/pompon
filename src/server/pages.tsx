/** Серверный рендер публичных страниц (SEO), служебных оболочек, sitemap, robots, manifest. */
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { Settings, CategoryId } from '../shared/config';
import { CATEGORY_IDS } from '../shared/config';
import { formatUAH } from '../shared/pricing';
import { Poster } from '../shared/poster';
import { publicConfig } from './api';

export interface PageCtx { s: Settings; origin: string; build: string; path: string }

const SLUG: Record<CategoryId, string> = { sofa: 'divan', armchair: 'kreslo', mattress: 'matras', chair: 'stul', other: 'drugoe' };
export const CATEGORY_BY_SLUG = Object.fromEntries(Object.entries(SLUG).map(([k, v]) => [v, k])) as Record<string, CategoryId>;

function accentVars(hex: string) {
  const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const mix = (t: number) => '#' + [r, g, b].map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
  return `:root{--accent:${hex};--accent-rgb:${r},${g},${b};--accent-dark-theme:${mix(0.35)}}`;
}

function Shell(p: { ctx: PageCtx; title: string; description: string; noindex?: boolean; bundle?: 'app' | 'admin' | null; jsonLd?: object[]; children: React.ReactNode; bodyClass?: string }) {
  const { s, origin, build, path } = p.ctx;
  const v = `?v=${build}`;
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{p.title}</title>
        <meta name="description" content={p.description} />
        {p.noindex ? <meta name="robots" content="noindex, nofollow" /> : <link rel="canonical" href={origin + path} />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={p.title} />
        <meta property="og:description" content={p.description} />
        <meta property="og:locale" content="ru_UA" />
        {!p.noindex && <meta property="og:url" content={origin + path} />}
        <meta property="og:image" content={origin + '/icons/og.png'} />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F5F3EE" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111614" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="stylesheet" href={'/assets/app.css' + v} />
        <style dangerouslySetInnerHTML={{ __html: accentVars(s.company.accent) }} />
        <script src={'/assets/theme.js' + v} />
        {p.jsonLd?.map((j, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j).replace(/</g, '\\u003c') }} />)}
      </head>
      <body className={p.bodyClass}>
        <a className="skip" href="#main">К содержимому</a>
        {p.children}
        {p.bundle && <script type="module" src={`/assets/${p.bundle}.js${v}`} />}
      </body>
    </html>
  );
}

function Header({ s, cta = true }: { s: Settings; cta?: boolean }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label={`${s.company.name} — на главную`}><Logo /><span>{s.company.name}</span></a>
      <nav className="topnav" aria-label="Разделы">
        <a href="/uslugi">Услуги и цены</a><a href="/kontakty">Контакты</a>
      </nav>
      <div className="topbar-actions">
        <button className="icon-btn" data-theme-toggle aria-label="Сменить тему" type="button"><ThemeIcon /></button>
        {cta && <a className="btn btn-primary btn-order" href="/#zakaz" data-order-link>Заказ</a>}
      </div>
    </header>
  );
}
export function ThemeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg>;
}
export function Logo() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="var(--accent)" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#fff" strokeWidth="2.4" strokeDasharray="3 3.4" />
      <circle cx="16.5" cy="18.5" r="1.8" fill="#fff" /><circle cx="23.5" cy="18.5" r="1.8" fill="#fff" />
      <path d="M16 23q4 3 8 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function Footer({ s }: { s: Settings }) {
  return (
    <footer className="footer">
      <div className="footer-cols">
        <div><b>{s.company.name}</b><p className="muted">{s.company.tagline}. {s.company.territory}.</p><p className="muted">{s.company.hours}</p></div>
        <nav aria-label="Услуги">{CATEGORY_IDS.map((c) => <a key={c} href={`/uslugi#${SLUG[c]}`}>{s.pricing.categories[c].label}</a>)}</nav>
        <nav aria-label="Информация"><a href="/kontakty">Контакты</a><a href="/privacy">Политика конфиденциальности</a><a href="/atribuciya">Атрибуция и лицензии</a><a href="/kabinet" rel="nofollow">Кабинет владельца</a></nav>
      </div>
      <p className="muted small">© {new Date().getFullYear()} {s.company.name}. Цены предварительные; итог мастер подтверждает после осмотра или фото.</p>
    </footer>
  );
}

const fromPrice = (s: Settings, c: CategoryId) => {
  const v = s.pricing.categories[c].variants; return v.length ? Math.min(...v.map((x) => x.price)) : null;
};

function bizLd(ctx: PageCtx) {
  const { s, origin } = ctx;
  return {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': origin + '/#biz', name: s.company.name, description: s.company.tagline, url: origin + '/',
    areaServed: s.company.territory, address: { '@type': 'PostalAddress', addressLocality: s.company.city, addressCountry: 'UA' },
    ...(s.company.phone ? { telephone: s.company.phone } : {}), ...(s.company.email ? { email: s.company.email } : {}),
    makesOffer: CATEGORY_IDS.filter((c) => fromPrice(s, c)).map((c) => ({ '@type': 'Offer', priceCurrency: 'UAH', price: fromPrice(s, c), itemOffered: { '@type': 'Service', name: `Химчистка: ${s.pricing.categories[c].label.toLowerCase()}` } }))
  };
}

export function homePage(ctx: PageCtx) {
  const { s } = ctx;
  return Shell({
    ctx, bundle: 'app', jsonLd: [bizLd(ctx)],
    title: `${s.company.name} — химчистка диванов, кресел и матрасов на дому, ${s.company.city}`,
    description: `Выездная химчистка мягкой мебели: ${s.company.territory}. Выберите предмет — увидите примерную цену и оставьте заявку за пару минут.`,
    children: <>
      <Header s={s} />
      <main id="main">
        <script id="pp-config" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(publicConfig(s)).replace(/</g, '\\u003c') }} />
        <div id="app" data-ssr="1">
          <section className="hero-ssr">
            <div className="hero-copy">
              <p className="eyebrow">{s.company.tagline} · {s.company.city}</p>
              <h1>Мебель снова свежая — без вывоза из дома</h1>
              <p className="lead">Выберите, что почистить, и сразу увидите примерную стоимость. Мастер перезвонит, уточнит детали и согласует время.</p>
            </div>
            <div className="poster-wrap"><Poster category="sofa" /></div>
            <ul className="ssr-prices">
              {CATEGORY_IDS.map((c) => <li key={c}><a href={`/?c=${c}#vybor`}>{s.pricing.categories[c].label}</a><span>{fromPrice(s, c) ? 'от ' + formatUAH(fromPrice(s, c)!) : 'по фото'}</span></li>)}
            </ul>
            <noscript><p className="notice">Для расчёта и заявки включите JavaScript или свяжитесь с нами через страницу <a href="/kontakty">контактов</a>.</p></noscript>
          </section>
        </div>
        <HowItWorks />
      </main>
      <Footer s={s} />
    </>
  });
}

function HowItWorks() {
  return (
    <section className="section how" aria-labelledby="how-h">
      <h2 id="how-h">Как это работает</h2>
      <ol className="how-list">
        <li><b>Выберите мебель</b><span>Вариант, количество и сложность загрязнений.</span></li>
        <li><b>Посмотрите расчёт</b><span>Предварительная цена считается сразу; «Другое» — по фото.</span></li>
        <li><b>Оставьте заявку</b><span>Адрес, удобное время и до трёх фото.</span></li>
        <li><b>Согласуем визит</b><span>Мастер перезвонит, подтвердит цену и время. Статус — по личной ссылке.</span></li>
      </ol>
    </section>
  );
}

export function servicesPage(ctx: PageCtx) {
  const { s, origin } = ctx; const p = s.pricing;
  return Shell({
    ctx, bundle: null, jsonLd: [bizLd(ctx), { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Главная', item: origin + '/' }, { '@type': 'ListItem', position: 2, name: 'Услуги и цены', item: origin + '/uslugi' }] }],
    title: `Цены на химчистку мягкой мебели — ${s.company.name}, ${s.company.city}`,
    description: `Диван от ${formatUAH(fromPrice(s, 'sofa')!)}, кресло от ${formatUAH(fromPrice(s, 'armchair')!)}, матрас от ${formatUAH(fromPrice(s, 'mattress')!)}. Минимальный заказ ${formatUAH(p.minOrder)}.`,
    children: <>
      <Header s={s} />
      <main id="main" className="page">
        <h1>Услуги и цены</h1>
        <p className="lead">Цены предварительные, за единицу. Итог подтверждает мастер после разговора или осмотра.</p>
        <div className="service-grid">
          {CATEGORY_IDS.map((c) => {
            const cat = p.categories[c];
            return (
              <article className="card service" id={SLUG[c]} key={c}>
                <div className="service-poster"><Poster category={c} /></div>
                <h2>{cat.label}</h2>
                {cat.manual ? <p>Пуфы, изголовья, коляски, автокресла и другое. Опишите предмет и приложите фото — стоимость <b>по фото</b>, после оценки.</p>
                  : <table className="price-table"><tbody>{cat.variants.map((v) => <tr key={v.id}><td>{v.label}</td><td>{formatUAH(v.price)}</td></tr>)}</tbody></table>}
                <a className="btn btn-primary" href={`/?c=${c}#vybor`}>Выбрать</a>
              </article>
            );
          })}
        </div>
        <section className="card rules">
          <h2>Как считается стоимость</h2>
          <ul>
            <li>Сильные загрязнения — +{p.heavySoilingPct}% к позиции.</li>
            <li>Вторая сторона матраса — +{p.mattressSecondSidePct}% к цене матраса.</li>
            <li>Цена позиции округляется до {p.roundTo} ₴ и умножается на количество.</li>
            <li>Минимальный заказ на чистку — {formatUAH(p.minOrder)}. Выезд за город — +{formatUAH(p.outOfTownFee)} отдельно.</li>
            <li>Позиции «Другое» оцениваются по фото — до оценки они не входят в сумму.</li>
          </ul>
        </section>
      </main>
      <Footer s={s} />
    </>
  });
}

export function contactsPage(ctx: PageCtx) {
  const { s } = ctx; const c = s.company;
  const tg = c.telegram.replace(/^@/, '');
  const any = c.phone || c.telegram || c.email;
  return Shell({
    ctx, bundle: null, jsonLd: [bizLd(ctx)],
    title: `Контакты — ${c.name}`, description: `${c.name}: ${c.tagline}. ${c.territory}. ${c.hours}.`,
    children: <>
      <Header s={s} />
      <main id="main" className="page narrow">
        <h1>Контакты</h1>
        <div className="card contact-card">
          {c.phone && <p><span className="muted">Телефон</span><a className="big-link" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a></p>}
          {tg && <p><span className="muted">Telegram</span><a className="big-link" href={`https://t.me/${tg}`} rel="noopener">@{tg}</a></p>}
          {c.email && <p><span className="muted">Email</span><a className="big-link" href={`mailto:${c.email}`}>{c.email}</a></p>}
          {!any && <p className="notice">Контакты компании ещё не заполнены. Оставьте заявку на сайте — мы свяжемся по указанному вами телефону.</p>}
          <p><span className="muted">Режим работы</span>{c.hours}</p>
          <p><span className="muted">Территория</span>{c.territory}</p>
          <a className="btn btn-primary" href="/#vybor">Оставить заявку</a>
        </div>
      </main>
      <Footer s={s} />
    </>
  });
}

export function privacyPage(ctx: PageCtx) {
  const { s } = ctx;
  return Shell({
    ctx, bundle: null, title: `Политика конфиденциальности — ${s.company.name}`, description: 'Какие данные мы собираем при оформлении заявки и как их используем.',
    children: <>
      <Header s={s} />
      <main id="main" className="page narrow prose">
        <h1>Политика конфиденциальности</h1>
        <p>Оператор данных: {s.company.legalName}. Шаблон политики — проверьте его с юристом перед запуском.</p>
        <h2>Что мы собираем</h2>
        <p>Имя, телефон, адрес, пожелания по дате и времени, комментарий и фотографии мебели, которые вы отправляете в заявке.</p>
        <h2>Зачем</h2>
        <p>Чтобы связаться с вами, оценить стоимость, согласовать выезд и выполнить работу. Мы не продаём и не передаём данные третьим лицам, кроме хостинга, на котором работает сайт.</p>
        <h2>Как храним</h2>
        <p>Заявки и фото хранятся в базе данных компании. Фото доступны только владельцу в защищённом кабинете; геометки из снимков удаляются при загрузке. Статус заявки открывается по личной ссылке, которую получаете только вы.</p>
        <h2>Сколько храним и как удалить</h2>
        <p>До выполнения заказа и разумного срока после него. Чтобы удалить данные, напишите нам — контакты на странице <a href="/kontakty">«Контакты»</a>.</p>
        <h2>Локальное хранилище браузера</h2>
        <p>Корзина и черновик формы сохраняются только в вашем браузере, чтобы не потерять их при перезагрузке. Рекламных cookies нет.</p>
      </main>
      <Footer s={s} />
    </>
  });
}

export function attributionPage(ctx: PageCtx) {
  const { s } = ctx;
  return Shell({
    ctx, bundle: null, title: `Атрибуция и лицензии — ${s.company.name}`, description: 'Использованные библиотеки, модели и их лицензии.',
    children: <>
      <Header s={s} />
      <main id="main" className="page narrow prose">
        <h1>Атрибуция и лицензии</h1>
        <h2>3D-модели</h2>
        <p>Модели дивана, кресла, матраса, стула и пуфа созданы процедурно для этого проекта (скрипт <code>scripts/build-models.ts</code>) и распространяются вместе с исходниками на условиях лицензии проекта. Сторонние модели не используются.</p>
        <h2>Программные компоненты</h2>
        <ul>
          <li>React и React DOM — MIT, © Meta Platforms, Inc.</li>
          <li>sharp и libvips — Apache-2.0 / LGPL-3.0-or-later (динамическая компоновка).</li>
          <li>esbuild — MIT. TypeScript — Apache-2.0.</li>
          <li>PostgreSQL — PostgreSQL License.</li>
        </ul>
        <p>3D-движок, клиент PostgreSQL и интерфейс написаны для проекта. Полный список — в файле <code>LICENSES.md</code>.</p>
      </main>
      <Footer s={s} />
    </>
  });
}

export function orderShell(ctx: PageCtx) {
  return Shell({ ctx, bundle: 'app', noindex: true, title: `Ваша заявка — ${ctx.s.company.name}`, description: 'Статус заявки',
    children: <><Header s={ctx.s} cta={false} /><main id="main"><div id="app" data-route="order"><p className="page">Загружаем заявку…</p></div></main></> });
}
export function adminShell(ctx: PageCtx) {
  return Shell({ ctx, bundle: 'admin', noindex: true, title: `Кабинет — ${ctx.s.company.name}`, description: 'Кабинет владельца', bodyClass: 'admin-body',
    children: <main id="main"><div id="admin"><p className="page">Загрузка кабинета…</p></div></main> });
}
export function offlinePage(ctx: PageCtx) {
  return Shell({ ctx, bundle: null, noindex: true, title: `Нет сети — ${ctx.s.company.name}`, description: 'Нет подключения',
    children: <main id="main" className="page narrow"><div className="card empty-state"><h1>Нет подключения к интернету</h1><p>Корзина и черновик сохранены в этом браузере. Когда сеть появится, обновите страницу — всё будет на месте.</p><a className="btn" href="/">Обновить</a></div></main> });
}
export function notFoundPage(ctx: PageCtx) {
  return Shell({ ctx, bundle: null, noindex: true, title: 'Страница не найдена', description: '404',
    children: <><Header s={ctx.s} /><main id="main" className="page narrow"><div className="card empty-state"><h1>Такой страницы нет</h1><p>Возможно, ссылка устарела.</p><a className="btn btn-primary" href="/">На главную</a></div></main><Footer s={ctx.s} /></> });
}

export const render = (el: React.ReactElement) => '<!DOCTYPE html>' + renderToString(el);

export function sitemap(origin: string) {
  const urls = ['/', '/uslugi', '/kontakty', '/privacy', '/atribuciya'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}
export function robots(origin: string) {
  return `User-agent: *\nAllow: /\nDisallow: /kabinet\nDisallow: /z/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
}
export function manifest(s: Settings) {
  return JSON.stringify({
    name: `${s.company.name} — ${s.company.tagline}`, short_name: s.company.name, lang: 'ru', start_url: '/?source=pwa', scope: '/',
    display: 'standalone', background_color: '#F5F3EE', theme_color: '#F5F3EE', description: 'Расчёт и заявка на химчистку мягкой мебели',
    icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }]
  });
}
