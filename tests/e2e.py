"""
Сквозная проверка в браузере (Playwright + Chrome). Данные вымышленные.
Запуск: сервер на BASE (по умолчанию http://localhost:3000), OWNER_PASSWORD в окружении.
  python3 tests/e2e.py
Проверяет: выбор и корзину (объединение, удаление с отменой), восстановление черновика после перезагрузки,
фото (успех, отказ сервера по формату), обязательное фото для «Другое», сбой сети при отправке и повтор без дубля,
приватную ссылку, кабинет (вход, согласование цены и времени, заметку), обновление у клиента, игру с бонусом,
закрытые маршруты, мобильную ширину, режим без WebGL и обе темы.
"""
import asyncio, datetime, json, os, re, sys, urllib.request
from playwright.async_api import async_playwright

DATE = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()
BASE = os.environ.get("BASE", "http://localhost:3000")
PW = os.environ.get("OWNER_PASSWORD", "demo-owner-pass-2026")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
SHOTS = os.environ.get("SHOTS", "docs/screens")
GL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
os.makedirs(SHOTS, exist_ok=True)
results = []

def check(name, ok, info=""):
    results.append((name, bool(ok), info)); print(("PASS " if ok else "FAIL ") + name + (f" — {info}" if info else ""))

def png(path):
    # маленький настоящий PNG для загрузки
    import zlib, struct
    raw = b"".join(b"\x00" + bytes([200, 120, 90]) * 64 for _ in range(64))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    open(path, "wb").write(data); return path

async def admin_login(page):
    await page.goto(BASE + "/kabinet"); await page.fill("input[type=password]", PW); await page.click("button:has-text('Войти')")
    await page.wait_for_selector(".admin-nav")

async def main():
    good = png("/tmp/e2e-good.png"); open("/tmp/e2e-fake.jpg", "w").write("это не картинка")
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=GL)
        # ---------------- клиент, десктоп ----------------
        ctx = await b.new_context(viewport={"width": 1366, "height": 860}, permissions=["clipboard-read", "clipboard-write"], service_workers="block")
        page = await ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE + "/"); await page.wait_for_selector(".stage[data-state=ready]", timeout=15000)
        check("3D загрузилось", True)
        await page.screenshot(path=f"{SHOTS}/01-home-desktop.png")
        # диван 3 места, сильные загрязнения
        await page.click(".chip-opt:has-text('3 места')"); await page.click(".config .toggle:has-text('Сильные')")
        price = await page.inner_text(".config-price strong"); check("цена дивана 3 места + 30% = 1 560 ₴", "1 560" in price, price)
        await page.click("button:has-text('Добавить в заказ')")
        # стулья: дважды одинаковые → объединение
        await page.click(".cat-tabs button:has-text('Стул')"); await page.wait_for_timeout(300)
        await page.click("button:has-text('Добавить в заказ')"); await page.click("button:has-text('Добавить в заказ')")
        # «Другое» без описания → ошибка рядом с полем
        await page.click(".cat-tabs button:has-text('Другое')"); await page.click("button:has-text('Добавить в заказ')")
        check("«Другое» без описания — ошибка у поля", "Опишите" in await page.inner_text("#other-desc-err"))
        await page.fill("#other-desc", "Пуф велюровый круглый"); await page.click("button:has-text('Добавить в заказ')")
        cart = await page.evaluate("JSON.parse(localStorage.getItem('pp:cart'))")
        chairs = [i for i in cart if i["category"] == "chair"]
        check("одинаковые позиции объединены", len(chairs) == 1 and chairs[0]["qty"] == 8, json.dumps(chairs, ensure_ascii=False))
        await page.click("[data-order-link]"); await page.wait_for_selector(".checkout")
        txt = await page.inner_text(".checkout .quote")
        check("смешанный заказ: известная часть + «по фото»", "по фото" in txt and "Известная часть" in txt, txt.replace("\n", " ")[:160])
        # удаление с отменой
        n0 = await page.locator(".cart-line").count()
        await page.locator(".cart-line").nth(0).locator("button:has-text('Удалить')").click()
        n1 = await page.locator(".cart-line").count(); await page.click(".toast-action"); n2 = await page.locator(".cart-line").count()
        check("удаление позиции и «Вернуть»", n1 == n0 - 1 and n2 == n0, f"{n0}->{n1}->{n2}")
        # черновик формы переживает перезагрузку
        await page.fill("#f-name", "Олеся Тестовая"); await page.fill("#f-phone", "+380 50 000 11 22"); await page.fill("#f-address", "ул. Вымышленная, 7, кв. 3")
        await page.reload(); await page.wait_for_selector("#f-name")
        check("черновик и корзина восстановлены после перезагрузки", await page.input_value("#f-name") == "Олеся Тестовая" and await page.locator(".cart-line").count() == n0)
        # время без даты недоступно
        check("время недоступно без даты", await page.is_disabled("#f-time"))
        # отправка без согласия и фото → ошибки рядом с полями
        await page.click("button:has-text('Отправить заявку')"); await page.wait_for_timeout(300)
        check("ошибки у полей: согласие и фото", "согласие" in (await page.inner_text("#consent-err")).lower() and "фото" in await page.inner_text("#photos-err"))
        # фото: подделка отклоняется сервером, настоящий PNG загружается
        await page.set_input_files(".photo-add input", {"name": "fake.jpg", "mimeType": "image/jpeg", "buffer": open("/tmp/e2e-fake.jpg", "rb").read()})
        await page.wait_for_selector(".photo-error", timeout=8000)
        check("сервер отклонил файл не-изображение", "JPEG" in await page.inner_text(".photo-error figcaption"))
        await page.locator(".photo-error .photo-x").click()
        await page.set_input_files(".photo-add input", good); await page.wait_for_selector(".photo-done", timeout=8000)
        check("фото загружено", await page.locator(".photo-done").count() == 1)
        await page.fill("#f-date", DATE); await page.fill("#f-time", "11:30")
        await page.check("input[name=consent]"); await page.click(".form .toggle")
        # сбой сети: запрос дошёл до сервера, ответ потерян → повтор с тем же ключом
        state = {"n": 0}
        async def drop(route):
            state["n"] += 1
            if state["n"] == 1:
                await route.fetch(); await route.abort("connectionreset")
            else: await route.continue_()
        await page.route("**/api/orders", drop)
        await page.click("button:has-text('Отправить заявку')")
        await page.wait_for_selector(".banner", timeout=8000)
        check("сбой сети: сообщение и данные сохранены", "дубля не будет" in await page.inner_text(".banner"))
        await page.click("button:has-text('Отправить заявку')")
        await page.wait_for_url(re.compile(r"/z/[\w-]+$"), timeout=10000)
        await page.unroute("**/api/orders")
        url = page.url; token = url.rsplit("/", 1)[1]
        await page.wait_for_selector(".order-head")
        check("после записи открыта приватная ссылка", "Заявка принята" in await page.inner_text(".order-head"))
        await page.screenshot(path=f"{SHOTS}/04-order-new.png", full_page=True)
        await page.click("button:has-text('Скопировать')"); await page.wait_for_timeout(200)
        check("ссылку можно скопировать", "Скопировано" in await page.inner_text(".copy-row button"))
        check("корзина очищена после успеха", await page.evaluate("JSON.parse(localStorage.getItem('pp:cart')).length") == 0)
        # ---------------- кабинет ----------------
        actx = await b.new_context(viewport={"width": 1366, "height": 860}); ap = await actx.new_page()
        await ap.goto(BASE + "/kabinet"); await ap.wait_for_selector(".login-card")
        check("кабинет закрыт без входа", True)
        await admin_login(ap)
        await ap.wait_for_selector(".order-row")
        rows = await ap.locator(".order-row:has-text('Олеся Тестовая')").count()
        check("повтор без дубля: в базе одна заявка клиента", rows == 1, f"строк: {rows}")
        await ap.screenshot(path=f"{SHOTS}/05-admin-list.png")
        await ap.locator(".order-row:has-text('Олеся Тестовая')").click(); await ap.wait_for_selector(".detail")
        check("в кабинете есть фото клиента", await ap.locator(".admin-photos img").count() == 1)
        await ap.select_option(".detail select", "agreed"); await ap.click("button:has-text('Сохранить')"); await ap.wait_for_timeout(400)
        check("«Согласована» без цены и времени — ошибки у полей", "итоговую цену" in await ap.inner_text(".detail"))
        await ap.locator(".detail input[type=number]").fill("3150")
        await ap.locator(".detail input[type=datetime-local]").fill(DATE + "T12:00")
        await ap.locator(".detail textarea").fill("Приватно: код домофона 12К (вымышленный)")
        await ap.click("button:has-text('Сохранить')"); await ap.wait_for_selector("p.ok")
        await ap.screenshot(path=f"{SHOTS}/06-admin-detail.png", full_page=True)
        # клиент видит изменения по той же ссылке
        await page.reload(); await page.wait_for_selector(".order-head")
        body = await page.inner_text("main")
        check("клиент видит «Согласована», цену и время", "Согласована" in body and "3 150" in body and "12:00" in body)
        check("приватная заметка не видна клиенту", "домофона" not in body)
        api = json.loads(urllib.request.urlopen(f"{BASE}/api/orders/{token}").read())
        check("публичный API не отдаёт заметку, телефон и фото", "домофона" not in json.dumps(api, ensure_ascii=False) and "phone" not in json.dumps(api.get("items")) and "photos" not in api)
        # чужую заявку по номеру не открыть
        r404 = await page.goto(BASE + "/z/" + "A" * 43); await page.wait_for_selector(".empty-state")
        check("чужая/выдуманная ссылка → «не найдена»", "не найдена" in await page.inner_text(".empty-state"))
        # ---------------- игра с бонусом ----------------
        await ap.goto(BASE + "/kabinet#game"); await ap.wait_for_selector("text=Режим мини-игры")
        await ap.check("input[name=gm] >> nth=2"); await ap.click("button:has-text('Сохранить')"); await ap.wait_for_selector(".savebar .ok")
        await page.goto(url); await page.wait_for_selector(".game")
        await page.click(".game button:has-text('Играть')"); await page.wait_for_selector(".game .stage[data-state=ready]", timeout=15000)
        await page.locator(".game .stage").scroll_into_view_if_needed(); await page.wait_for_timeout(600)
        box = await page.locator(".game canvas").bounding_box()
        prog = 0
        for sweep in range(14):
            for row in range(26):
                y = box["y"] + box["height"] * (0.12 + 0.78 * row / 25)
                await page.mouse.move(box["x"] + box["width"] * 0.12, y); await page.mouse.down()
                await page.mouse.move(box["x"] + box["width"] * 0.88, y, steps=24); await page.mouse.up()
            if await page.locator(".game-done").count(): prog = 100; break
            prog = int((await page.inner_text(".game-progress span")).rstrip("%"))
            if prog >= 85: break
            # режимы разделены: поворот — отдельной кнопкой; чередуем ракурсы ±25°
            await page.click(".game .stage button:has-text('Ракурс')"); await page.wait_for_timeout(300)
            await page.click(".seg button:has-text('Вращать')"); await page.mouse.move(box["x"] + 300, box["y"] + 200); await page.mouse.down()
            await page.mouse.move(box["x"] + 300 + (45 if sweep % 2 else -45), box["y"] + 200, steps=6); await page.mouse.up(); await page.wait_for_timeout(500)
            await page.click(".seg button:has-text('Чистить')")
        if prog < 100: await page.locator(".game .stage").screenshot(path=f"{SHOTS}/07-game.png")
        await page.wait_for_selector(".game-done", timeout=8000) if prog >= 85 else None
        done = await page.locator(".game-done").count()
        check("игра: пятна стираются (raycast+UV-маска), прогресс ≥ 85%, выдан код", prog >= 85 and done == 1 and "PP-" in (await page.inner_text(".game-done") if done else ""), f"прогресс {prog}%")
        await ap.goto(BASE + "/kabinet#game"); await ap.wait_for_selector("text=Режим мини-игры"); await ap.check("input[name=gm] >> nth=1"); await ap.click("button:has-text('Сохранить')")
        await ctx.close(); await actx.close()
        # ---------------- телефон: ширина 390, тёмная тема ----------------
        m = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme="dark")
        mp = await m.new_page()
        await mp.goto(BASE + "/"); await mp.wait_for_selector(".stage[data-state=ready]", timeout=15000)
        await mp.screenshot(path=f"{SHOTS}/08-mobile-dark.png")
        await mp.tap(".cat-tabs button:has-text('Матрас')"); await mp.tap(".config .toggle:has-text('вторую')")
        check("моб.: матрас односпальный + 2-я сторона = 1 120 ₴", "1 120" in await mp.inner_text(".config-price strong"), await mp.inner_text(".config-price strong"))
        await mp.tap("button:has-text('Добавить в заказ')"); await mp.tap("[data-order-link]"); await mp.wait_for_selector(".checkout")
        await mp.screenshot(path=f"{SHOTS}/09-mobile-checkout.png", full_page=True)
        overflow = await mp.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        check("моб.: нет горизонтальной прокрутки", not overflow)
        small = await mp.evaluate("""[...document.querySelectorAll('.checkout button, .checkout .toggle, .checkout .check, .checkout input:not([type=checkbox]):not([type=file]), .checkout select')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height<36}).map(e=>e.className||e.tagName+':'+e.type).join(',')""")
        check("моб.: зоны нажатия не меньше 36 px", small == "", f"мелкие: {small}")
        await m.close()
        # ---------------- без WebGL ----------------
        b2 = await p.chromium.launch(executable_path=CHROME, args=["--disable-3d-apis", "--disable-webgl"])
        n = await (await b2.new_context(viewport={"width": 390, "height": 844})).new_page()
        await n.goto(BASE + "/"); await n.wait_for_selector(".stage[data-state=nowebgl]")
        await n.click("button:has-text('Добавить в заказ')")
        check("без WebGL: постер и заказ доступен", await n.locator(".stage-fallback .poster").count() == 1 and await n.locator(".cart-peek").count() == 1)
        await n.screenshot(path=f"{SHOTS}/10-no-webgl.png")
        await b2.close()
        # ---------------- ошибка загрузки модели с повтором ----------------
        e = await (await b.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")).new_page()
        await e.route("**/models/**", lambda r: r.abort())
        await e.goto(BASE + "/"); await e.wait_for_selector(".stage[data-state=error]", timeout=15000)
        await e.unroute("**/models/**"); await e.click(".stage button:has-text('Повторить')")
        await e.wait_for_selector(".stage[data-state=ready]", timeout=15000)
        check("ошибка загрузки 3D → «Повторить» → модель", True)
        # ---------------- публичные страницы и SEO ----------------
        for path, needle in [("/uslugi", "Услуги и цены"), ("/kontakty", "Контакты"), ("/privacy", "Политика"), ("/atribuciya", "Атрибуция")]:
            await e.goto(BASE + path); check(f"страница {path}", needle in await e.inner_text("h1"))
        await e.goto(BASE + "/uslugi"); await e.screenshot(path=f"{SHOTS}/11-services.png", full_page=True)
        robots = urllib.request.urlopen(BASE + "/robots.txt").read().decode()
        check("robots закрывает /kabinet, /z/, /api/", all(x in robots for x in ["/kabinet", "/z/", "/api/"]))
        check("sitemap", "<urlset" in urllib.request.urlopen(BASE + "/sitemap.xml").read().decode())
        check("ошибок JS на страницах клиента нет", not errors, "; ".join(errors[:3]))
        await b.close()
    fails = [r for r in results if not r[1]]
    print(f"\nИТОГО: {len(results) - len(fails)}/{len(results)} проверок пройдено")
    sys.exit(1 if fails else 0)

asyncio.run(main())
