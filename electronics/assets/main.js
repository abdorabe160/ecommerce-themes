/* =========================================================
   Liquid Glass — Electronics Theme
   يعتمد على Store SDK (window.qumra) إن وُجد، وإلا يستخدم Store AJAX مباشرة.
   ========================================================= */

(function () {
  'use strict';

  const THEME = window.__theme || {};
  const I18N = THEME.i18n || {};
  // حد "أوشك على النفاد" (PRD-23/24): من 1 إلى 3 قطع
  // حد "أوشك على النفاد" من إعدادات الثيم (افتراضياً 3 كما في خطة اختبار قمرة)
  const LOW_STOCK_THRESHOLD = Math.max(1, parseInt(THEME.lowStock, 10) || 3);
  // حالة المخزون من الكمية دائماً (PRD-22..28): 0 نفد، 1–3 أوشك على النفاد، والسلة لا تتجاوز المتاح.
  // قمرة ترسل افتراضياً trackQuantity=false و allowBackorder=true لكل المنتجات، وصفحة المنتج وحدها ترسل trackQuantity
  // (القوائم لا ترسله) — فاتّباع هذه الإعدادات يُظهر "نفد" في البطاقة و"متوفر" في صفحة المنتج لنفس المنتج.
  // التاجر الذي لا يتتبع المخزون فعلاً يفعّل "اتّباع إعدادات المخزون لكل منتج" من إعدادات الثيم ← المخزون.
  const FOLLOW_PRODUCT_STOCK = THEME.followStock === true;
  const untracked = (p) => FOLLOW_PRODUCT_STOCK && !!p && p.trackQuantity === false;
  const backorders = (p) => FOLLOW_PRODUCT_STOCK && !!(p && p.allowBackorder);
  // إعدادات الثيم: إيقاف الحركات (html.lg-no-motion) وفتح السلة بعد الإضافة
  const NO_MOTION = document.documentElement.classList.contains('lg-no-motion');
  const CART_OPEN_ON_ADD = THEME.cartOpenOnAdd !== false;

  /* ---------- Helpers ---------- */

  function readJSON(id, fallback) {
    try {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const txt = (el.textContent || '').trim();
      return txt ? JSON.parse(txt) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function safeStorage(kind) {
    try {
      const s = window[kind];
      const k = '__lg_test__';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) {
      return null;
    }
  }

  function toLatinDigits(str) {
    return String(str)
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  }

  /*
   * تنسيق العملة في الـ JS مستنتج من مخرجات فلتر | money على السيرفر لقيمة معروفة (123456)،
   * فيطابق تنسيق السيرفر تماماً: الرمز، موضعه، عدد الخانات، والوحدة الصغرى (REG-05..09).
   * لا يوجد أي رمز عملة مكتوب في الكود.
   */
  const Money = (function () {
    const sample = toLatinDigits(THEME.moneySample || '');
    const match = sample.match(/\d[\d,.\s٫٬]*\d|\d/);
    let divisor = 100;
    let decimals = 2;
    let template = '{{amount}}';

    if (match) {
      const raw = match[0].replace(/[\s٬]/g, '').replace('٫', '.');
      const sep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
      const tail = sep > -1 ? raw.length - sep - 1 : 0;
      decimals = sep > -1 && tail <= 2 ? tail : 0;
      const value = parseInt(raw.replace(/[^\d]/g, ''), 10) / Math.pow(10, decimals);
      if (value > 0) divisor = 123456 / value;
      template = sample.replace(match[0], '{{amount}}');
    }

    return {
      // قيمة بالوحدة الكبرى (999) → بنفس وحدة أسعار المتجر (للبيانات التوضيحية فقط)
      fromMajor(v) {
        return Math.round((Number(v) || 0) * divisor);
      },
      toNumber(amount) {
        return Number(((Number(amount) || 0) / divisor).toFixed(decimals));
      },
      format(amount) {
        const v = (Number(amount) || 0) / divisor;
        return template.replace('{{amount}}', v.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }));
      }
    };
  })();

  // نسبة الخصم: تقريب لأسفل (500 من 800 = 37%) — PRD-18
  function discountPercent(price, compare) {
    price = Number(price) || 0;
    compare = Number(compare) || 0;
    return compare > price && compare > 0 ? Math.floor(((compare - price) / compare) * 100) : 0;
  }

  function stockState(qty, opts) {
    opts = opts || {};
    if (opts.untracked || opts.backorder) return 'in';
    if (typeof qty !== 'number' || isNaN(qty)) return 'in';
    if (qty <= 0) return 'out';
    if (qty <= LOW_STOCK_THRESHOLD) return 'low';
    return 'in';
  }

  async function http(method, url, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || (data && data.success === false)) {
      const err = new Error((data && data.message) || I18N.error || 'Error');
      err.data = data;
      throw err;
    }
    return data;
  }

  const sdk = () => (window.qumra && typeof window.qumra === 'object' ? window.qumra : null);

  function normalizeCart(res) {
    if (!res) return null;
    const cart = res.cart && res.cart.items ? res.cart : res;
    return cart && Array.isArray(cart.items) ? cart : null;
  }

  function pickArray(res, keys) {
    if (Array.isArray(res)) return res;
    if (!res || typeof res !== 'object') return [];
    for (const k of keys) {
      let v = res;
      for (const p of k.split('.')) v = v && v[p];
      if (Array.isArray(v)) return v;
    }
    return [];
  }

  function plainText(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /*
   * وضع المعاينة: التطوير المحلي (qumra theme dev)، محرر الثيم (iframe) أو رابط معاينة ثيم.
   * البيانات التوضيحية تظهر هنا فقط — لا تظهر لعملاء المتجر الحي إطلاقاً.
   */
  function isPreview() {
    try {
      const l = window.location;
      if (l.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(l.hostname)) return true;
      if (/[?&](theme|theme_id|preview|preview_theme_id|editor)=/.test(l.search)) return true;
      return window.self !== window.top;
    } catch (e) {
      return true; // iframe من نطاق مختلف (المحرر)
    }
  }

  // kind: featured | best | all | collections — بدون بيانات داخل العنصر نقرأ من الكتالوج العام (ui/demo-pages.njk)
  /* ---------- الوضع الداكن/الفاتح ----------
     يُطبَّق قبل أول رسم من layout.njk؛ هنا التبديل من زر الزائر وحفظه، ومتابعة الجهاز في الوضع "تلقائي". */
  const SCHEME_KEY = 'lg-scheme';
  const schemeRoot = document.documentElement;
  const schemeSaved = () => {
    if (schemeRoot.getAttribute('data-scheme-toggle') === 'off') return null;
    try { const s = localStorage.getItem(SCHEME_KEY); return s === 'dark' || s === 'light' ? s : null; } catch (e) { return null; }
  };
  function applyScheme(s, from) {
    const set = () => schemeRoot.setAttribute('data-scheme', s);
    const reduce = NO_MOTION || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!from || reduce) return set();
    // انتقال دائري من مكان الزر (View Transitions)، وإلا تلاشٍ قصير للألوان
    if (document.startViewTransition) {
      const x = from.clientX || window.innerWidth / 2;
      const y = from.clientY || 0;
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      schemeRoot.classList.add('lg-vt-scheme');
      const vt = document.startViewTransition(set);
      vt.finished.finally(() => schemeRoot.classList.remove('lg-vt-scheme'));
      vt.ready.then(() => {
        schemeRoot.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
      }).catch(() => {});
      return;
    }
    schemeRoot.classList.add('lg-scheme-anim');
    set();
    setTimeout(() => schemeRoot.classList.remove('lg-scheme-anim'), 450);
  }

  function parseDemo(el) {
    if (!el) return [];
    try {
      const list = JSON.parse(el.textContent || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function readDemo(root, kind) {
    const sel = (k) => 'script.lg-demo-json' + (k ? '[data-kind="' + k + '"]' : '');
    const el = (root && root.querySelector(sel(kind))) || document.querySelector('#lg-demo-catalog ' + sel(kind || 'all'));
    if (el && el.getAttribute('data-kind') === 'all' && el.closest('#lg-demo-catalog')) return demoCatalog(el).slice();
    return parseDemo(el);
  }

  /* الكتالوج التوضيحي الكامل + التصنيف الضخم: تصنيف فيه "bulk": N يُكمَّل هنا إلى N منتج من قوالب "bulk_items"
     (ماركات وإصدارات وأسعار ومخزون متنوعة لكن ثابتة بين التحديثات) — اختبار الأداء والترقيم والبحث بدون تضخيم HTML. يُبنى مرة واحدة. */
  const BULK_BRANDS = ['Logitech', 'Razer', 'Keychron', 'Corsair', 'SteelSeries', 'HyperX', 'Anker', 'Ugreen', 'Baseus', 'Redragon'];
  const BULK_SERIES = ['Pro', 'Lite', 'Max', 'Air', 'X', 'Elite', 'Mini', 'Plus'];
  let demoCatalogCache = null;
  function demoCatalog(el) {
    if (demoCatalogCache) return demoCatalogCache;
    const list = parseDemo(el);
    parseDemo(document.querySelector('#lg-demo-catalog script.lg-demo-json[data-kind="collections"]')).forEach((c) => {
      const total = parseInt(c.bulk, 10) || 0;
      const items = Array.isArray(c.bulk_items) ? c.bulk_items.filter((t) => t && t.title) : [];
      if (!total || !items.length) return;
      const have = list.filter((d) => d.cat === c._id).length;
      for (let k = 1; k <= total - have; k++) {
        const t = items[k % items.length];
        const price = Math.max(5, Math.round((t.price || 50) * (0.6 + ((k * 37) % 90) / 100)));
        list.push({
          _id: c._id.replace(/^demo-c-/, 'demo-') + '-' + k,
          stock: 4 + ((k * 13) % 40), // 4+ = متوفر؛ حالات "أوشك على النفاد" و"نفد" منتجات مستقلة في demo-data.njk
          cat: c._id,
          title: BULK_BRANDS[k % BULK_BRANDS.length] + ' ' + t.title + ' ' + BULK_SERIES[Math.floor(k / BULK_BRANDS.length) % BULK_SERIES.length] + ' ' + (100 + k),
          image: t.image,
          price,
          compare: k % 6 === 0 ? Math.round(price * 1.25) : 0,
          reviews: (k * 7) % 300,
          rating: Math.round((4 + ((k * 3) % 10) / 10) * 10) / 10,
          tags: []
        });
      }
    });
    demoCatalogCache = list;
    return list;
  }

  /*
   * لغة المسار (/en/...) — روابط قديمة/مشاركة فقط: اللغة نفسها تُحفظ في كوكي lang (switchLanguage أدناه).
   * زائر وصل ببادئة وبدون كوكي: نضيف نفس البادئة لكل رابط داخلي (بما فيها روابط Alpine) وللتنقل البرمجي حتى تبقى لغته — GEN-03.
   */
  const LANGS = Array.isArray(THEME.languages) && THEME.languages.length ? THEME.languages : ['ar', 'en'];
  const LANG_PREFIX = (function () {
    const m = window.location.pathname.match(/^\/([a-z]{2})(?=\/|$)/);
    return m && m[1] === document.documentElement.lang ? '/' + m[1] : '';
  })();
  // الرابط يبدأ ببادئة لغة (أي لغة)؟ — لا نضيف فوقها (يمنع /ar/en/...)
  const hasLangPrefix = (url) => LANGS.some((l) => url === '/' + l || url.indexOf('/' + l + '/') === 0 || url.indexOf('/' + l + '?') === 0);
  function withLang(url) {
    if (!LANG_PREFIX || typeof url !== 'string' || url.charAt(0) !== '/' || url.charAt(1) === '/') return url;
    if (hasLangPrefix(url)) return url;
    if (/^\/(ajax|assets|cdn-cgi|checkout)(\/|\?|$)/.test(url)) return url;
    return LANG_PREFIX + url;
  }

  // المسار بدون أي بادئة لغة (حتى المكررة /en/en/) — لا نعتمد على تطابقها مع لغة الصفحة: لو تجاهل السيرفر البادئة
  // (المحرر أو طلب فشل عبر proxy التطوير) فرجعت الصفحة بلغة أخرى، كان المبدّل يضيف البادئة فوق نفسها ← /en/en/... (404)
  function pathWithoutLang(pathname) {
    let path = pathname || '/';
    while (hasLangPrefix(path)) path = path.replace(/^\/[a-z]{2}(?=\/|\?|$)/, '');
    return path || '/';
  }

  /*
   * تبديل اللغة بدون تغيير الرابط (ui/lang-switch.njk): قمرة تحدد لغة الصفحة من كوكي "lang"، والكوكي يغلب بادئة الرابط
   * (كوكي lang=ar + /en = صفحة عربية — لذلك كان المبدّل القديم بالبادئة يغيّر الرابط فقط). نكتب الكوكي ونعيد تحميل نفس الصفحة.
   * السيرفر يقبل ar | en فقط: أي قيمة أخرى (ar-EG، EN، فارغة…) = خطأ 500 لكل الصفحات، فلا نكتب غيرهما أبداً.
   * عند تكرار الاسم (نسخة قديمة بمسار/نطاق آخر) يأخذ السيرفر آخر قيمة، والمتصفح يرسل الأحدث أخيراً — فنحذف القديم ثم نكتب.
   */
  const LANG_COOKIE = 'lang';
  const SWITCH_LANGS = ['ar', 'en'];
  const LANG_PENDING = 'lg-lang-pending';

  // آخر قيمة لكوكي lang — نفس القيمة التي يختارها السيرفر عند التكرار
  function langCookie() {
    let value = null;
    String(document.cookie || '').split(';').forEach((c) => {
      const i = c.indexOf('=');
      if (i > -1 && c.slice(0, i).trim() === LANG_COOKIE) value = c.slice(i + 1).trim();
    });
    return value;
  }

  // حذف كل نسخ كوكي lang التي قد تكون موجودة: المسار الحالي وآباؤه × بلا نطاق والنطاق ونطاقاته الأب (turath.qumra.store ← .qumra.store)
  function clearLangCookies() {
    const host = window.location.hostname;
    const parts = host.split('.');
    const domains = [''];
    if (!/^[\d.]+$/.test(host) && parts.length > 1) {
      for (let i = 0; i < parts.length - 1; i++) domains.push('; domain=.' + parts.slice(i).join('.'));
    }
    const paths = ['/'];
    window.location.pathname.split('/').filter(Boolean).reduce((acc, seg) => { paths.push(acc + '/' + seg); return acc + '/' + seg; }, '');
    const https = window.location.protocol === 'https:';
    domains.forEach((d) => paths.forEach((p) => {
      document.cookie = LANG_COOKIE + '=; path=' + p + d + '; max-age=0';
      if (https) document.cookie = LANG_COOKIE + '=; path=' + p + d + '; max-age=0; SameSite=None; Secure; Partitioned';
    }));
  }

  // يرجع true إذا أصبح الكوكي مقروءاً بالقيمة الجديدة (الكوكيز غير محظورة)
  function writeLangCookie(lang) {
    const base = LANG_COOKIE + '=' + lang + '; path=/; max-age=31536000';
    const https = window.location.protocol === 'https:';
    let framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    clearLangCookies();
    // داخل محرر الثيم (iframe): كوكي مقسّم (CHIPS) يعمل حتى مع حظر كوكيز الطرف الثالث — ثم العادي
    if (framed && https) {
      document.cookie = base + '; SameSite=None; Secure; Partitioned';
      if (langCookie() === lang) return true;
      document.cookie = base + '; SameSite=None; Secure';
      if (langCookie() === lang) return true;
    }
    document.cookie = base + '; SameSite=Lax' + (https ? '; Secure' : '');
    return langCookie() === lang;
  }

  function switchLanguage(lang) {
    if (SWITCH_LANGS.indexOf(lang) === -1) return;
    const l = window.location;
    // رابط قديم ببادئة لغة (/en/shop): نفس الصفحة بدون البادئة — الكوكي وحده يحدد اللغة
    const path = pathWithoutLang(l.pathname);
    if (!writeLangCookie(lang)) {
      // الكوكيز معطلة في المتصفح: البديل الوحيد بادئة الرابط
      l.assign('/' + lang + (path === '/' ? '' : path) + l.search + l.hash);
      return;
    }
    const session = safeStorage('sessionStorage');
    if (session) session.setItem(LANG_PENDING, lang);
    if (path === l.pathname) l.reload();
    else l.replace(path + l.search + l.hash);
  }

  function initLangSwitch() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-lang-switch]');
      if (!btn) return;
      e.preventDefault();
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      switchLanguage(btn.getAttribute('data-lang-switch'));
    });
    // رجوع/تقدّم المتصفح يعرض الصفحة من الذاكرة (bfcache أو الكاش) بلغتها القديمة بعد التبديل ← إعادة تحميل بلغة الكوكي.
    // إعادة التحميل نوعها "reload" فلا تتكرر حتى لو خالف السيرفر الكوكي.
    const sync = () => {
      const want = langCookie();
      if (SWITCH_LANGS.indexOf(want) > -1 && want !== document.documentElement.lang) window.location.reload();
    };
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      // زر عاد من bfcache وهو ما زال في حالة التحميل
      document.querySelectorAll('[data-lang-switch][aria-busy]').forEach((b) => b.removeAttribute('aria-busy'));
      sync();
    });
    const nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (nav && nav.type === 'back_forward') sync();
  }
  initLangSwitch();

  /* ---------- مبدّل العملة (GEN-15) — ui/currency-switch.njk ----------
     قمرة تحدد العملة من كوكي "currency": نكتبه (ونمسح نسخ النطاقات الأعلى) ونعيد تحميل نفس الصفحة فتُرسم كل الأسعار بالعملة الجديدة.
     الأزرار تُركّب فقط مع عملتين فأكثر — متجر بعملة واحدة لا يرى مبدّلاً بلا هدف. */
  function initCurrencySwitch() {
    const hosts = document.querySelectorAll('[data-currency-host]');
    if (!hosts.length) return;
    const seed = hosts[0].dataset;
    const codes = Array.from(new Set([seed.currencies || '', seed.platform || ''].join(',')
      .split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c))));
    if (codes.length < 2) return;
    const current = (seed.current || '').toUpperCase();
    const label = I18N.currencySwitch || '{code}';
    hosts.forEach((host) => {
      host.textContent = '';
      codes.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lg-currency__btn' + (c === current ? ' is-active' : '');
        b.textContent = c;
        b.setAttribute('lang', 'en');
        b.setAttribute('dir', 'ltr');
        if (c === current) b.setAttribute('aria-current', 'true');
        else { b.setAttribute('data-currency-switch', c); b.setAttribute('aria-label', label.replace('{code}', c)); }
        host.appendChild(b);
      });
      host.hidden = false;
    });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-currency-switch]');
      if (!btn) return;
      e.preventDefault();
      const code = String(btn.getAttribute('data-currency-switch') || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(code) || btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      const parts = window.location.hostname.split('.');
      const domains = [''];
      for (let i = 0; i < parts.length - 1; i++) domains.push('; domain=.' + parts.slice(i).join('.'));
      domains.forEach((d) => { document.cookie = 'currency=; path=/; max-age=0' + d; });
      document.cookie = 'currency=' + code + '; path=/; max-age=31536000; SameSite=Lax' + (window.location.protocol === 'https:' ? '; Secure' : '');
      window.location.reload();
    });
  }
  initCurrencySwitch();

  // بعد التبديل: هل رسم السيرفر الصفحة باللغة المطلوبة؟ (يُستدعى من qumraApp لعرض رسالة إن فشل)
  function takeLangSwitchResult() {
    const session = safeStorage('sessionStorage');
    const want = session && session.getItem(LANG_PENDING);
    if (!want) return null;
    session.removeItem(LANG_PENDING);
    return want === document.documentElement.lang;
  }

  function initLangLinks() {
    if (!LANG_PREFIX) return;
    const fix = (a) => {
      if (a.hasAttribute('data-lang-switch')) return;
      const href = a.getAttribute('href');
      const next = withLang(href);
      if (next !== href) a.setAttribute('href', next);
    };
    const scan = (root) => {
      if (root.matches && root.matches('a[href^="/"]')) fix(root);
      if (root.querySelectorAll) root.querySelectorAll('a[href^="/"]').forEach(fix);
    };
    scan(document);
    new MutationObserver((records) => records.forEach((r) => {
      if (r.type === 'attributes') { if (r.target.tagName === 'A') fix(r.target); } else r.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
    })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
    document.addEventListener('submit', (e) => {
      const f = e.target;
      const action = f && f.getAttribute && f.getAttribute('action');
      if (action) f.setAttribute('action', withLang(action));
    }, true);
  }
  initLangLinks();

  /* القوايم (/shop والمقترحة والبحث) مش بتبعت options ولا variants ولا variantsCount: ده معناه "مش معروف"، مش "منتج بسيط" */
  const productHasOpts = (p) => !!(p && ((p.options && p.options.length) || p.variantsCount > 0 || (p.variants && p.variants.length)));
  const knownSimple = (p) => !!p && !productHasOpts(p) && (p.variantsCount === 0 || Array.isArray(p.variants));
  // بيانات منتج كاملة (/ajax/product أو صفحة المنتج): نفد؟
  function fullProductOut(p) {
    if (!p || untracked(p) || backorders(p)) return false;
    if (Array.isArray(p.variants) && p.variants.length) return p.variants.every((v) => typeof v.quantity === 'number' && v.quantity <= 0);
    return typeof p.quantity === 'number' && p.quantity <= 0;
  }
  /* تأكيد المخزون على الكروت: قرب الشاشة بس، وطلبين بالكتير في نفس الوقت (429 مع الطلبات الكتير) */
  const CardWatch = {
    queue: [],
    active: 0,
    io: null,
    add(el, job) {
      if (!('IntersectionObserver' in window)) return this.push(job);
      if (!this.io) {
        this.io = new IntersectionObserver((entries) => entries.forEach((e) => {
          if (!e.isIntersecting) return;
          this.io.unobserve(e.target);
          if (e.target.__lgCardJob) this.push(e.target.__lgCardJob);
          e.target.__lgCardJob = null;
        }), { rootMargin: '300px' });
      }
      el.__lgCardJob = job;
      this.io.observe(el);
    },
    push(job) {
      this.queue.push(job);
      this.next();
    },
    next() {
      while (this.active < 2 && this.queue.length) {
        this.active++;
        Promise.resolve(this.queue.shift()()).catch(() => {}).then(() => { this.active--; this.next(); });
      }
    }
  };

  /*
   * المخزون المتاح لكل منتج/متغير — سلة قمرة لا ترجع المخزون مع سطورها، فنسجّله من المنتجات
   * المعروضة (البطاقات، صفحة المنتج، البيانات التوضيحية) ونكمله من /ajax/product لسطور السلة.
   * القيمة: رقم = الكمية المتاحة، null = غير محدود (لا يتتبع المخزون أو يسمح بالطلب المسبق)، undefined = غير معروف.
   */
  const Stock = {
    map: {},
    key: (productId, variantId) => String(productId) + ':' + String(variantId || ''),
    get(productId, variantId) {
      return this.map[this.key(productId, variantId)];
    },
    set(productId, variantId, qty) {
      if (!productId) return;
      const v = typeof qty === 'number' && !isNaN(qty) ? Math.max(0, qty) : null;
      const k = this.key(productId, variantId);
      if (this.map[k] === v) return;
      this.map[k] = v;
      // حدث واحد لكل دفعة (تسجيل 1000 منتج توضيحي = حدث واحد بدل 1000 إعادة حساب)
      if (this._queued) return;
      this._queued = true;
      queueMicrotask(() => { this._queued = false; window.dispatchEvent(new CustomEvent('lg-stock')); });
    },
    // من كائن منتج: المنتج نفسه + كل متغيراته
    remember(p) {
      if (!p || !p._id) return;
      const unlimited = untracked(p) || backorders(p);
      if (unlimited) this.set(p._id, '', null);
      else if (typeof p.quantity === 'number') this.set(p._id, '', p.quantity);
      (Array.isArray(p.variants) ? p.variants : []).forEach((v) => {
        if (!v || !v._id) return;
        if (unlimited) this.set(p._id, v._id, null);
        else if (typeof v.quantity === 'number') this.set(p._id, v._id, v.quantity);
      });
    }
  };

  // المنتجات التوضيحية المعروضة في الصفحة — تُستخدم عند إضافتها للسلة
  const DEMO_PRODUCTS = {};
  const isDemoId = (id) => /^demo-/.test(String(id || ''));

  function demoProduct(d) {
    if (DEMO_PRODUCTS[d._id]) return DEMO_PRODUCTS[d._id]; // مرة واحدة لكل منتج (الكتالوج الضخم يُقرأ من أكثر من مكان)
    const p = {
      _id: d._id,
      __demo: true,
      collectionId: d.cat || '',
      title: d.title,
      subtitle: d.subtitle || '',
      images: d.image ? [{ fileUrl: d.image }] : [],
      pricing: { price: Money.fromMajor(d.price), compareAtPrice: Money.fromMajor(d.compare) },
      reviewsCount: d.reviews || 0,
      averageRating: d.rating || 0,
      tags: d.tags || [],
      trackQuantity: typeof d.stock === 'number',
      quantity: typeof d.stock === 'number' ? d.stock : undefined
    };
    DEMO_PRODUCTS[p._id] = p;
    Stock.remember(p);
    return p;
  }

  /*
   * صفحات المنتج/التصنيف التوضيحية: /products/<slug> و /collections/<handle> غير الموجودة ترجع 500 من السيرفر،
   * لذا تُعرض على الرئيسية بـ ?demo_product=<id> أو ?demo_collection=<id> (ui/demo-pages.njk).
   * نحافظ على باراميترات المعاينة الحالية.
   */
  function demoUrl(id, key) {
    const params = new URLSearchParams(window.location.search);
    ['q', 'page', 'sort', 'minPrice', 'maxPrice', 'demo_product', 'demo_collection'].forEach((k) => params.delete(k));
    params.set(key || 'demo_product', id);
    return '/?' + params.toString();
  }

  // تبدأ الصفحة التوضيحية: إخفاء محتوى الصفحة الأصلي (الكلاس يُضاف مبكراً من layout.njk)
  function showDemoPage(on) {
    document.documentElement.classList.toggle('is-demo-page', on);
    if (on) document.body.classList.remove('has-hero');
  }

  /*
   * سلة المعاينة: المنتجات التوضيحية غير موجودة على السيرفر، فتُحفظ محلياً (localStorage)
   * وتُدمج مع سلة المتجر في العرض فقط. لا تعمل خارج وضع المعاينة، ولا يمكن إتمام طلبها.
   */
  const DemoCart = (function () {
    const KEY = 'lg-demo-cart';
    const store = safeStorage('localStorage');
    let memory = [];
    const read = () => {
      if (!store) return memory;
      try {
        const v = JSON.parse(store.getItem(KEY) || '[]');
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    };
    const write = (items) => {
      memory = items;
      if (store) { try { store.setItem(KEY, JSON.stringify(items)); } catch (e) { /* ignore */ } }
    };
    return {
      items() {
        if (!isPreview()) return [];
        // سطور محفوظة تتجاوز المخزون التوضيحي (من قبل تطبيق الحد) تُصحَّح للمتاح
        let changed = false;
        const items = read().map((i) => {
          const max = typeof i.max === 'number' ? i.max : Stock.get(i.productId, '');
          if (typeof max !== 'number' || i.quantity <= max) return i;
          changed = true;
          return Object.assign({}, i, { quantity: Math.max(1, max), max });
        });
        if (changed) write(items);
        return items;
      },
      // max: المخزون المتاح (يُحفظ مع السطر ليبقى الحد معروفاً في أي صفحة)
      add(p, quantity, max) {
        const items = read();
        const line = items.find((i) => i.productId === p._id);
        const cap = (q) => (typeof max === 'number' ? Math.min(q, max) : q);
        if (line) {
          line.quantity = cap(line.quantity + quantity);
          if (typeof max === 'number') line.max = max;
        } else {
          const img = p.images && p.images[0];
          items.push({
            _id: 'demo-line-' + p._id,
            __demo: true,
            productId: p._id,
            quantity: cap(quantity),
            max: typeof max === 'number' ? max : null,
            price: (p.pricing && p.pricing.price) || 0,
            compareAtPrice: (p.pricing && p.pricing.compareAtPrice) || 0,
            productData: { title: p.title, image: img || null }
          });
        }
        write(items);
      },
      update(lineId, quantity) {
        write(read().map((i) => (i._id === lineId ? Object.assign({}, i, { quantity }) : i)));
      },
      remove(lineId) {
        write(read().filter((i) => i._id !== lineId));
      },
      clear() {
        write([]);
      }
    };
  })();

  // سلة المتجر + سطور المعاينة (بنفس شكل سطور السيرفر)
  function withDemo(cart) {
    const base = cart || { items: [], totalQuantity: 0, totalPrice: 0 };
    const demo = DemoCart.items().map((i) => Object.assign({}, i, {
      totalPrice: i.price * i.quantity,
      totalCompareAtPrice: i.compareAtPrice > i.price ? i.compareAtPrice * i.quantity : 0
    }));
    if (!demo.length) return base;
    const sum = (fn) => demo.reduce((s, i) => s + fn(i), 0);
    return Object.assign({}, base, {
      items: (base.items || []).concat(demo),
      totalQuantity: (base.totalQuantity || 0) + sum((i) => i.quantity),
      totalPrice: (base.totalPrice || 0) + sum((i) => i.totalPrice),
      totalSavings: (base.totalSavings || 0) + sum((i) => (i.totalCompareAtPrice ? i.totalCompareAtPrice - i.totalPrice : 0))
    });
  }

  /* ---------- Store API (SDK first, AJAX fallback) ---------- */

  const Store = {
    async cartAdd(productId, quantity, opts) {
      const s = sdk();
      const options = (opts && opts.options) || [];
      if (s && s.cart && typeof s.cart.add === 'function') {
        return normalizeCart(await s.cart.add(productId, quantity, options.length ? options : undefined));
      }
      const body = { productId, quantity };
      if (opts && opts.variantId) body.variantId = opts.variantId;
      return normalizeCart(await http('POST', '/ajax/cart/add', body));
    },
    async cartUpdate(itemId, quantity) {
      const s = sdk();
      if (s && s.cart && typeof s.cart.update === 'function') return normalizeCart(await s.cart.update(itemId, quantity));
      return normalizeCart(await http('POST', '/ajax/cart/change', { itemId, quantity }));
    },
    async cartRemove(itemId) {
      const s = sdk();
      if (s && s.cart && typeof s.cart.remove === 'function') return normalizeCart(await s.cart.remove(itemId));
      return normalizeCart(await http('POST', '/ajax/cart/remove', { itemId }));
    },
    async cartClear() {
      const s = sdk();
      if (s && s.cart && typeof s.cart.clear === 'function') return normalizeCart(await s.cart.clear());
      return normalizeCart(await http('POST', '/ajax/cart/clear'));
    },
    async cartFetch() {
      const s = sdk();
      if (s && s.cart && typeof s.cart.fetch === 'function') return normalizeCart(await s.cart.fetch());
      return normalizeCart(await http('GET', '/ajax/cart'));
    },
    async wishlistAdd(productId) {
      const s = sdk();
      if (s && s.wishlist && typeof s.wishlist.add === 'function') return s.wishlist.add(productId);
      return http('POST', '/ajax/wishlist/add', { productId });
    },
    async wishlistRemove(productId) {
      const s = sdk();
      if (s && s.wishlist && typeof s.wishlist.remove === 'function') return s.wishlist.remove(productId);
      return http('POST', '/ajax/wishlist/remove', { productId });
    },
    async suggest(q, limit) {
      const params = new URLSearchParams({ q, 'resources[type]': 'product,collection', 'resources[limit]': limit || 6 });
      const res = await http('GET', '/ajax/search/suggest?' + params.toString());
      // قمرة ترجع { resources: { products, collections, queries, pages, articles } }
      return {
        products: pickArray(res, ['resources.products', 'products', 'resources.results.products', 'results.products', 'data.products']),
        collections: pickArray(res, ['resources.collections', 'collections', 'resources.results.collections', 'results.collections', 'data.collections']),
        queries: pickArray(res, ['resources.queries', 'queries'])
      };
    },
    async searchProducts(params) {
      const clean = {};
      Object.keys(params).forEach((k) => {
        if (params[k] !== '' && params[k] !== null && params[k] !== undefined) clean[k] = params[k];
      });
      // فلتر السعر: الـ API يطبّق filters[price][min|max] فقط ويتجاهل minPrice/maxPrice
      if ('minPrice' in clean) { clean[PRICE_MIN] = clean.minPrice; delete clean.minPrice; }
      if ('maxPrice' in clean) { clean[PRICE_MAX] = clean.maxPrice; delete clean.maxPrice; }
      const res = await http('GET', '/ajax/search/products?' + new URLSearchParams(clean).toString());
      return {
        products: pickArray(res, ['products', 'data.products', 'data', 'items', 'results']),
        total: (res && (res.total || res.count || (res.pagination && res.pagination.total))) || null
      };
    },
    // منتجات تصنيف واحد (فلتر collectionId في Search API) — صفحة واحدة مع الترقيم
    async collectionProducts(collectionId, page, limit) {
      const res = await http('GET', '/ajax/search/products?' + new URLSearchParams({ q: '', collectionId, limit: limit || 24, page: page || 1 }).toString());
      const pg = (res && res.pagination) || {};
      const list = pickArray(res, ['products', 'data.products', 'data']).filter((p) =>
        p && typeof p === 'object' && (p._id || p.id) && p.title &&
        p.status !== 'draft' && p.status !== 'archived' && p.published !== false && p.isActive !== false);
      return {
        products: list.map((p) => (p._id ? p : Object.assign({}, p, { _id: p.id }))),
        total: typeof pg.totalItems === 'number' ? pg.totalItems : null,
        hasNext: !!pg.hasNextPage
      };
    },
    // بيانات منتج بالـ handle (لمعرفة مخزون سطور السلة) — طلب واحد لكل منتج في الجلسة
    productByHandle(handle) {
      this._products = this._products || {};
      if (!this._products[handle]) {
        this._products[handle] = http('GET', '/ajax/product?handle=' + encodeURIComponent(handle))
          .then((res) => (res && (res.product || (res.data && res.data.product) || (res.data && res.data._id ? res.data : null) || (res._id ? res : null))) || null)
          .catch(() => { delete this._products[handle]; return null; });
      }
      return this._products[handle];
    },
    async resolveVariant(productId, options, quantity) {
      return http('POST', '/ajax/product/resolve-variant-by-options', { productId, options, quantity: quantity || 1 });
    }
  };

  /* ---------- Managers الموثّقة (docs/store-ajax) — واجهة رقيقة فوق المسارات الموجودة ----------
     تُعرَّف فقط إذا لم تعرّفها المنصة. السلة والمفضلة تمر عبر مكوّن qumraApp (نفس أزرار الثيم)، فتتحدث الواجهة
     ويُطلق cart:updated / wishlist:updated كما هو الآن؛ وبدون Alpine (نادر) تُستدعى Store مباشرة مع نفس الحدث. */
  const rootApp = () => {
    try { return (window.Alpine && typeof window.Alpine.$data === 'function' && window.Alpine.$data(document.body)) || null; } catch (e) { return null; }
  };
  const appHas = (app, fn) => !!app && typeof app[fn] === 'function';
  const emitCart = (c) => { if (c) window.dispatchEvent(new CustomEvent('cart:updated', { detail: c })); return c; };
  const cartLine = (app, itemId, qty) =>
    (app.cartItems || []).find((i) => String(i._id) === String(itemId)) || { _id: itemId, quantity: Number(qty) || 0 };

  window.CartManager = window.CartManager || {
    async add(productId, qty, variantId) {
      const app = rootApp();
      const opts = variantId ? { variantId } : {};
      if (appHas(app, 'addToCart')) return (await app.addToCart(productId, qty, opts)) ? app.cart : { success: false };
      return emitCart(await Store.cartAdd(productId, Math.max(1, parseInt(qty, 10) || 1), opts));
    },
    increment(itemId, currentQty) {
      return this.update(itemId, (parseInt(currentQty, 10) || 0) + 1);
    },
    decrement(itemId, currentQty) {
      return this.update(itemId, (parseInt(currentQty, 10) || 0) - 1);
    },
    async update(itemId, qty) {
      const app = rootApp();
      if (appHas(app, 'updateItem')) { await app.updateItem(cartLine(app, itemId, qty), qty); return app.cart; }
      qty = parseInt(qty, 10);
      if (isNaN(qty)) return null;
      return emitCart(await (qty < 1 ? Store.cartRemove(itemId) : Store.cartUpdate(itemId, qty)));
    },
    async remove(itemId) {
      const app = rootApp();
      if (appHas(app, 'removeItem')) { await app.removeItem(cartLine(app, itemId)); return app.cart; }
      return emitCart(await Store.cartRemove(itemId));
    },
    async clear() {
      const app = rootApp();
      if (appHas(app, 'clearCart')) { await app.clearCart(); return app.cart; }
      return emitCart(await Store.cartClear());
    }
  };

  window.WishlistManager = window.WishlistManager || {
    has(productId) {
      const app = rootApp();
      return appHas(app, 'isWished') ? app.isWished(productId) : false;
    },
    async add(productId) {
      const app = rootApp();
      if (appHas(app, 'toggleWish')) { if (!app.isWished(productId)) await app.toggleWish(productId); return app.wishlist; }
      const res = await Store.wishlistAdd(productId);
      window.dispatchEvent(new CustomEvent('wishlist:updated', { detail: res }));
      return res;
    },
    async remove(productId) {
      const app = rootApp();
      if (appHas(app, 'toggleWish')) { if (app.isWished(productId)) await app.toggleWish(productId); return app.wishlist; }
      const res = await Store.wishlistRemove(productId);
      window.dispatchEvent(new CustomEvent('wishlist:updated', { detail: res }));
      return res;
    },
    toggle(productId, isInWishlist) {
      const wished = typeof isInWishlist === 'boolean' ? isInWishlist : this.has(productId);
      return wished ? this.remove(productId) : this.add(productId);
    },
    async clear() {
      const s = sdk();
      const res = s && s.wishlist && typeof s.wishlist.clear === 'function'
        ? await s.wishlist.clear()
        : await http('POST', '/ajax/wishlist/clear');
      const app = rootApp();
      if (app && Array.isArray(app.wishlist)) app.wishlist = [];
      window.dispatchEvent(new CustomEvent('wishlist:updated', { detail: res }));
      return res;
    }
  };

  window.SearchManager = window.SearchManager || {
    _timer: 0,
    search(query, opts) {
      opts = opts || {};
      return Store.searchProducts({ q: query || '', page: opts.page, limit: opts.limit });
    },
    // suggest(query) → Promise؛ suggest(query, cb, debounceMs) → يستدعي cb بعد التأخير (آخر استدعاء فقط)
    suggest(query, cb, debounceMs) {
      if (typeof cb !== 'function') return Store.suggest(query);
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        Store.suggest(query).then(cb).catch(() => cb({ products: [], collections: [], queries: [] }));
      }, debounceMs == null ? 300 : debounceMs);
      return undefined;
    }
  };

  window.ProductManager = window.ProductManager || {
    // الـ API يجلب المنتج بالـ handle (slug) — docs/store-ajax/product.md
    get(handle) {
      return Store.productByHandle(handle);
    },
    getVariant(productId, selectedOptions, quantity) {
      return Store.resolveVariant(productId, selectedOptions, quantity);
    }
  };

  /* ---------- البحث الذكي (SRCH-01..07) ----------
     بحث قمرة حرفي: "ساعه" لا تجد "ساعة"، و"اسوار" لا تجد "أسوار"، والتشكيل وترتيب الكلمات والأخطاء الإملائية تُفشله.
     لذلك نبحث في كتالوج المتجر كاملاً داخل المتصفح (يُجلب مرة ويُخزَّن للجلسة 10 دقائق) مع:
     - تطبيع: الهمزات ← ا، ة ← ه، ى/ئ ← ي، ؤ ← و، حذف التشكيل والتطويل، الأرقام العربية، حالة الأحرف الإنجليزية
     - كل كلمة بأي ترتيب، بداية الكلمة، جزء من الكلمة، ومع/بدون "ال"
     - تصحيح الأخطاء (Damerau-Levenshtein) مع "هل تقصد؟"
     - ترتيب بالأهمية: تطابق العبارة في الاسم أولاً ثم الكلمات الكاملة ثم البدايات ثم التصحيح
     المتاجر الكبيرة (أكثر من 2000 منتج): نضيف نتائج بحث السيرفر إلى المرشحين. المعاينة بلا منتجات: الكتالوج التوضيحي. */
  const SmartSearch = (function () {
    const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
    const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
    const MAX_PAGES = 8;
    const PAGE = 250;
    const CACHE_KEY = 'lg-catalog-v1';
    const CACHE_MS = 10 * 60 * 1000;

    function norm(s) {
      return String(s || '').normalize('NFKC').toLowerCase()
        .replace(DIAC, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    }
    const words = (s) => norm(s).split(' ').filter(Boolean);
    const bare = (w) => (w.length > 3 && w.indexOf('ال') === 0 ? w.slice(2) : w);

    // مرادفات عربي ⇄ إنجليزي لأشهر الماركات والكلمات (بعد التطبيع) — "ايفون" تجد iPhone و"سماعه" تجد headphones
    const PHRASES = [['ماك بوك', 'macbook'], ['اير بودز', 'airpods'], ['اير بود', 'airpods'], ['بلاي ستيشن', 'playstation'], ['اكس بوكس', 'xbox'], ['تي شيرت', 'تيشيرت'], ['ابل واتش', 'apple watch'], ['يد تحكم', 'controller'], ['سماعه ذكيه', 'speaker']];
    const SYN_GROUPS = [
      ['ايفون', 'iphone'], ['ايباد', 'ipad'], ['ماك', 'mac', 'macbook'], ['macbook', 'ماك'], ['ابل', 'apple'],
      ['سامسونج', 'سامسونغ', 'samsung'], ['جالاكسي', 'جالكسي', 'galaxy'], ['سوني', 'sony'], ['ديل', 'dell'],
      ['لوجيتك', 'logitech'], ['شاومي', 'xiaomi'], ['هواوي', 'huawei'], ['airpods', 'ايربودز'], ['playstation', 'ps5', 'بلايستيشن'],
      ['xbox', 'اكسبوكس'], ['لابتوب', 'laptop', 'notebook'], ['ماوس', 'mouse'], ['كيبورد', 'keyboard'], ['شاحن', 'charger'],
      ['سماعه', 'سماعات', 'headphones', 'earbuds', 'headset'], ['ساعه', 'watch', 'smartwatch'], ['جوال', 'موبايل', 'هاتف', 'phone'],
      ['تلفزيون', 'تليفزيون', 'tv'], ['كاميرا', 'camera'], ['سبيكر', 'speaker'], ['دراع', 'controller', 'gamepad']
    ].map((g) => g.map(norm));
    function synonyms(t) {
      const out = [];
      SYN_GROUPS.forEach((g) => { if (g.indexOf(t) > -1) g.forEach((x) => { if (x !== t && out.indexOf(x) === -1) out.push(x); }); });
      return out;
    }
    function expandPhrases(q) {
      let s = ' ' + q + ' ';
      PHRASES.forEach(([a, b]) => { s = s.split(' ' + norm(a) + ' ').join(' ' + norm(b) + ' '); });
      return s.trim();
    }

    // Damerau-Levenshtein (optimal string alignment) مع إيقاف مبكر عند تجاوز الحد
    function dist(a, b, max) {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      let prev2 = null;
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
          cur[j] = v;
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev2 = prev;
        prev = cur;
      }
      return prev[b.length];
    }

    // أفضل تطابق لكلمة بحث بين كلمات المنتج: 10 كاملة، 8 بداية، 6 جزء، 1..3 تصحيح
    function matchWord(q, item) {
      const qb = bare(q);
      const allow = qb.length >= 7 ? 2 : qb.length >= 4 ? 1 : 0;
      let best = 0;
      let fix = null;
      for (let k = 0; k < item.words.length; k++) {
        const w = item.words[k];
        const wb = bare(w);
        let s = 0;
        if (w === q || wb === qb) s = 10;
        else if (w.indexOf(q) === 0 || wb.indexOf(qb) === 0) s = 8;
        else if (q.length >= 2 && w.indexOf(q) > -1) s = 6;
        else if (allow) {
          const d = Math.min(dist(qb, wb, allow), wb.length > qb.length ? dist(qb, wb.slice(0, qb.length), allow) : allow + 1);
          if (d <= allow) s = 4 - d;
        }
        if (s > best) { best = s; fix = s <= 3 ? item.orig[k] : null; }
        if (best === 10) break;
      }
      return { score: best, fix };
    }

    function indexOf(list) {
      return list.map((p, i) => {
        const orig = [];
        const ws = [];
        const add = (text) => String(text || '').split(/[^\p{L}\p{N}ً-ٟـ]+/u).forEach((o) => {
          const n = norm(o);
          if (n && ws.indexOf(n) === -1) { ws.push(n); orig.push(o); }
        });
        add(p.title);
        add(p.subtitle);
        add(p.collectionTitle);
        add(String(p.handle || p.slug || '').replace(/-/g, ' '));
        (Array.isArray(p.tags) ? p.tags : []).forEach((t) => add(t && typeof t === 'object' ? (t.name || t.title) : t));
        return { p, i, title: norm(p.title), words: ws, orig };
      });
    }

    function rank(idx, raw) {
      const q = norm(raw);
      if (!q) return { items: [], corrected: null, exact: 0 };
      const qt = expandPhrases(q).split(' ');
      const need = qt.length <= 2 ? qt.length : Math.ceil(qt.length * 0.66); // معظم الكلمات في العبارات الطويلة
      const out = [];
      idx.forEach((it) => {
        let total = 0;
        let matched = 0;
        const fixes = {};
        qt.forEach((t) => {
          let r = matchWord(t, it);
          // المرادف (ايفون ⇄ iphone) يُحسب تطابقاً لا تصحيحاً، بدرجة أقل قليلاً من الكلمة نفسها
          synonyms(t).forEach((syn) => {
            const r2 = matchWord(syn, it);
            if (r2.score >= 6 && r2.score - 1 > r.score) r = { score: r2.score - 1, fix: null };
          });
          if (r.score > 0) { matched++; total += r.score; if (r.fix) fixes[t] = r.fix; }
        });
        if (matched < need) return;
        if (it.title.indexOf(q) > -1) total += 15;
        if (it.title.indexOf(q) === 0) total += 5;
        if (matched === qt.length) total += 6;
        total -= it.title.length / 200;
        out.push({ it, total, fixes, exact: !Object.keys(fixes).length });
      });
      out.sort((a, b) => b.total - a.total || a.it.i - b.it.i);
      const exact = out.filter((o) => o.exact).length;
      // توجد نتائج دقيقة؟ نستبعد ما وُجد بالتصحيح فقط (ضوضاء: "سماعات" لا تُظهر "ساعات")
      if (exact) for (let k = out.length - 1; k >= 0; k--) if (!out[k].exact) out.splice(k, 1);
      // "هل تقصد؟": لا نتائج دقيقة والتصحيح هو ما وجد النتائج — نستبدل كلمات البحث المصححة بكلمات المنتج الأصلية
      let corrected = null;
      if (!exact && out.length && Object.keys(out[0].fixes).length) {
        const f = out[0].fixes;
        corrected = String(raw).trim().split(/\s+/).map((w) => f[norm(w)] || w).join(' ');
      }
      return { items: out.map((o) => o.it.p), corrected, exact };
    }

    const validProduct = (p) => p && typeof p === 'object' && (p._id || p.id) && p.title &&
      p.status !== 'draft' && p.status !== 'archived' && p.published !== false && p.isActive !== false;
    const withId = (p) => (p._id ? p : Object.assign({}, p, { _id: p.id }));

    let catalogP = null;
    function catalog() {
      if (catalogP) return catalogP;
      catalogP = (async () => {
        const ss = safeStorage('sessionStorage');
        try {
          const c = ss && JSON.parse(ss.getItem(CACHE_KEY) || 'null');
          if (c && Array.isArray(c.items) && Date.now() - c.t < CACHE_MS) return { items: c.items, complete: c.complete };
        } catch (e) { /* ignore */ }
        let items = [];
        let complete = true;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const res = await http('GET', '/ajax/search/products?' + new URLSearchParams({ q: '', limit: PAGE, page }).toString());
          const list = pickArray(res, ['products', 'data.products', 'data']).filter(validProduct).map(withId);
          items = items.concat(list);
          const pg = res && res.pagination;
          if (!pg || !pg.hasNextPage || !list.length) break;
          if (page === MAX_PAGES) complete = false;
        }
        if (items.length && ss) { try { ss.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items, complete })); } catch (e) { /* ignore */ } }
        return { items, complete };
      })().catch(() => { catalogP = null; return { items: [], complete: false }; });
      return catalogP;
    }

    let idxCache = null;
    let demoItems = null;
    async function index() {
      const c = await catalog();
      let items = c.items;
      // المعاينة بلا منتجات: الكتالوج التوضيحي (لا يظهر للعملاء)
      if (!items.length && isPreview()) {
        // المنتجات التوضيحية + اسم تصنيفها (سماعات، ساعات ذكية...) حتى يجدها البحث بالعربي — تُبنى مرة واحدة
        if (demoItems) items = demoItems;
      }
      if (!items.length && isPreview()) {
        const cats = {};
        readDemo(null, 'collections').forEach((c) => { cats[c._id] = c.title; });
        items = demoItems = readDemo(null, 'all').map(demoProduct).map((p) => Object.assign(p, { collectionTitle: cats[p.collectionId] || '' }));
      }
      if (!idxCache || idxCache.src !== items) idxCache = { src: items, idx: indexOf(items), complete: c.complete || !c.items.length };
      return idxCache;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    // نفس الحرف بكل أشكاله + تشكيل اختياري بين الحروف
    const VARIANTS = { 'ا': '[اأإآٱ]', 'ه': '[هة]', 'ي': '[يىئ]', 'و': '[وؤ]' };
    const reEsc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return {
      norm,
      async search(raw) {
        const q = String(raw || '').trim();
        if (norm(q).length < 1) return { items: [], corrected: null, exact: 0 };
        const ix = await index();
        let idx = ix.idx;
        // كتالوج غير مكتمل (متجر كبير): نتائج بحث السيرفر تُضاف للمرشحين ثم تُرتَّب بنفس الطريقة
        if (!ix.complete) {
          try {
            const r = await Store.searchProducts({ q, limit: 100 });
            const seen = {};
            ix.src.forEach((p) => { seen[p._id] = 1; });
            const extra = r.products.filter(validProduct).map(withId).filter((p) => !seen[p._id]);
            if (extra.length) idx = idx.concat(indexOf(extra));
          } catch (e) { /* السيرفر غير متاح: الكتالوج وحده */ }
        }
        const r = rank(idx, q);
        r.items.forEach((p) => Stock.remember(p));
        return r;
      },
      // ترتيب الكتالوج (الأحدث أولاً كما يرجعه السيرفر) — للفرز "الأحدث"
      order(p) {
        const it = idxCache && idxCache.idx.find((x) => x.p._id === p._id);
        return it ? it.i : 1e9;
      },
      // تمييز كلمات البحث في النص — HTML آمن (كل الأجزاء مُهرَّبة)
      highlight(text, raw) {
        const t = String(text || '');
        const tokens = norm(raw).split(' ').filter((x) => x.length >= 2);
        if (!tokens.length) return escapeHtml(t);
        const parts = tokens.map((tok) => [...tok].map((ch) => VARIANTS[ch] || reEsc(ch)).join('[\\u064B-\\u065F\\u0640]*'));
        const re = new RegExp('(' + parts.join('|') + ')', 'giu');
        return t.split(re).map((seg, i) => (i % 2 ? '<mark class="lg-mark">' + escapeHtml(seg) + '</mark>' : escapeHtml(seg))).join('');
      },
      warm() { index().catch(() => {}); },
      // كتالوج المتجر الحقيقي كاملاً { items, complete } — نفس الكاش (صفحة التصنيفات: المنتجات خارج أي تصنيف)
      all() { return catalog(); }
    };
  })();

  /* ---------- Lazy libraries (Swiper / GLightbox) — تُحمّل فقط عند وجود حاجة لها ---------- */

  const LIBS = {
    swiper: { js: "https://cdn.jsdelivr.net/npm/swiper@11.2.6/swiper-bundle.min.js", css: "https://cdn.jsdelivr.net/npm/swiper@11.2.6/swiper-bundle.min.css", global: "Swiper" },
    glightbox: { js: "https://cdn.jsdelivr.net/npm/glightbox@3.3.1/dist/js/glightbox.min.js", css: "https://cdn.jsdelivr.net/npm/glightbox@3.3.1/dist/css/glightbox.min.css", global: "GLightbox" }
  };
  const libPromises = {};
  function loadLib(name) {
    const lib = LIBS[name];
    if (window[lib.global]) return Promise.resolve(window[lib.global]);
    if (libPromises[name]) return libPromises[name];
    libPromises[name] = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = lib.css;
      document.head.appendChild(link);
      const s = document.createElement("script");
      s.src = lib.js;
      s.async = true;
      s.onload = () => resolve(window[lib.global]);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return libPromises[name];
  }
  function initLightbox() {
    if (!document.querySelector(".glightbox")) return;
    loadLib("glightbox").then((G) => G && G({ selector: ".glightbox", touchNavigation: true, loop: true })).catch(() => {});
  }

  /* ---------- Root Alpine component ---------- */

  window.qumraApp = function () {
    const initialCart = normalizeCart(readJSON('lg-initial-cart', null)) || { items: [], totalQuantity: 0, totalPrice: 0 };
    const initialWishlist = readJSON('lg-initial-wishlist', null) || {};
    const wishIds = pickArray(initialWishlist, ['products']).map((p) => p && (p._id || p.id)).filter(Boolean)
      .concat(pickArray(initialWishlist, ['productIds']));
    const session = safeStorage('sessionStorage');

    return {
      modal: { open: false, type: null },
      search: '',
      serverCart: initialCart,
      cart: withDemo(initialCart),
      stockVersion: 0,
      scheme: schemeRoot.getAttribute('data-scheme') === 'dark' ? 'dark' : 'light',
      wishlist: Array.from(new Set(wishIds)),
      busy: {},
      toasts: [],
      scrolled: false,
      navHidden: false,
      announcementClosed: !!(session && session.getItem('lg-announcement-closed')),
      // نتيجة تأكيد الكروت من /ajax/product: { id: 'out' | 'options' | 'buy' }
      cardInfo: {},
      suggestions: { products: [], collections: [], loading: false, query: '', active: -1, total: 0, corrected: null },
      // آخر عمليات البحث (localStorage) — تظهر في نافذة البحث قبل الكتابة
      recentSearches: (function () {
        const ls = safeStorage('localStorage');
        try { const v = JSON.parse((ls && ls.getItem('lg-recent-searches')) || '[]'); return Array.isArray(v) ? v.slice(0, 6) : []; } catch (e) { return []; }
      })(),

      init() {
        // تبديل اللغة لم ينجح (السيرفر رسم الصفحة بلغة أخرى رغم الكوكي): رسالة بدل صمت
        if (takeLangSwitchResult() === false) this.notify(I18N.langFailed || I18N.error, 'error');

        // حالة التمرير + إخفاء الهيدر عند النزول وإظهاره عند الصعود (مع هامش لتفادي الارتعاش)
        let lastY = window.scrollY;
        let ticking = false;
        const onScroll = () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            const y = Math.max(0, window.scrollY);
            this.scrolled = y > 24;
            const delta = y - lastY;
            if (Math.abs(delta) > 8) {
              this.navHidden = delta > 0 && y > 260 && !this.modal.open;
              lastY = y;
            }
            if (y < 80) this.navHidden = false;
            ticking = false;
          });
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        // اختصار "/" لفتح البحث
        document.addEventListener('keydown', (e) => {
          if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          e.preventDefault();
          if (!this.isOpen('search')) this.toggleModal('search');
        });

        // الهيدر فوق الهيرو الداكن (fallback للمتصفحات بدون :has) — ما عدا صفحة المنتج التوضيحي فوق الرئيسية
        const demoPage = document.documentElement.classList.contains('is-demo-page') && isPreview();
        const first = document.querySelector('main > *:first-child, main .lg-hero-section');
        if (!demoPage && first && (first.classList.contains('lg-hero-section') || first.querySelector(':scope > .lg-hero-section'))) {
          document.body.classList.add('has-hero');
        }

        const s = sdk();
        if (s && typeof s.on === 'function') {
          ['cart:added', 'cart:updated', 'cart:removed', 'cart:cleared'].forEach((ev) => {
            s.on(ev, (payload) => {
              const c = normalizeCart(payload && (payload.cart || payload));
              if (c) {
                this.serverCart = c;
                this.cart = withDemo(c);
              }
            });
          });
        }

        // مزامنة السلة بين التبويبات عند العودة للتبويب (EDGE-08)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') this.refreshCart();
        });

        // الوضع "تلقائي": متابعة تغيّر وضع الجهاز ما دام الزائر لم يختر بنفسه
        const darkMq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
        if (darkMq && darkMq.addEventListener) {
          darkMq.addEventListener('change', (e) => {
            if (schemeRoot.getAttribute('data-scheme-default') !== 'auto' || schemeSaved()) return;
            this.scheme = e.matches ? 'dark' : 'light';
            applyScheme(this.scheme);
          });
        }

        // حدود المخزون: إعادة الحساب عند تسجيل مخزون جديد، وجلب مخزون سطور السلة الحالية
        let resync = 0;
        window.addEventListener('lg-stock', () => {
          this.stockVersion++;
          if (!this.cartItems.some((i) => i.__demo)) return;
          clearTimeout(resync);
          resync = setTimeout(() => this.syncDemoCart(), 50); // تصحيح سطور المعاينة القديمة بعد معرفة مخزونها
        });
        this.ensureCartStock();

        initLightbox();
      },

      /* ----- الوضع الداكن ----- */
      toggleScheme(e) {
        this.scheme = this.scheme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(SCHEME_KEY, this.scheme); } catch (err) { /* ignore */ }
        applyScheme(this.scheme, e);
      },

      /* ----- Announcement ----- */
      closeAnnouncement() {
        this.announcementClosed = true;
        if (session) session.setItem('lg-announcement-closed', '1');
      },

      /* ----- Modal ----- */
      toggleModal(type) {
        if (this.modal.open && this.modal.type === type) return this.closeModal();
        this.modal.open = true;
        this.modal.type = type;
        document.documentElement.style.overflow = 'hidden';
        if (type === 'search') {
          SmartSearch.warm(); // جلب الكتالوج مبكراً حتى تظهر الاقتراحات فور الكتابة
          this.$nextTick(() => {
            const input = document.getElementById('lg-search-input');
            if (input) input.focus();
          });
        }
      },
      closeModal() {
        if (!this.modal.open) return;
        this.modal.open = false;
        this.modal.type = null;
        document.documentElement.style.overflow = '';
      },
      isOpen(type) {
        return this.modal.open && this.modal.type === type;
      },

      /* ----- Money ----- */
      formatMoney(v) {
        return Money.format(v);
      },
      discountOf(p) {
        return discountPercent(this.productPrice(p), this.productCompare(p));
      },

      /* ----- Toast ----- */
      notify(message, type) {
        if (!message) return;
        const id = Date.now() + Math.random();
        this.toasts.push({ id, message, type: type === 'error' ? 'error' : 'success' });
        setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 3500);
      },

      /* ----- Cart ----- */
      setCart(c) {
        if (!c) return;
        this.serverCart = c;
        this.cart = withDemo(c);
        this.ensureCartStock();
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: this.cart }));
      },
      // بعد أي تعديل على سطور المعاينة
      syncDemoCart() {
        this.setCart(this.serverCart);
      },
      get cartCount() {
        return (this.cart && this.cart.totalQuantity) || 0;
      },
      get cartItems() {
        return (this.cart && this.cart.items) || [];
      },
      // مجموع السطور قبل خصم الكوبون
      get cartSubtotal() {
        return this.cartItems.reduce((sum, i) => sum + (i.totalPrice != null ? i.totalPrice : (i.price || 0) * (i.quantity || 0)), 0);
      },
      itemTitle(item) {
        const p = item.productData || item.product || {};
        return p.title || item.title || '';
      },
      itemImage(item) {
        const p = item.productData || item.product || {};
        const img = p.image || (p.images && p.images[0]) || item.image;
        return (img && (img.fileUrl || img.url)) || (typeof img === 'string' ? img : '');
      },
      itemUrl(item) {
        if (item.__demo) return demoUrl(item.productId);
        const p = item.productData || item.product || {};
        const h = p.handle || p.slug || item.slug;
        return h ? '/products/' + encodeURIComponent(h) : '#';
      },
      itemOptions(item) {
        const opts = item.options || item.selectedOptions || (item.variant && item.variant.options) || (item.variantData && item.variantData.options) || [];
        if (!Array.isArray(opts)) return '';
        return opts.map((o) => (o && typeof o === 'object' ? (o.label || o.value || o.name) : o)).filter((o) => typeof o === 'string' && o).join(' · ');
      },
      /* ----- حدود المخزون: كمية المنتج في السلة لا تتجاوز المتاح فعلياً ----- */
      // أقصى مخزون معروف للمنتج/المتغير (Infinity = غير محدود أو غير معروف)
      stockOf(productId, variantId) {
        this.stockVersion; // اعتمادية تفاعلية: يعاد الحساب عند تسجيل مخزون جديد
        const s = Stock.get(productId, variantId);
        return typeof s === 'number' ? s : Infinity;
      },
      // الكمية الموجودة في السلة من هذا المنتج/المتغير
      inCartQty(productId, variantId) {
        const v = String(variantId || '');
        return this.cartItems.reduce((n, i) => n + (String(i.productId) === String(productId) && String(i.variantId || '') === v ? (i.quantity || 0) : 0), 0);
      },
      // ما يمكن إضافته بعد خصم ما في السلة
      stockLeft(productId, variantId) {
        return Math.max(0, this.stockOf(productId, variantId) - this.inCartQty(productId, variantId));
      },
      // سطور السلة الحقيقية بلا مخزون معروف: نجلبه من /ajax/product (طلب واحد لكل منتج)
      ensureCartStock() {
        this.cartItems.forEach((item) => {
          if (item.__demo || Stock.get(item.productId, item.variantId) !== undefined) return;
          const p = item.productData || item.product || {};
          const handle = p.handle || p.slug || item.slug;
          if (!handle) return;
          Store.productByHandle(handle).then((prod) => { if (prod) Stock.remember(Object.assign({ _id: item.productId }, prod)); });
        });
      },
      itemMax(item) {
        const v = item.availableQuantity != null ? item.availableQuantity : (item.maxQuantity != null ? item.maxQuantity : null);
        if (typeof v === 'number') return v;
        if (typeof item.max === 'number') return item.max; // سطور المعاينة
        return this.stockOf(item.productId, item.variantId);
      },
      itemUnavailable(item) {
        return item.available === false || item.isAvailable === false || this.itemMax(item) <= 0;
      },
      // الكمية في السلة أكبر من المتاح (نقص المخزون بعد الإضافة)
      itemOver(item) {
        const max = this.itemMax(item);
        return max > 0 && item.quantity > max;
      },
      itemOverText(item) {
        return (I18N.stockOver || '').replace('{n}', this.itemMax(item));
      },
      get cartBlocked() {
        return this.cartItems.some((i) => this.itemUnavailable(i) || this.itemOver(i));
      },
      isBusy(key) {
        return !!this.busy[key];
      },
      async run(key, fn, successMsg) {
        if (this.busy[key]) return null;
        this.busy = Object.assign({}, this.busy, { [key]: true });
        try {
          const result = await fn();
          if (successMsg) this.notify(successMsg, 'success');
          return result;
        } catch (e) {
          this.notify((e && e.message) || I18N.error, 'error');
          return null;
        } finally {
          const b = Object.assign({}, this.busy);
          delete b[key];
          this.busy = b;
        }
      },
      // opts: { variantId, options, silent, stock } — stock: مخزون المنتج من البطاقة (null = غير محدود)
      async addToCart(productId, quantity, opts) {
        opts = opts || {};
        let qty = Math.max(1, parseInt(quantity, 10) || 1);
        if (opts.stock !== undefined) Stock.set(productId, opts.variantId, opts.stock);
        // كارت خياراته مش معروفة: نسأل عن المنتج قبل الإضافة، فمنتج بخيارات يفتح صفحته بدل POST 400
        if (opts.handle && !opts.variantId && !isDemoId(productId)) {
          const full = await this.run('add:' + productId, () => Store.productByHandle(opts.handle));
          if (full) {
            Stock.remember(Object.assign({}, full, { _id: productId }));
            if (productHasOpts(full)) {
              this.notify(I18N.selectOptions, 'error');
              window.location.href = withLang('/products/' + encodeURIComponent(opts.handle));
              return false;
            }
          }
        }
        // لا تتجاوز الكمية في السلة المخزون المتاح: نضيف المتبقي فقط، أو نمنع الإضافة
        const left = this.stockLeft(productId, opts.variantId);
        if (left <= 0) {
          this.notify(this.stockOf(productId, opts.variantId) <= 0 ? I18N.out : I18N.stockInCart, 'error');
          return false;
        }
        const limited = qty > left;
        if (limited) qty = left;
        const addedMsg = limited ? (I18N.stockLimited || '').replace('{n}', qty) : I18N.added;
        // Genie (macOS): صورة المنتج تُمتص إلى زر السلة مع بداية الطلب، والسلة تُفتح بعد هبوطها
        const fly = genieToCart(() => { if (!this.navHidden) return false; this.navHidden = false; return true; });
        if (isDemoId(productId)) {
          const p = DEMO_PRODUCTS[productId];
          if (!p || !isPreview()) {
            this.notify(I18N.error, 'error');
            return false;
          }
          const max = this.stockOf(productId, opts.variantId);
          DemoCart.add(p, qty, isFinite(max) ? max : undefined);
          this.syncDemoCart();
          this.notify(addedMsg, limited ? 'error' : 'success');
          if (!opts.silent) { await fly; if (CART_OPEN_ON_ADD) this.toggleModal('cart'); }
          return true;
        }
        const c = await this.run('add:' + productId, () => Store.cartAdd(productId, qty, opts));
        if (c) {
          this.setCart(c);
          this.notify(addedMsg, limited ? 'error' : 'success');
          if (!opts.silent) { await fly; if (CART_OPEN_ON_ADD) this.toggleModal('cart'); }
          return true;
        }
        return false;
      },
      async buyNow(productId, quantity, opts) {
        // المنتج التوضيحي لا يُطلب: نضيفه ونفتح السلة
        if (isDemoId(productId)) return this.addToCart(productId, quantity, opts);
        // كل المتاح موجود في السلة بالفعل → نكمل للدفع مباشرة
        const vid = opts && opts.variantId;
        if (this.inCartQty(productId, vid) > 0 && this.stockLeft(productId, vid) <= 0) return this.checkout();
        // buy:<id> — مؤشر التحميل على زر "اشترِ الآن" نفسه في البطاقات بدل زر "أضف إلى السلة"
        const key = 'buy:' + productId;
        this.busy = Object.assign({}, this.busy, { [key]: true });
        try {
          const ok = await this.addToCart(productId, quantity, Object.assign({}, opts, { silent: true }));
          if (ok) this.checkout();
        } finally {
          const b = Object.assign({}, this.busy);
          delete b[key];
          this.busy = b;
        }
      },
      async updateItem(item, quantity) {
        quantity = parseInt(quantity, 10);
        if (isNaN(quantity)) return;
        if (quantity < 1) return this.removeItem(item);
        const max = this.itemMax(item);
        if (quantity > max) {
          this.notify(I18N.maxQty + ' ' + max, 'error');
          quantity = max;
          if (quantity === item.quantity) return;
        }
        if (item.__demo) {
          DemoCart.update(item._id, quantity);
          return this.syncDemoCart();
        }
        const c = await this.run('item:' + item._id, () => Store.cartUpdate(item._id, quantity));
        if (c) this.setCart(c);
      },
      async removeItem(item) {
        if (item.__demo) {
          DemoCart.remove(item._id);
          this.syncDemoCart();
          return this.notify(I18N.removed, 'success');
        }
        const c = await this.run('item:' + item._id, () => Store.cartRemove(item._id), I18N.removed);
        if (c) this.setCart(c);
        else this.refreshCart();
      },
      async clearCart() {
        DemoCart.clear();
        const c = await this.run('clear', () => Store.cartClear());
        this.setCart(c || { items: [], totalQuantity: 0, totalPrice: 0 });
      },
      async refreshCart() {
        try { this.setCart(await Store.cartFetch()); } catch (e) { /* ignore */ }
      },
      checkout() {
        if (!this.cartItems.length || this.cartBlocked || this.isBusy('checkout')) return;
        if (this.cartItems.some((i) => i.__demo)) return this.notify(I18N.demoCheckout, 'error');
        this.busy = Object.assign({}, this.busy, { checkout: true });
        const s = sdk();
        if (s && s.checkout && typeof s.checkout.start === 'function') return s.checkout.start();
        window.location.href = '/checkout';
      },

      /* ----- Wishlist ----- */
      isWished(id) {
        return this.wishlist.indexOf(id) > -1;
      },
      get wishCount() {
        return this.wishlist.length;
      },
      async toggleWish(id) {
        if (isDemoId(id)) return this.notify(I18N.demo, 'success');
        const wished = this.isWished(id);
        this.wishlist = wished ? this.wishlist.filter((x) => x !== id) : this.wishlist.concat(id);
        const res = await this.run('wish:' + id, () => (wished ? Store.wishlistRemove(id) : Store.wishlistAdd(id)), wished ? I18N.wishRemoved : I18N.wishAdded);
        if (res === null) {
          this.wishlist = wished ? this.wishlist.concat(id) : this.wishlist.filter((x) => x !== id);
          return;
        }
        const ids = pickArray(res, ['products', 'wishlist.products']).map((p) => p && (p._id || p.id)).filter(Boolean);
        if (ids.length || (res && res.count === 0)) this.wishlist = ids;
        window.dispatchEvent(new CustomEvent('wishlist:updated', { detail: res }));
      },

      /* ----- Search ----- */
      setSearch(q) {
        const query = (q || '').trim();
        if (!query) return;
        this.rememberSearch(query);
        window.location.href = withLang('/search?q=' + encodeURIComponent(query));
      },
      rememberSearch(query) {
        const list = [query].concat(this.recentSearches.filter((x) => SmartSearch.norm(x) !== SmartSearch.norm(query))).slice(0, 6);
        this.recentSearches = list;
        const ls = safeStorage('localStorage');
        if (ls) { try { ls.setItem('lg-recent-searches', JSON.stringify(list)); } catch (e) { /* ignore */ } }
      },
      clearRecentSearches() {
        this.recentSearches = [];
        const ls = safeStorage('localStorage');
        if (ls) { try { ls.removeItem('lg-recent-searches'); } catch (e) { /* ignore */ } }
      },
      // كلمة من "هل تقصد" أو من آخر البحث ← نفس الحقل وتحديث فوري
      // inputId: الحقل صاحب الاقتراحات (نافذة البحث أو مربع بحث صفحة المتجر)
      useSearch(q, inputId) {
        this.search = q;
        this.loadSuggestions();
        this.$nextTick(() => { const i = document.getElementById(inputId || 'lg-search-input'); if (i) i.focus(); });
      },
      // جلب الكتالوج مبكراً (عند التركيز على أي حقل بحث) حتى تظهر الاقتراحات فور الكتابة
      warmSearch() {
        SmartSearch.warm();
      },
      // أقل من حرفين بعد التطبيع (مسافات/تشكيل فقط) ← لا بحث بعد
      searchShort(q) {
        return SmartSearch.norm(q).length < 2;
      },
      // تمييز كلمات البحث في عناوين الاقتراحات (HTML آمن من SmartSearch.highlight)
      hl(text) {
        return SmartSearch.highlight(text, this.search);
      },
      // اقتراحات فورية: البحث الذكي في الكتالوج + التصنيفات من اقتراحات قمرة
      async loadSuggestions() {
        const q = (this.search || '').trim();
        this.suggestions.query = q;
        this.suggestions.active = -1;
        if (SmartSearch.norm(q).length < 2) {
          Object.assign(this.suggestions, { products: [], collections: [], total: 0, corrected: null, loading: false });
          return;
        }
        this.suggestions.loading = true;
        try {
          const [r, extra] = await Promise.all([
            SmartSearch.search(q),
            Store.suggest(q, 4).catch(() => ({ products: [], collections: [] }))
          ]);
          if (this.suggestions.query !== q) return;
          // الكتالوج غير متاح (خطأ شبكة) ← منتجات اقتراحات قمرة
          const products = r.items.length ? r.items : (extra.products || []);
          this.suggestions.products = products.slice(0, 6);
          this.suggestions.total = r.items.length || products.length;
          this.suggestions.corrected = r.corrected;
          this.suggestions.collections = (extra.collections || []).slice(0, 4);
        } catch (e) {
          Object.assign(this.suggestions, { products: [], collections: [], total: 0, corrected: null });
        } finally {
          if (this.suggestions.query === q) this.suggestions.loading = false;
        }
      },
      // التنقل بالأسهم + Enter بين الاقتراحات (SRCH-05)
      suggestKey(e) {
        const list = this.suggestions.products;
        if (e.key === 'ArrowDown' && list.length) {
          e.preventDefault();
          this.suggestions.active = (this.suggestions.active + 1) % list.length;
        } else if (e.key === 'ArrowUp' && list.length) {
          e.preventDefault();
          this.suggestions.active = (this.suggestions.active - 1 + list.length) % list.length;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const p = list[this.suggestions.active];
          if (p) window.location.href = withLang(this.productUrl(p));
          else this.setSearch(this.search);
        }
      },
      productImage(p) {
        if (!p) return '';
        const img = (p.images && p.images[0]) || p.image;
        return (img && (img.fileUrl || img.url)) || (typeof img === 'string' ? img : '');
      },
      productUrl(p) {
        if (p && p.__demo) return demoUrl(p._id);
        const h = p && (p.slug || p.handle);
        return h ? '/products/' + encodeURIComponent(h) : '#';
      },
      collectionUrl(c) {
        if (c && c.__demo) return demoUrl(c._id, 'demo_collection');
        const h = c && (c.handle || c.slug);
        return h ? '/collections/' + encodeURIComponent(h) : '/collections';
      },
      productPrice(p) {
        return (p && ((p.pricing && p.pricing.price) || p.price)) || 0;
      },
      productCompare(p) {
        return (p && ((p.pricing && p.pricing.compareAtPrice) || p.compareAtPrice)) || 0;
      },
      productOut(p) {
        if (!p) return false;
        if (this.cardInfo[p._id]) return this.cardInfo[p._id] === 'out';
        if (this.stockUnknown(p)) return false;
        return fullProductOut(p);
      },
      // كمية 0 من غير بيانات خيارات = مش معروف (مش «نفد») — نفس stockUnknown في product-card.njk
      stockUnknown(p) {
        if (!p || p.__demo || this.cardInfo[p._id] || untracked(p) || backorders(p)) return false;
        if (p.variants && p.variants.length) return false;
        return typeof p.quantity === 'number' && p.quantity <= 0 && !knownSimple(p);
      },
      // حالة أزرار الكارت: out | options | check | buy — نفس ui/card-actions.njk
      cardState(p) {
        if (!p) return 'buy';
        if (this.cardInfo[p._id]) return this.cardInfo[p._id];
        if (this.productOut(p)) return 'out';
        if (this.stockUnknown(p)) return 'check';
        return this.productHasOptions(p) ? 'options' : 'buy';
      },
      // خيارات الإضافة من كارت JS: handle لو الخيارات مش معروفة (addToCart يسأل قبل الإضافة)
      cardOpts(p) {
        if (!p || p.__demo || productHasOpts(p) || knownSimple(p) || this.cardInfo[p._id]) return {};
        return { handle: p.slug || p.handle };
      },
      // p = كارت JS (مابنسألش إلا لو مش معروف)؛ كارت السيرفر مابيتبعتش إلا لو مش معروف
      watchCard(id, handle, el, p) {
        if (!id || !handle || isDemoId(id) || this.cardInfo[id]) return;
        if (p && !this.stockUnknown(p)) return;
        CardWatch.add(el, () => Store.productByHandle(handle).then((full) => {
          if (!full) return; // فشل الطلب: يفضل «عرض المنتج»
          Stock.remember(Object.assign({}, full, { _id: id }));
          this.cardInfo = Object.assign({}, this.cardInfo, { [id]: fullProductOut(full) ? 'out' : (productHasOpts(full) ? 'options' : 'buy') });
        }));
      },
      // منتج واحد، منتجان، 3 منتجات، 11 منتج — نفس ui/count.njk
      countText(n) {
        const c = I18N.count || {};
        n = Number(n) || 0;
        const w = n === 1 ? c.one : (n === 2 ? c.two : (n >= 3 && n <= 10 ? c.few : c.many));
        return String(w || n).replace('{n}', n);
      },
      // تحذير المخزون القليل على البطاقات: الكمية الإجمالية المعروفة من 1 إلى الحد (نفس stockState) — وإلا 0
      productLowQty(p) {
        if (!p || untracked(p) || backorders(p) || this.productOut(p)) return 0;
        let qty = null;
        if (Array.isArray(p.variants) && p.variants.length && p.variants.every((v) => typeof v.quantity === 'number')) {
          qty = p.variants.reduce((n, v) => n + Math.max(0, v.quantity), 0);
        }
        if (qty === null && typeof p.quantity === 'number') qty = p.quantity;
        return stockState(qty) === 'low' ? qty : 0;
      },
      lowLeft(n) {
        return String(I18N.lowLeft || '').replace('%n', n);
      },
      productHasOptions(p) {
        return productHasOpts(p);
      },

      /* ----- بطاقات تُرسم بالـ JS (ui/card-js.njk, ui/mini-js.njk) — نفس منطق product-card.njk ----- */
      i18n: I18N,
      cardSub(p) {
        if (!p) return '';
        if (p.subtitle) return p.subtitle;
        const d = plainText(p.description);
        return d.length > 60 ? d.slice(0, 57).trim() + '...' : d;
      },
      cardBadge(p) {
        if (!p) return null;
        if (this.productOut(p)) return { cls: 'lg-badge--out', label: I18N.out };
        const d = this.discountOf(p);
        if (d > 0) return { cls: 'lg-badge--sale', label: '-' + d + '%' };
        const tags = (Array.isArray(p.tags) ? p.tags : []).map((t) => (t && typeof t === 'object' ? (t.name || t.title || t.value) : t));
        const has = (a, b) => tags.indexOf(a) > -1 || tags.indexOf(b) > -1;
        if (has('best-seller', 'الأكثر-مبيعا')) return { cls: 'lg-badge--best', label: I18N.best };
        if (has('new', 'جديد')) return { cls: 'lg-badge--new', label: I18N.new };
        if (has('hot', 'رائج')) return { cls: 'lg-badge--hot', label: I18N.hot };
        return null;
      },
      cardRating(p) {
        return Math.round(Number(p && p.averageRating) || 0);
      }
    };
  };

  /* ---------- أقسام المنتجات بدون اختيار من المحرر ----------
     منتجات المتجر الحقيقية تظهر فقط عندما يختارها التاجر في إعدادات القسم (لا تعبئة تلقائية من المتجر).
     بدون اختيار: منتجات توضيحية في المعاينة (ui/demo-data.njk)، والقسم مخفي للعملاء على المتجر الحي. */

  /* ---------- فلتر السعر: نطاق واحد في الرابط filters[price][min|max] (صيغة سيرفر قمرة) ----------
     السيرفر يطبّقه على /shop و /collections/<h>، والـ API على البحث. ما لا يطبّقه السيرفر — /latest،
     المنتجات التوضيحية، والمنتجات المجلوبة بالـ JS — يُطبَّق في المتصفح بنفس النطاق. القيم بوحدة العرض. */
  const PRICE_MIN = 'filters[price][min]';
  const PRICE_MAX = 'filters[price][max]';
  const priceNum = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  function readPriceRange() {
    const q = new URLSearchParams(window.location.search);
    return {
      min: priceNum(q.get(PRICE_MIN) !== null ? q.get(PRICE_MIN) : q.get('minPrice')),
      max: priceNum(q.get(PRICE_MAX) !== null ? q.get(PRICE_MAX) : q.get('maxPrice'))
    };
  }
  // سعر المنتج (بوحدة المتجر) داخل النطاق (بوحدة العرض)؟
  function priceInRange(p, r) {
    if (!r || (r.min === null && r.max === null)) return true;
    const raw = p && typeof p === 'object' ? ((p.pricing && p.pricing.price) || p.price || 0) : p;
    const v = Money.toNumber(raw);
    return (r.min === null || v >= r.min) && (r.max === null || v <= r.max);
  }
  // فلاتر لوحة التحكم من الرابط filters[name][]=v (السيرفر يطبّقها) — بديل الـ SDK إن لم يُحمَّل
  function readUrlFilters() {
    const out = {};
    new URLSearchParams(window.location.search).forEach((v, k) => {
      const m = k.match(/^filters\[([^\]]+)\](?:\[\])?$/);
      if (m && m[1] !== 'price') (out[m[1]] = out[m[1]] || []).push(String(v));
    });
    return out;
  }
  function filtersUrl(facets, r) {
    const u = new URL(priceUrl(r));
    Array.from(u.searchParams.keys()).forEach((k) => { if (/^filters\[/.test(k) && k.indexOf('filters[price]') !== 0) u.searchParams.delete(k); });
    Object.keys(facets || {}).forEach((name) => (facets[name] || []).forEach((v) => u.searchParams.append('filters[' + name + '][]', v)));
    return u.toString();
  }
  function priceUrl(r) {
    const u = new URL(window.location.href);
    [PRICE_MIN, PRICE_MAX, 'minPrice', 'maxPrice', 'page'].forEach((k) => u.searchParams.delete(k));
    if (r && r.min !== null) u.searchParams.set(PRICE_MIN, r.min);
    if (r && r.max !== null) u.searchParams.set(PRICE_MAX, r.max);
    return u.toString();
  }

  /* ---------- هل في المتجر بيانات حقيقية؟ (المعاينة فقط) ----------
     المنتجات/التصنيفات التوضيحية تختفي من المتجر كله بمجرد وجود منتج/تصنيف حقيقي واحد.
     يُستدعى في المعاينة فقط (المتجر الحي لا يعرض بيانات توضيحية أصلاً)، والنتيجة محفوظة 5 دقائق في الجلسة. */
  const StoreData = (function () {
    const KEY = 'lg-store-has';
    const TTL = 5 * 60 * 1000;
    const session = safeStorage('sessionStorage');
    let cache = {};
    try {
      const v = session && JSON.parse(session.getItem(KEY) || 'null');
      if (v && Date.now() - v.t < TTL) cache = v;
    } catch (e) { /* ignore */ }
    const pending = {};
    const active = (c) => c && c.status !== 'inactive' && c.status !== 'draft' && c.active !== false && c.isActive !== false && c.published !== false && c.deleted !== true && !(c.salesChannels && c.salesChannels.onlineStore === false);
    const listOf = (cols) => (Array.isArray(cols) ? cols : (cols && cols.data)) || [];
    // روابط المعاينة (?theme=...) تُنقل لطلب صفحة التصنيفات حتى يُعرض نفس الثيم
    function collectionsUrl() {
      const u = new URL('/collections', window.location.origin);
      const cur = new URLSearchParams(window.location.search);
      ['theme', 'theme_id', 'preview', 'preview_theme_id', 'editor'].forEach((k) => { if (cur.has(k)) u.searchParams.set(k, cur.get(k)); });
      u.searchParams.set('limit', '1');
      return u.toString();
    }
    const checks = {
      async products() {
        const r = await Store.searchProducts({ q: '', limit: 1 });
        return r.products.length > 0;
      },
      async collections() {
        const here = window.__QUMRA_CONTEXT__;
        if (here && here.collections && listOf(here.collections).some(active)) return true;
        const res = await fetch(collectionsUrl(), { credentials: 'same-origin', headers: { Accept: 'text/html' } });
        const ctx = contextFromHtml(await res.text());
        return listOf(ctx && ctx.collections).some(active);
      }
    };
    function has(kind) {
      if (typeof cache[kind] === 'boolean') return Promise.resolve(cache[kind]);
      if (!pending[kind]) {
        pending[kind] = checks[kind]().then((v) => {
          cache = Object.assign(cache, { [kind]: v, t: cache.t || Date.now() });
          try { if (session) session.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
          return v;
        }).catch(() => false); // تعذّر التحقق ← نعامله كمتجر فارغ (السلوك السابق)
      }
      return pending[kind];
    }
    return { hasProducts: () => has('products'), hasCollections: () => has('collections') };
  })();

  // collection: معرّف تصنيف مختار في إعدادات القسم (منتجات مميزة / الأكثر مبيعاً) ← أول limit منتج منه،
  // على المتجر الحي والمعاينة، و"عرض الكل" في القسم يفتح صفحة نفس التصنيف
  window.lgAutoProducts = function (limit, collection) {
    limit = Math.max(1, Math.min(24, parseInt(limit, 10) || 4));
    return {
      items: [],
      loading: true,
      demo: false,
      // المعاينة + المتجر فيه منتجات حقيقية ولم يُختر شيء للقسم: تلميح للتاجر بدل المنتجات التوضيحية
      hint: false,
      // المعاينة + التصنيف المختار بلا منتجات: تلميح للتاجر (والقسم مخفي للعملاء)
      empty: false,
      // نطاق السعر الحالي (من الرابط، ويتحدث فوراً من lgFilters عبر الحدث lg-price)
      range: readPriceRange(),
      get visible() {
        return this.items.filter((p) => priceInRange(p, this.range));
      },
      async init() {
        window.addEventListener('lg-price', (e) => { this.range = e.detail || readPriceRange(); });
        if (collection) {
          try {
            const r = await Store.collectionProducts(collection, 1, limit);
            const list = r.products.slice(0, limit);
            list.forEach((p) => Stock.remember(p));
            this.items = list;
          } catch (e) { /* تعذّر الجلب: القسم مخفي */ }
          this.empty = !this.items.length && isPreview();
          this.loading = false;
          return;
        }
        if (isPreview()) {
          if (await StoreData.hasProducts()) {
            this.hint = true;
          } else {
            const list = readDemo(this.$el).slice(0, limit).map(demoProduct);
            this.demo = list.length > 0;
            list.forEach((p) => Stock.remember(p));
            this.items = list;
          }
        }
        this.loading = false;
      }
    };
  };

  function demoCollection(c) {
    return { _id: c._id, __demo: true, title: c.title, image: c.image };
  }

  window.lgAutoCollections = function () {
    return {
      items: [],
      demo: false,
      hint: false,
      async init() {
        if (!isPreview()) return;
        if (await StoreData.hasCollections()) {
          this.hint = true;
          return;
        }
        this.items = readDemo(this.$el, 'collections').map(demoCollection);
        this.demo = this.items.length > 0;
      }
    };
  };

  /* ---------- صفحة كل التصنيفات (widgets/collections-list): كل تصنيف ومنتجاته تحته ----------
     التصنيفات من السيرفر (context.collections — 10 فقط في الصفحة، والباقي من /collections?limit=N)، ومنتجات كل تصنيف
     من Search API بفلتر collectionId. متجر صغير (≤ COL_EAGER منتج في كل التصنيفات): نجلب الكل مرة واحدة ثم قسم
     "منتجات أخرى" للمنتجات التي ليست في أي تصنيف حتى تظهر كل المنتجات. متجر كبير: كل قسم يُجلب عند اقترابه من الشاشة.
     المعاينة (فقط — لا تظهر للعملاء): التصنيفات والمنتجات التوضيحية نفسها المستخدمة في كل المتجر (ui/demo-data.njk:
     قائمة التصنيفات في الهيدر، شبكة التصنيفات، الصفحات التوضيحية، البحث) تُضاف بعد الحقيقية — منها تصنيف 1000 منتج وتصنيف فارغ. */
  const COL_EAGER = 400;
  const COL_PAGE = 48;

  // window.__QUMRA_CONTEXT__ من HTML صفحة أخرى — الكائن متبوع بسكربت في نفس السطر، فنقطع عند قوس الإغلاق المطابق.
  // نبحث عن سطر التعيين نفسه: الاسم يظهر قبله في سكربتات أخرى (عنوان التبويب الإنجليزي في layout.njk يقرأ المتغير)
  function contextFromHtml(html) {
    const m = /__QUMRA_CONTEXT__\s*=\s*\{/.exec(html);
    if (!m) return null;
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
    return null;
  }

  // تشغيل مهام async بحد أقصى n في نفس الوقت
  async function runLimited(tasks, n) {
    const queue = tasks.slice();
    const worker = async () => {
      while (queue.length) {
        try { await queue.shift()(); } catch (e) { /* القسم يعرض رسالة الخطأ */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, queue.length) }, worker));
  }

  window.lgCollectionsPage = function (config) {
    config = config || {};
    const per = Math.max(4, parseInt(config.per, 10) || 8);
    const section = (c) => ({
      c, items: [], shown: per, total: typeof c.count === 'number' ? c.count : null,
      page: 0, hasNext: true, loading: false, loaded: false, error: false
    });
    return {
      sections: (config.collections || []).map(section),   // التصنيفات الحقيقية
      extra: [],          // كروت تصنيفات حقيقية تُرسم بالـ JS (بعد أول 10)
      others: null,       // قسم "منتجات أخرى"
      demoCols: [],       // التصنيفات التوضيحية (المعاينة فقط)
      demoSections: [],
      eager: false,
      get cards() {
        return this.extra.concat(this.demoCols);
      },
      get allSections() {
        return this.sections.concat(this.others ? [this.others] : [], this.demoSections);
      },
      async init() {
        // التصنيفات التوضيحية فقط إذا لم يكن في المتجر أي تصنيف حقيقي
        if (isPreview() && !this.sections.length) this.demoInit();
        if (!this.sections.length) return;
        if (config.more) await this.loadMoreCollections();
        if (!config.products) return;
        const counted = this.sections.reduce((n, s) => n + (s.total || 0), 0);
        this.eager = this.sections.length <= 30 && counted <= COL_EAGER && this.sections.every((s) => s.total !== null);
        if (this.eager) {
          await runLimited(this.sections.map((s) => () => this.load(s, Infinity)), 4);
          if (config.others) await this.findOthers();
        } else {
          this.$nextTick(() => this.observe());
        }
      },
      // كل قسم يُجلب عند اقترابه من الشاشة (المتاجر الكبيرة)
      observe() {
        const byId = {};
        this.sections.forEach((s) => { byId[s.c._id] = s; });
        const els = this.$el.querySelectorAll('[data-col-section]');
        if (!('IntersectionObserver' in window)) {
          this.sections.forEach((s) => this.load(s, per));
          return;
        }
        const io = new IntersectionObserver((entries) => entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          const s = byId[e.target.getAttribute('data-col-section')];
          if (s && !s.loaded) this.load(s, per);
        }), { rootMargin: '600px 0px' });
        els.forEach((el) => io.observe(el));
      },
      async load(s, want) {
        if (s.loading || s.c.__demo || s.c.__others) return;
        s.loading = true;
        s.error = false;
        try {
          while (s.hasNext && s.items.length < want) {
            const r = await Store.collectionProducts(s.c._id, s.page + 1, want === Infinity ? 250 : COL_PAGE);
            s.page++;
            r.products.forEach((p) => Stock.remember(p));
            const seen = new Set(s.items.map((p) => p._id));
            s.items = s.items.concat(r.products.filter((p) => !seen.has(p._id)));
            if (r.total !== null) s.total = r.total;
            s.hasNext = r.hasNext && r.products.length > 0;
          }
        } catch (e) {
          s.error = true;
        } finally {
          s.loading = false;
          s.loaded = true;
        }
      },
      visible(s) {
        return s.items.slice(0, s.shown);
      },
      remaining(s) {
        const total = s.total !== null ? s.total : s.items.length;
        return Math.max(0, total - Math.min(s.shown, s.items.length));
      },
      more(s) {
        s.shown += Math.max(per, 24);
        if (s.items.length < s.shown) this.load(s, s.shown);
      },
      // التصنيفات بعد أول 10: نفس الصفحة بـ ?limit=N (السيرفر يقبله) ونقرأ context.collections من HTML
      async loadMoreCollections() {
        try {
          const u = new URL(window.location.href);
          u.searchParams.set('limit', String(Math.min(250, Math.max(20, parseInt(config.totalCollections, 10) || 100))));
          u.searchParams.delete('page');
          u.hash = '';
          const res = await fetch(u.toString(), { credentials: 'same-origin', headers: { Accept: 'text/html' } });
          const ctx = contextFromHtml(await res.text());
          const list = (ctx && (Array.isArray(ctx.collections) ? ctx.collections : (ctx.collections && ctx.collections.data))) || [];
          const have = new Set(this.sections.map((s) => s.c._id));
          list.forEach((c) => {
            if (!c || have.has(c._id) || c.status === 'inactive' || c.status === 'draft' || c.active === false || c.isActive === false || c.published === false || c.deleted === true || (c.salesChannels && c.salesChannels.onlineStore === false)) return;
            const col = { _id: c._id, title: c.title, handle: c.handle || c.slug, image: (c.image && c.image.fileUrl) || '', count: typeof c.productCount === 'number' ? c.productCount : null };
            have.add(c._id);
            this.extra.push(col);
            this.sections.push(section(col));
          });
        } catch (e) { /* أول 10 تصنيفات فقط */ }
      },
      // "منتجات أخرى": كتالوج المتجر كاملاً ناقص منتجات كل التصنيفات (فقط عندما جُلبت كلها بلا أخطاء)
      async findOthers() {
        if (!this.sections.every((s) => s.loaded && !s.hasNext && !s.error)) return;
        const cat = await SmartSearch.all();
        if (!cat || !cat.complete) return;
        const inCollections = new Set();
        this.sections.forEach((s) => s.items.forEach((p) => inCollections.add(p._id)));
        const items = cat.items.filter((p) => !inCollections.has(p._id));
        if (!items.length) return;
        items.forEach((p) => Stock.remember(p));
        this.others = Object.assign(section({ _id: '__others', __others: true, title: config.othersTitle || '', count: items.length }), {
          items, hasNext: false, loaded: true
        });
      },
      // المعاينة: نفس التصنيفات والمنتجات التوضيحية في كل المتجر (الكتالوج العام #lg-demo-catalog) — بعد الحقيقية
      demoInit() {
        const cols = readDemo(null, 'collections').map(demoCollection);
        if (!cols.length) return;
        const all = readDemo(null, 'all').map(demoProduct);
        cols.forEach((c) => {
          const items = all.filter((p) => p.collectionId === c._id);
          const col = Object.assign({}, c, { count: items.length });
          this.demoCols.push(col);
          if (config.products) this.demoSections.push(Object.assign(section(col), { items, hasNext: false, loaded: true }));
        });
      }
    };
  };

  /* ---------- الصفحات التوضيحية (ui/demo-pages.njk) — المعاينة فقط ----------
     منتج: ?demo_product=<id>، أو تلقائياً في قالب صفحة المنتج عندما لا يوجد منتج (#lg-demo-fallback).
     تصنيف: ?demo_collection=<id>. الكلاس is-demo-page على <html> يخفي محتوى الصفحة الأصلي. */

  window.lgDemoProduct = function () {
    return {
      demoProduct: null,
      crumb: null,
      related: [],
      async init() {
        const id = new URLSearchParams(window.location.search).get('demo_product');
        const fallback = !id && document.getElementById('lg-demo-fallback');
        if (!id && !fallback) return;
        // صفحة منتج غير موجود: منتج توضيحي فقط إذا كان المتجر بلا منتجات حقيقية
        const realStore = !!fallback && isPreview() && await StoreData.hasProducts();
        const list = isPreview() && !realStore ? readDemo(null, 'all').map(demoProduct) : [];
        const p = list.find((x) => x._id === id) || list[0];
        showDemoPage(!!p);
        if (!p) return;
        document.title = p.title;
        this.demoProduct = p;
        this.crumb = readDemo(null, 'collections').map(demoCollection).find((c) => c._id === p.collectionId) || null;
        // منتجات من نفس التصنيف أولاً
        const same = (x) => (x.collectionId === p.collectionId ? 0 : 1);
        this.related = list.filter((x) => x._id !== p._id).sort((a, b) => same(a) - same(b)).slice(0, 4);
      }
    };
  };

  const DEMO_PAGE = 24;
  window.lgDemoCollection = function (i18n) {
    const initial = readPriceRange();
    return {
      current: null,
      collections: [],
      products: [],
      // فلتر السعر للمنتجات التوضيحية — في المتصفح فوراً، والنطاق في الرابط (يبقى بعد التحديث)
      price: { min: initial.min === null ? '' : initial.min, max: initial.max === null ? '' : initial.max },
      range: initial,
      priceError: '',
      // عرض تدريجي (التصنيف الضخم 1000 منتج): DEMO_PAGE بطاقة في كل مرة
      limit: DEMO_PAGE,
      get shown() {
        return this.products.filter((p) => priceInRange(p, this.range));
      },
      get visible() {
        return this.shown.slice(0, this.limit);
      },
      more() {
        this.limit += DEMO_PAGE;
      },
      get priceActive() {
        return this.range.min !== null || this.range.max !== null;
      },
      applyPrice() {
        const min = priceNum(this.price.min);
        const max = priceNum(this.price.max);
        const bad = (this.price.min !== '' && this.price.min !== null && min === null) || (this.price.max !== '' && this.price.max !== null && max === null);
        if (bad || (min !== null && min < 0) || (max !== null && max < 0) || (min !== null && max !== null && min > max)) {
          this.priceError = (i18n && i18n.priceInvalid) || '';
          return;
        }
        this.priceError = '';
        this.range = { min, max };
        this.limit = DEMO_PAGE;
        window.history.replaceState({}, '', priceUrl(this.range));
      },
      clearPrice() {
        this.price = { min: '', max: '' };
        this.priceError = '';
        this.range = { min: null, max: null };
        this.limit = DEMO_PAGE;
        window.history.replaceState({}, '', priceUrl(this.range));
      },
      init() {
        const id = new URLSearchParams(window.location.search).get('demo_collection');
        if (!id) return;
        this.collections = isPreview() ? readDemo(null, 'collections').map(demoCollection) : [];
        const c = this.collections.find((x) => x._id === id) || this.collections[0];
        showDemoPage(!!c);
        if (!c) return;
        document.title = c.title;
        this.current = c;
        this.products = readDemo(null, 'all').map(demoProduct).filter((p) => p.collectionId === c._id);
      }
    };
  };

  /* ---------- /blogs: المنصة بتبعت التصنيفات بس (context.blogs) ----------
     بنجيب كروت كل تصنيف من صفحته ونعرضها كلها بالأحدث، بنفس الكارت (widgets/blog-list). طلب ورا طلب (429 مع الطلبات الكتير)،
     وأي تصنيف فشل بيتساب، ولينكات الفلتر بتفضل شغالة حتى من غير JS. */
  window.lgBlogMerge = function () {
    return {
      loading: true,
      count: 0,
      async init() {
        const section = this.$root.closest('section');
        const links = Array.from(section.querySelectorAll('[data-blog-cat]')).slice(0, 12);
        const found = new Map();
        const get = async (url, retry) => {
          const res = await fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
          if (res.status === 429 && retry) { await new Promise((r) => setTimeout(r, 1500)); return get(url, false); }
          return res.ok ? res.text() : '';
        };
        for (const link of links) {
          try {
            const html = await get(link.getAttribute('href'), true);
            new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-lg-post]').forEach((card) => {
              const key = card.getAttribute('data-lg-post');
              if (key && !found.has(key)) found.set(key, card);
            });
          } catch (e) { /* التصنيف ده يتساب */ }
        }
        const dateOf = (card) => { const t = card.querySelector('time[datetime]'); return (t && Date.parse(t.getAttribute('datetime'))) || 0; };
        const cards = Array.from(found.values()).sort((a, b) => dateOf(b) - dateOf(a));
        cards.forEach((card) => this.$refs.grid.appendChild(document.importNode(card, true)));
        this.count = cards.length;
        this.loading = false;
      }
    };
  };

  /* ---------- Product page component ---------- */

  function valueIdOf(v) {
    if (v == null) return '';
    if (typeof v !== 'object') return String(v);
    return String(v._id || v.id || v.valueId || v.value || v.label || '');
  }

  /* دواير الألوان: قيمة اللون ممكن تكون hex أو اسم عربي/إنجليزي (أو مش موجودة) — اسم مش معروف = من غير دايرة بدل دايرة بيضا */
  const COLOR_NAMES = {
    'اسود': '#111111', 'أسود': '#111111', black: '#111111', 'ابيض': '#ffffff', 'أبيض': '#ffffff', white: '#ffffff',
    'احمر': '#c81e1e', 'أحمر': '#c81e1e', red: '#c81e1e', 'ازرق': '#1d4ed8', 'أزرق': '#1d4ed8', blue: '#1d4ed8', 'كحلي': '#1e2a5a', navy: '#1e2a5a',
    'اخضر': '#15803d', 'أخضر': '#15803d', green: '#15803d', 'اصفر': '#eab308', 'أصفر': '#eab308', yellow: '#eab308',
    'برتقالي': '#ea7317', orange: '#ea7317', 'وردي': '#ec4899', 'بينك': '#ec4899', pink: '#ec4899', 'بنفسجي': '#7c3aed', purple: '#7c3aed',
    'رمادي': '#8a8f98', gray: '#8a8f98', grey: '#8a8f98', 'فضي': '#c0c4cc', silver: '#c0c4cc', 'ذهبي': '#c9a227', gold: '#c9a227',
    'بني': '#7a4a24', brown: '#7a4a24', 'بيج': '#dcc9a8', beige: '#dcc9a8', 'تيتانيوم': '#8d8a84', titanium: '#8d8a84'
  };
  function swatchOf(v) {
    if (!v || typeof v !== 'object') return '';
    const raw = String(v.color || v.hex || '').trim();
    if (raw && window.CSS && CSS.supports && CSS.supports('color', raw)) return raw;
    return COLOR_NAMES[raw.toLowerCase()] || COLOR_NAMES[String(v.label || v.value || v.name || '').trim().toLowerCase()] || '';
  }

  window.lgProduct = function (config) {
    const product = config.product || {};
    const options = Array.isArray(product.options) ? product.options.filter((o) => o && o.values && o.values.length) : [];
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const noTracking = untracked(product);
    const backorder = backorders(product);

    const variantValueIds = (v) => {
      const raw = v.options || v.optionValues || v.selectedOptions || [];
      return (Array.isArray(raw) ? raw : []).map(valueIdOf).filter(Boolean);
    };

    return {
      product,
      options,
      quantity: 1,
      selected: {},
      variant: null,
      resolving: false,
      missing: '',
      qtyNotice: '',
      tab: 'desc',
      price: (product.pricing && product.pricing.price) || 0,
      compareAt: (product.pricing && product.pricing.compareAtPrice) || 0,
      sku: product.sku || '',

      init() {
        Stock.remember(product);
        // لا اختيار تلقائي: العميل يجب أن يختار بنفسه (REG-10)
        this.$nextTick(() => this.initGallery());
        // سعر رقمي في JSON-LD بنفس قاعدة تحويل العملة (PRD-21)
        try {
          const ld = document.getElementById('lg-jsonld-' + product._id);
          if (ld) {
            const data = JSON.parse(ld.textContent);
            if (data.offers) data.offers.price = Money.toNumber(this.price);
            ld.textContent = JSON.stringify(data);
          }
        } catch (e) { /* ignore */ }
      },
      optKey(opt, i) {
        return String(opt._id || opt.name || i);
      },
      valueId(v) {
        return valueIdOf(v);
      },
      // الدايرة لخيار اللون بس: قيمة فيها لون، أو خيار نوعه/اسمه لون
      swatch(opt, v) {
        const isColor = (v && (v.color || v.hex)) || (opt && (opt.type === 'color' || /لون|colou?r/i.test(String(opt.name || opt.title || ''))));
        return isColor ? swatchOf(v) : '';
      },
      get selectedIds() {
        return this.options.map((o, i) => this.selected[this.optKey(o, i)]).filter(Boolean);
      },
      get allSelected() {
        return this.options.length === 0 || this.selectedIds.length === this.options.length;
      },
      /* المخزون الحالي: من المتغير المختار، وإلا من المنتج */
      get currentQty() {
        if (this.variant && typeof this.variant.quantity === 'number') return this.variant.quantity;
        if (this.options.length && !this.allSelected) {
          // قبل اختيار المتغير: مجموع المتغيرات المعروفة أو مخزون المنتج
          if (variants.length && variants.every((v) => typeof v.quantity === 'number')) {
            return variants.reduce((sum, v) => sum + Math.max(0, v.quantity), 0);
          }
        }
        return typeof product.quantity === 'number' ? product.quantity : null;
      },
      get stock() {
        return stockState(this.currentQty, { untracked: noTracking, backorder });
      },
      // أقصى ما يمكن إضافته: المتاح ناقص ما في السلة من نفس المنتج/المتغير
      get maxQty() {
        if (noTracking || backorder || typeof this.currentQty !== 'number') return 999;
        return Math.max(0, this.currentQty - this.inCartQty(product._id, this.variant && this.variant._id));
      },
      get canBuy() {
        return this.stock !== 'out';
      },
      get discount() {
        return discountPercent(this.price, this.compareAt);
      },
      /* هل القيمة متاحة مع باقي الاختيارات الحالية؟ (PRD-05) */
      isValueAvailable(opt, i, v) {
        if (!variants.length || noTracking || backorder) return true;
        const id = this.valueId(v);
        const others = this.options
          .map((o, j) => (j === i ? null : this.selected[this.optKey(o, j)]))
          .filter(Boolean);
        const candidates = variants.filter((vr) => {
          const ids = variantValueIds(vr);
          if (!ids.length) return true;
          return ids.indexOf(id) > -1 && others.every((x) => ids.indexOf(x) > -1);
        });
        if (!candidates.length) return !variants.some((vr) => variantValueIds(vr).length); // لا توجد بيانات ربط
        return candidates.some((vr) => typeof vr.quantity !== 'number' || vr.quantity > 0);
      },
      isChosen(opt, i, v) {
        return this.selected[this.optKey(opt, i)] === this.valueId(v);
      },
      async choose(opt, i, v) {
        if (!this.isValueAvailable(opt, i, v)) return;
        this.selected = Object.assign({}, this.selected, { [this.optKey(opt, i)]: this.valueId(v) });
        this.missing = '';
        await this.resolve();
        this.clampQty();
      },
      findLocalVariant() {
        if (!variants.length) return null;
        const ids = this.selectedIds;
        return variants.find((vr) => {
          const vIds = variantValueIds(vr);
          return vIds.length && ids.every((x) => vIds.indexOf(x) > -1) && vIds.length === ids.length;
        }) || null;
      },
      applyVariant(v) {
        this.variant = v;
        if (!v) return;
        if (v._id && !noTracking && !backorder && typeof v.quantity === 'number') Stock.set(product._id, v._id, v.quantity);
        if (typeof v.price === 'number') this.price = v.price;
        else if (v.pricing && typeof v.pricing.price === 'number') this.price = v.pricing.price;
        if (typeof v.compareAtPrice === 'number') this.compareAt = v.compareAtPrice;
        else if (v.pricing && typeof v.pricing.compareAtPrice === 'number') this.compareAt = v.pricing.compareAtPrice;
        if (v.sku) this.sku = v.sku;
        const img = v.image && (v.image.fileUrl || v.image.url);
        if (img) this.$dispatch('lg-variant-image', { src: img });
      },
      async resolve() {
        if (!product._id || !this.allSelected || !this.options.length) return;
        const local = this.findLocalVariant();
        if (local) {
          this.applyVariant(local);
          return;
        }
        this.resolving = true;
        try {
          const res = await Store.resolveVariant(product._id, this.selectedIds, 1);
          const v = (res && (res.variant || res.data || res)) || null;
          this.applyVariant(v && (v._id || typeof v.price === 'number') ? v : null);
        } catch (e) {
          this.variant = null;
        } finally {
          this.resolving = false;
        }
      },
      /* الكمية: لا تقل عن 1 ولا تتجاوز المخزون (PRD-06/07) */
      clampQty() {
        // قيمة سالبة أو غير رقمية تُصحَّح لـ 1، والأرقام العربية مقبولة (PRD-07)
        const raw = toLatinDigits(String(this.quantity));
        let q = /-/.test(raw) ? 1 : parseInt(raw.replace(/[^\d]/g, ''), 10);
        if (isNaN(q) || q < 1) q = 1;
        const max = this.maxQty;
        if (max <= 0 && this.canBuy) {
          q = 1;
          this.qtyNotice = I18N.stockInCart; // كل المتاح موجود في السلة
        } else if (q > max && max > 0) {
          q = max;
          this.qtyNotice = I18N.maxQty + ' ' + max;
        } else {
          this.qtyNotice = '';
        }
        this.quantity = q;
      },
      inc() {
        const max = this.maxQty;
        if (this.quantity >= max) {
          this.qtyNotice = max <= 0 ? I18N.stockInCart : I18N.maxQty + ' ' + max;
          return;
        }
        this.quantity += 1;
        this.qtyNotice = '';
      },
      dec() {
        this.quantity = Math.max(1, this.quantity - 1);
        this.qtyNotice = '';
      },
      /* رسالة تحدد الخيار الناقص بالاسم + التمرير له (REG-10/11/12) */
      validate() {
        const idx = this.options.findIndex((o, i) => !this.selected[this.optKey(o, i)]);
        if (idx === -1) {
          this.missing = '';
          return true;
        }
        const opt = this.options[idx];
        this.missing = (I18N.select || '') + ' ' + (opt.name || opt.title || '');
        this.$nextTick(() => {
          const el = this.$root.querySelector('[data-option-index="' + idx + '"]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return false;
      },
      cartOpts() {
        return { options: this.selectedIds, variantId: this.variant && this.variant._id };
      },
      async add() {
        if (!this.validate() || !this.canBuy) return;
        this.clampQty();
        const ok = await this.addToCart(product._id, this.quantity, this.cartOpts());
        this.clampQty(); // المتبقي بعد الإضافة
        return ok;
      },
      buy() {
        if (!this.validate() || !this.canBuy) return;
        this.clampQty();
        return this.buyNow(product._id, this.quantity, this.cartOpts());
      },
      async share() {
        const url = window.location.href;
        try {
          if (navigator.share) return await navigator.share({ title: product.title, url });
          await navigator.clipboard.writeText(url);
          this.notify(I18N.linkCopied, 'success');
        } catch (e) { /* user cancelled */ }
      },
      async initGallery() {
        const root = this.$root;
        if (!root.querySelector('.lg-gallery-swiper')) return;
        try { await loadLib('swiper'); } catch (e) { return; }
        const mainEl = root.querySelector('.lg-gallery-swiper');
        if (!mainEl || mainEl.swiper) return;
        const thumbsEl = root.querySelector('.lg-gallery-thumbs');
        let thumbs = null;
        if (thumbsEl) {
          thumbs = new Swiper(thumbsEl, { slidesPerView: 4.4, spaceBetween: 10, watchSlidesProgress: true, breakpoints: { 768: { slidesPerView: 5.4 } } });
        }
        const main = new Swiper(mainEl, {
          spaceBetween: 10,
          pagination: { el: mainEl.querySelector('.swiper-pagination'), clickable: true },
          thumbs: thumbs ? { swiper: thumbs } : undefined
        });
        root.addEventListener('lg-variant-image', (e) => {
          const src = e.detail && e.detail.src;
          if (!src) return;
          const slides = Array.from(mainEl.querySelectorAll('.swiper-slide img'));
          const idx = slides.findIndex((img) => img.getAttribute('src') === src);
          if (idx > -1) main.slideTo(idx);
        });
      }
    };
  };

  /* ---------- Collection filters (Store SDK filters + URL state) ----------
     config.mode:
       'server' — /shop و /collections/<h>: السيرفر يطبّق filters[price] (عبر الـ SDK، وإلا بإعادة تحميل الرابط)،
                  والمنتجات التوضيحية (المعاينة بلا منتجات) تُفلتر في المتصفح من نفس الرابط.
       'client' — /latest وما شابه: السيرفر يتجاهل فلتر السعر، فيُطبَّق فوراً في المتصفح بلا إعادة تحميل.
     config.prices: أسعار منتجات السيرفر المعروضة (لحساب "لا نتائج" في وضع client). */
  // باراميترات المعاينة والبحث تبقى عند مسح الفلاتر (حتى لا تخرج المعاينة من الثيم)
  const KEEP_PARAMS = ['q', 'sort', 'theme', 'theme_id', 'preview', 'preview_theme_id', 'editor'];

  window.lgFilters = function (config) {
    config = config || {};
    const s = sdk();
    const hasSdk = !!(s && s.filters);
    const initial = readPriceRange();
    const initialActive = initial.min !== null || initial.max !== null;
    // صفحة server بلا منتجات من السيرفر (متجر فارغ ← منتجات توضيحية في المعاينة): الفلترة في المتصفح فوراً —
    // إلا إذا كان الفراغ نتيجة فلتر سعر سابق على السيرفر، فيبقى على السيرفر حتى يرجع المنتجات عند تغييره أو مسحه
    const noServerProducts = Array.isArray(config.prices) && !config.prices.length;
    const mode = config.mode === 'client' || (noServerProducts && !initialActive) ? 'client' : 'server';
    const useSdk = hasSdk && mode === 'server';
    const url = () => new URL(window.location.href);
    const emitPrice = (r) => window.dispatchEvent(new CustomEvent('lg-price', { detail: r }));

    return {
      drawer: false,
      sort: '',
      mode,
      pending: {},          // { name: [values] } — مسودة الموبايل
      price: { min: initial.min === null ? '' : initial.min, max: initial.max === null ? '' : initial.max },
      range: initial,       // النطاق المطبَّق فعلاً { min, max } (أرقام أو null)
      priceError: '',
      expanded: {},
      version: 0,

      init() {
        this.sort = (useSdk && s.filters.getSort && s.filters.getSort()) || url().searchParams.get('sort') || '';
        this.syncFromState();
        if (useSdk && typeof s.on === 'function') {
          ['collection:filtered', 'collection:sorted', 'collection:reset'].forEach((ev) => {
            s.on(ev, () => { this.syncFromState(); this.range = readPriceRange(); this.version++; });
          });
        }
      },
      state() {
        if (useSdk && typeof s.filters.get === 'function') {
          const st = s.filters.get();
          if (st && typeof st === 'object') return st;
        }
        return mode === 'server' ? readUrlFilters() : {};
      },
      syncFromState() {
        const st = this.state();
        const p = {};
        Object.keys(st).forEach((k) => {
          const v = st[k];
          if (Array.isArray(v)) p[k] = v.map(String);
          else if (v && typeof v === 'object' && k === 'price') {
            this.price = { min: v.min != null ? v.min : '', max: v.max != null ? v.max : '' };
          }
        });
        this.pending = p;
      },
      isOn(name, value) {
        void this.version;
        if (useSdk && typeof s.filters.has === 'function') return !!s.filters.has(name, value);
        return (this.pending[name] || []).indexOf(String(value)) > -1;
      },
      isPending(name, value) {
        return (this.pending[name] || []).indexOf(String(value)) > -1;
      },
      togglePending(name, value) {
        const list = (this.pending[name] || []).slice();
        const i = list.indexOf(String(value));
        if (i > -1) list.splice(i, 1); else list.push(String(value));
        this.pending = Object.assign({}, this.pending, { [name]: list });
      },
      get priceActive() {
        return this.range.min !== null || this.range.max !== null;
      },
      // قيمة نطاق السعر (بالوحدة الكبرى كما في الرابط) منسّقة بعملة المتجر — للعرض فقط
      fmtPrice(v) {
        return Money.format(Money.fromMajor(v));
      },
      get activeCount() {
        void this.version;
        if (useSdk && typeof s.filters.count === 'function') return s.filters.count() || (this.priceActive ? 1 : 0);
        return Object.keys(this.pending).filter((k) => this.pending[k].length).length + (this.priceActive ? 1 : 0);
      },
      // بطاقة منتج من السيرفر ضمن النطاق؟ (وضع client فقط؛ في server السيرفر فلترها بالفعل)
      priceOk(rawPrice) {
        return mode !== 'client' || priceInRange(rawPrice, this.range);
      },
      // فلتر المتصفح بيخفي كروت وCSS بيعدّ المخفي كمان: وقتها بنعلّم الكارت الوحيد في آخر سطر بنفسنا
      syncLone(grid) {
        const on = mode === 'client' && this.priceActive;
        this.$nextTick(() => {
          grid.toggleAttribute('data-filtered', on);
          grid.querySelectorAll('.is-lone').forEach((c) => c.classList.remove('is-lone'));
          if (!on) return;
          const shown = Array.from(grid.children).filter((w) => w.style.display !== 'none');
          const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
          if (shown.length % cols === 1 && shown[shown.length - 1].firstElementChild) shown[shown.length - 1].firstElementChild.classList.add('is-lone');
        });
      },
      // عدد منتجات السيرفر الظاهرة بعد فلتر المتصفح
      get visibleCount() {
        const list = config.prices || [];
        return mode !== 'client' ? list.length : list.filter((v) => priceInRange(v, this.range)).length;
      },
      async toggle(name, value) {
        if (useSdk) { await s.filters.toggle(name, value); return; }
        if (mode !== 'server') return;
        // بدون الـ SDK: نفس الفلتر عبر رابط السيرفر (filters[name][]=) مع الإبقاء على نطاق السعر الحالي
        this.togglePending(name, value);
        window.location.href = filtersUrl(this.pending, this.range);
      },
      validPrice() {
        const min = this.price.min === '' || this.price.min === null ? null : Number(this.price.min);
        const max = this.price.max === '' || this.price.max === null ? null : Number(this.price.max);
        if ((min !== null && (isNaN(min) || min < 0)) || (max !== null && (isNaN(max) || max < 0))) {
          this.priceError = config.i18n && config.i18n.priceInvalid;
          return null;
        }
        if (min !== null && max !== null && min > max) {
          this.priceError = config.i18n && config.i18n.priceInvalid;
          return null;
        }
        this.priceError = '';
        return { min, max };
      },
      // تطبيق نطاق السعر حسب الوضع — بلا إعادة تحميل كلما أمكن
      async commitPrice(r) {
        if (mode === 'client') {
          this.range = r;
          window.history.replaceState({}, '', priceUrl(r));
          emitPrice(r);
          return;
        }
        if (useSdk) {
          // الـ SDK يفلتر بدون إعادة تحميل حيث يدعمه (مثل /shop)؛ في صفحات لا يطبّق فيها السعر لا يتغير الرابط
          // (مثل /collections/<h>) فنرجع لرابط السيرفر filters[price] الذي يطبّقه السيرفر دائماً
          const before = window.location.search;
          try {
            if (r.min === null && r.max === null) await s.filters.remove('price');
            else await s.filters.range('price', { min: r.min === null ? undefined : r.min, max: r.max === null ? undefined : r.max });
          } catch (e) { /* الرجوع للرابط */ }
          await new Promise((res) => setTimeout(res, 700));
          if (window.location.search !== before) { this.range = readPriceRange(); return; }
        }
        window.location.href = priceUrl(r); // السيرفر يفلتر من الرابط
      },
      async applyPrice() {
        const r = this.validPrice();
        if (!r) return;
        await this.commitPrice(r);
      },
      /* موبايل: تطبيق المسودة كاملة دفعة واحدة */
      async applyDrawer() {
        const r = this.validPrice();
        if (!r) return;
        if (useSdk) {
          const st = {};
          Object.keys(this.pending).forEach((k) => { if (this.pending[k].length) st[k] = this.pending[k]; });
          if (r.min !== null || r.max !== null) st.price = { min: r.min === null ? undefined : r.min, max: r.max === null ? undefined : r.max };
          if (typeof s.filters.apply === 'function') await s.filters.apply(st, { merge: false });
        } else if (mode === 'server') {
          // بدون الـ SDK: المسودة كلها (فلاتر + سعر) في رابط السيرفر دفعة واحدة
          const next = filtersUrl(this.pending, r);
          this.drawer = false;
          document.documentElement.style.overflow = '';
          if (next !== window.location.href) window.location.href = next;
          return;
        } else {
          await this.commitPrice(r);
        }
        this.drawer = false;
        document.documentElement.style.overflow = '';
      },
      openDrawer() {
        this.syncFromState();
        this.drawer = true;
        document.documentElement.style.overflow = 'hidden';
      },
      cancelDrawer() {
        this.syncFromState(); // الإلغاء لا يطبّق التغييرات (FLT-11)
        this.price = { min: this.range.min === null ? '' : this.range.min, max: this.range.max === null ? '' : this.range.max };
        this.drawer = false;
        document.documentElement.style.overflow = '';
      },
      /* مسح كامل: الحالة + الـ URL + عناصر التحكم (FLT-05) — لا يُسترجع بعد التحديث */
      async clearAll() {
        const hadServerPrice = mode === 'server' && (this.priceActive || Object.keys(readUrlFilters()).length > 0);
        this.pending = {};
        this.price = { min: '', max: '' };
        this.priceError = '';
        this.range = { min: null, max: null };
        if (useSdk && typeof s.filters.clear === 'function') await s.filters.clear();
        const u = url();
        Array.from(u.searchParams.keys()).forEach((k) => { if (KEEP_PARAMS.indexOf(k) === -1) u.searchParams.delete(k); });
        this.drawer = false;
        document.documentElement.style.overflow = '';
        this.version++;
        emitPrice(this.range);
        // سعر مطبّق على السيرفر: نعيد تحميل الرابط النظيف حتى ترجع كل المنتجات (مع الـ SDK أو بدونه)
        if (hadServerPrice) { window.location.href = u.toString(); return; }
        window.history.replaceState({}, '', u.toString());
      },
      async setSort(v) {
        this.sort = v;
        if (useSdk && typeof s.filters.sort === 'function') return s.filters.sort(v);
        const u = url();
        if (v) u.searchParams.set('sort', v); else u.searchParams.delete('sort');
        u.searchParams.delete('page');
        window.location.href = u.toString();
      }
    };
  };

  /* ---------- Pagination link helper (يحافظ على الفلاتر والبحث) ---------- */

  window.lgPageUrl = function (n) {
    const u = new URL(window.location.href);
    u.searchParams.set('page', n);
    return u.pathname + u.search;
  };

  /* ---------- Search results page ---------- */

  window.lgSearchPage = function (config) {
    config = config || {};
    const params = new URLSearchParams(window.location.search);
    const range0 = readPriceRange();
    const PAGE_SIZE = Math.max(8, parseInt(config.limit, 10) || 24);
    const priceOf = (p) => Money.toNumber((p && ((p.pricing && p.pricing.price) || p.price)) || 0);
    return {
      q: (params.get('q') || '').trim(),
      sort: params.get('sort') || '',
      minPrice: range0.min === null ? '' : range0.min,
      maxPrice: range0.max === null ? '' : range0.max,
      all: [],          // كل النتائج بعد الفلترة والترتيب
      shown: PAGE_SIZE, // "عرض المزيد"
      corrected: null,  // "هل تقصد؟"
      loading: false,
      error: false,
      priceError: '',
      get results() {
        return this.all.slice(0, this.shown);
      },
      async init() {
        if (this.q) await this.fetch();
      },
      // البحث الذكي في الكتالوج + فلتر السعر + الترتيب — كله في المتصفح بلا إعادة تحميل
      async fetch() {
        const min = this.minPrice === '' ? null : Number(this.minPrice);
        const max = this.maxPrice === '' ? null : Number(this.maxPrice);
        if ((min !== null && (isNaN(min) || min < 0)) || (max !== null && (isNaN(max) || max < 0)) || (min !== null && max !== null && min > max)) {
          this.priceError = config.i18n && config.i18n.priceInvalid;
          return;
        }
        this.priceError = '';
        this.q = (this.q || '').trim();
        this.shown = PAGE_SIZE;
        if (!this.q) { this.all = []; this.corrected = null; this.syncUrl(); return; }
        this.loading = true;
        this.error = false;
        try {
          const r = await SmartSearch.search(this.q);
          let list = r.items.filter((p) => priceInRange(p, { min, max }));
          if (this.sort === 'price-asc') list = list.slice().sort((a, b) => priceOf(a) - priceOf(b));
          else if (this.sort === 'price-desc') list = list.slice().sort((a, b) => priceOf(b) - priceOf(a));
          else if (this.sort === 'rating-desc') list = list.slice().sort((a, b) => (Number(b.averageRating) || 0) - (Number(a.averageRating) || 0));
          else if (this.sort === 'created-desc') list = list.slice().sort((a, b) => SmartSearch.order(a) - SmartSearch.order(b));
          this.all = list;
          this.corrected = r.corrected;
          // حفظ في "آخر عمليات البحث" (نفس قائمة نافذة البحث)
          const root = document.body && document.body._x_dataStack && document.body._x_dataStack[0];
          if (root && typeof root.rememberSearch === 'function') root.rememberSearch(this.q);
        } catch (e) {
          this.all = [];
          this.error = true;
        } finally {
          this.loading = false;
        }
        this.syncUrl();
      },
      syncUrl() {
        const url = new URL(window.location.href);
        [PRICE_MIN, PRICE_MAX, 'minPrice', 'maxPrice'].forEach((k) => url.searchParams.delete(k));
        if (this.q) url.searchParams.set('q', this.q); else url.searchParams.delete('q');
        if (this.sort) url.searchParams.set('sort', this.sort); else url.searchParams.delete('sort');
        if (this.minPrice !== '') url.searchParams.set(PRICE_MIN, this.minPrice);
        if (this.maxPrice !== '') url.searchParams.set(PRICE_MAX, this.maxPrice);
        window.history.replaceState({}, '', url.toString());
      },
      // "هل تقصد؟" ← البحث بالكلمة المصححة
      useCorrected() {
        if (!this.corrected) return;
        this.q = this.corrected;
        this.fetch();
      },
      more() {
        this.shown += PAGE_SIZE;
      },
      clearFilters() {
        this.sort = '';
        this.minPrice = '';
        this.maxPrice = '';
        this.fetch();
      }
    };
  };

  /* ---------- تلميحات للتاجر في المعاينة فقط ---------- */

  window.lgEditorOnly = function () {
    return { show: isPreview() };
  };

  /* ---------- Countdown ---------- */

  window.lgCountdown = function (endsAt) {
    return {
      d: '00', h: '00', m: '00', s: '00',
      done: false,
      timer: null,
      init() {
        const end = new Date(endsAt).getTime();
        if (isNaN(end)) { this.done = true; return; }
        const pad = (n) => String(n).padStart(2, '0');
        const tick = () => {
          const diff = Math.max(0, end - Date.now());
          this.d = pad(Math.floor(diff / 86400000));
          this.h = pad(Math.floor((diff % 86400000) / 3600000));
          this.m = pad(Math.floor((diff % 3600000) / 60000));
          this.s = pad(Math.floor((diff % 60000) / 1000));
          if (diff <= 0) { this.done = true; clearInterval(this.timer); }
        };
        tick();
        this.timer = setInterval(tick, 1000);
      },
      destroy() { clearInterval(this.timer); }
    };
  };

  /* ---------- Sliders (auto-init via data-lg-swiper) ---------- */

  async function initSliders(root) {
    // المخفي لا يُهيّأ (مثل الرئيسية خلف الصفحات التوضيحية): Swiper يحسب الشرائح خطأ وهو بلا مقاس ويطبع Loop Warning
    const pending = () => Array.from((root || document).querySelectorAll('[data-lg-swiper]:not(.swiper-initialized)'))
      .filter((el) => el.getClientRects().length > 0);
    if (!pending().length) return;
    try { await loadLib('swiper'); } catch (e) { return; }
    pending().forEach((el) => {
      let cfg = {};
      try { cfg = JSON.parse(el.getAttribute('data-lg-swiper') || '{}'); } catch (e) { cfg = {}; }
      const scope = el.closest('[data-lg-slider-scope]') || el;
      const next = scope.querySelector('[data-lg-next]');
      const prev = scope.querySelector('[data-lg-prev]');
      const pag = scope.querySelector('[data-lg-pagination]') || el.querySelector('.swiper-pagination');
      const options = Object.assign({ spaceBetween: 14, slidesPerView: 1.2, watchOverflow: true, grabCursor: true }, cfg);
      if (next && prev) options.navigation = { nextEl: next, prevEl: prev };
      if (pag) options.pagination = { el: pag, clickable: true };
      if (cfg.autoplayMs && !NO_MOTION) {
        options.autoplay = { delay: cfg.autoplayMs, disableOnInteraction: false, pauseOnMouseEnter: true };
      }
      delete options.autoplayMs;
      new Swiper(el, options);
    });
  }

  /* ---------- Navbar cursor lens: فقاعة زجاجية تتبع المؤشر بنعومة ---------- */

  function initCursorLens() {
    if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const reduce = NO_MOTION || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll(".lg-header__bar").forEach((bar) => {
      const lens = bar.querySelector(".lg-cursor-lens");
      if (!lens) return;
      let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, inside = false, first = true;

      const render = () => {
        const k = reduce ? 1 : 0.18; // معامل النعومة
        const px = cx;
        cx += (tx - cx) * k;
        cy += (ty - cy) * k;
        const v = cx - px;
        // تمدد في اتجاه الحركة ثم يعود دائرياً عند التوقف
        const sx = 1 + Math.min(Math.abs(v) / 40, 0.3);
        const sy = 1 - Math.min(Math.abs(v) / 90, 0.14);
        lens.style.transform = "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0) scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")";
        if (inside || Math.abs(tx - cx) > 0.3 || Math.abs(v) > 0.05) raf = requestAnimationFrame(render);
        else raf = 0;
      };
      const start = () => { if (!raf) raf = requestAnimationFrame(render); };

      bar.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return;
        const r = bar.getBoundingClientRect();
        tx = e.clientX - r.left;
        ty = r.height / 2 + (e.clientY - r.top - r.height / 2) * 0.4; // يبقى قريباً من منتصف الشريط ليملأه
        if (first) { cx = tx; cy = ty; first = false; }
        start();
      }, { passive: true });
      bar.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        inside = true;
        first = true;
        lens.classList.add("is-on");
      });
      bar.addEventListener("pointerleave", () => {
        inside = false;
        lens.classList.remove("is-on");
      });
    });
  }

  /* ---------- حركات macOS: Genie للسلة + قفزة الـ Dock + تكبير الـ Dock ---------- */

  const reducedMotion = () => NO_MOTION || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // آخر عنصر ضغطه الزائر — مصدر صورة الـ Genie (البطاقة، أو صفحة المنتج [data-fly-scope])
  let lastPress = { el: null, t: 0 };
  document.addEventListener('pointerdown', (e) => { lastPress = { el: e.target, t: Date.now() }; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') lastPress = { el: e.target, t: Date.now() }; }, true);

  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(el).visibility !== 'hidden';
  };

  // يرجع Promise تنتهي بعد هبوط الصورة على زر السلة (فوراً إن لم تكن هناك حركة).
  // reveal(): يُظهر الهيدر إن كان مخفياً بالتمرير ويرجع true — مثل ظهور الـ Dock — فننتظر نزوله قبل قياس الهدف
  async function genieToCart(reveal) {
    const scope = lastPress.el && Date.now() - lastPress.t < 4000 && lastPress.el.closest && lastPress.el.closest('.lg-card, .lg-mini, [data-fly-scope]');
    const img = scope && [...scope.querySelectorAll('img')].find(onScreen);
    if (reveal && reveal()) await new Promise((r) => setTimeout(r, 420));
    const target = [...document.querySelectorAll('.lg-hbtn--cart')].find(onScreen);
    if (!target) return false;
    const bounce = () => {
      target.classList.remove('lg-dock-bounce');
      void target.offsetWidth; // إعادة تشغيل الحركة
      target.classList.add('lg-dock-bounce');
      setTimeout(() => target.classList.remove('lg-dock-bounce'), 900);
    };
    if (reducedMotion() || !img || !img.animate) { if (!reducedMotion()) bounce(); return false; }
    const a = img.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const clone = document.createElement('img');
    clone.src = img.currentSrc || img.src;
    clone.alt = '';
    clone.className = 'lg-genie';
    Object.assign(clone.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
    document.body.appendChild(clone);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const s = Math.min(1, b.width / Math.max(a.width, 1));
    // ترتفع قليلاً، ثم تضيق أفقياً أسرع من الطول وهي تُسحب (إحساس الـ Genie)، ثم تختفي داخل الزر
    const anim = clone.animate([
      { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
      { transform: 'translate(' + dx * 0.12 + 'px, ' + (dy * 0.05 - 36) + 'px) scale(.84, .92)', opacity: 1, offset: 0.28 },
      { transform: 'translate(' + dx * 0.7 + 'px, ' + dy * 0.62 + 'px) scale(' + Math.max(s * 1.6, 0.16) + ', ' + Math.max(s * 2.6, 0.3) + ')', opacity: 0.95, offset: 0.74 },
      { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s * 0.5 + ')', opacity: 0.1 }
    ], { duration: 700, easing: 'cubic-bezier(.45, .05, .55, .95)', fill: 'forwards' });
    return new Promise((resolve) => {
      const done = () => { clone.remove(); bounce(); setTimeout(() => resolve(true), 260); };
      anim.onfinish = done;
      anim.oncancel = done;
      setTimeout(() => { if (clone.isConnected) done(); }, 1400); // احتياط لو توقفت الحركة (تبويب في الخلفية)
    });
  }

  // تكبير الـ Dock: [data-dock] (أزرار الهيدر، أيقونات التواصل في الفوتر) — ماوس فقط
  function initDock() {
    if (reducedMotion() || !window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelectorAll('[data-dock]').forEach((dock) => {
      const max = dock.getAttribute('data-dock') === 'bottom' ? 0.42 : 0.22;
      let frame = 0;
      let x = 0;
      const apply = () => {
        frame = 0;
        [...dock.children].forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width) return;
          const d = Math.abs(x - (r.left + r.width / 2));
          el.style.setProperty('--dock', (1 + max * Math.max(0, 1 - d / 110)).toFixed(3));
        });
      };
      dock.addEventListener('pointermove', (e) => { x = e.clientX; if (!frame) frame = requestAnimationFrame(apply); });
      dock.addEventListener('pointerleave', () => {
        cancelAnimationFrame(frame);
        frame = 0;
        [...dock.children].forEach((el) => el.style.removeProperty('--dock'));
      });
    });
  }

  /* ---------- Rails: كاروسيل CSS scroll-snap + أزرار (بدون مكتبة) ---------- */

  function initRails() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-lg-rail-prev], [data-lg-rail-next]');
      if (!btn) return;
      const scope = btn.closest('[data-lg-slider-scope]');
      const rail = scope && scope.querySelector('.lg-rail');
      if (!rail) return;
      const rtl = getComputedStyle(rail).direction === 'rtl';
      const dir = btn.hasAttribute('data-lg-rail-next') ? 1 : -1;
      rail.scrollBy({ left: dir * (rtl ? -1 : 1) * rail.clientWidth * 0.9, behavior: 'smooth' });
    });
  }

  /* ---------- Liquid glass: لمعان يتبع المؤشر ---------- */

  function initGlassSheen() {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (NO_MOTION || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last = null;
    document.addEventListener('pointermove', (e) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = last.target && last.target.closest && last.target.closest('.glass-hover, .lg-header__bar');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((last.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((last.clientY - r.top) / r.height * 100).toFixed(1) + '%');
        // إمالة ثلاثية الأبعاد خفيفة لبطاقات المنتجات (حد أقصى 5 درجات)
        if (el.classList.contains('lg-card')) {
          const px = (last.clientX - r.left) / r.width - 0.5;
          const py = (last.clientY - r.top) / r.height - 0.5;
          el.style.setProperty('--ry', (px * 8).toFixed(2) + 'deg');
          el.style.setProperty('--rx', (py * -8).toFixed(2) + 'deg');
        }
      });
    }, { passive: true });
  }

  /* ---------- الرابط النشط في الهيدر: من المسار الفعلي (قمرة لا ترسل page.url للقالب) ---------- */

  function initActiveNav() {
    const clean = (p) => {
      if (LANG_PREFIX && (p === LANG_PREFIX || p.indexOf(LANG_PREFIX + '/') === 0)) p = p.slice(LANG_PREFIX.length);
      return p.replace(/\/+$/, '') || '/';
    };
    const here = clean(window.location.pathname);
    document.querySelectorAll('.lg-nav .lg-nav-link').forEach((a) => {
      let path;
      try { path = clean(new URL(a.getAttribute('href'), window.location.origin).pathname); } catch (e) { return; }
      const on = path === here || (path === '/collections' && here.indexOf('/collections/') === 0);
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /* ---------- شريط الشراء الثابت (موبايل): ارتفاعه الفعلي في --lg-sticky-h ----------
     style.css يرفع به الأزرار العائمة والتوست ويترك مساحة أسفل الصفحة حتى لا يغطي الفوتر.
     الشريط المخفي (md:hidden على الشاشات الأكبر أو صفحة توضيحية غير معروضة) ارتفاعه 0 فلا يؤثر. */

  function initStickyBuy() {
    const root = document.documentElement;
    const seen = new Set();
    let raf = 0;
    const update = () => {
      raf = 0;
      let h = 0;
      document.querySelectorAll('.lg-sticky-buy').forEach((b) => {
        h = Math.max(h, b.offsetHeight);
        if (ro && !seen.has(b)) { seen.add(b); ro.observe(b); }
      });
      if (h) root.style.setProperty('--lg-sticky-h', h + 'px');
      else root.style.removeProperty('--lg-sticky-h');
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    const ro = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null;
    if (!ro) window.addEventListener('resize', schedule, { passive: true });
    // الصفحة التوضيحية ترسم شريطها لاحقاً (x-if) — نلتقطه عند إضافته
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    update();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initActiveNav();
    initStickyBuy();
    initGlassSheen();
    initCursorLens();
    initRails();
    initDock();
    initSliders();
    const s = sdk();
    if (s && typeof s.on === 'function') {
      s.on('section:rendered', () => {
        initSliders();
        initLightbox();
      });
    }
  });

  window.LiquidGlass = { Store, Money, SmartSearch, initSliders, stockState, discountPercent, LOW_STOCK_THRESHOLD, isPreview };
})();
