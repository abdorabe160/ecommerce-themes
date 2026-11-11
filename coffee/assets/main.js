/*!
 * DECAFE — storefront runtime for Qumra Cloud.
 *
 * Contract (used by layout, widgets and ui partials):
 *   <body x-data="decafeApp()">           root scope: cart, wishlist, modals, toasts, money, search suggestions
 *   x-data="dcProduct({...})"             product page (variants, quantity, gallery, add / buy now)
 *   x-data="dcCollection({...})"          collection listing: server results + client facets (origin/roast/grind/weight/stock/price)
 *   x-data="dcSearchPage({...})"          /search results via /ajax/search/products
 *   x-data="dcProducts({...})"            product rails: picked products, else live store query, else preview demo
 *   x-data="dcNewsletter({...})"          newsletter form
 *   x-data="dcContact({...})"             contact form
 *   window.CartManager / WishlistManager / SearchManager / ProductManager   documented facades
 *   [data-reveal]                          scroll reveal (respects reduced motion)
 *   [data-lang-switch="ar|en"]             language switch (cookie based)
 *   [data-currency-switch="SAR"]           currency switch (cookie based)
 *   time[data-date]                        localised dates
 *
 * Every platform call goes through Store: optional platform SDK (window.qumra) first, documented /ajax endpoints otherwise.
 */
(function () {
  'use strict';

  const THEME = window.__decafe || {};
  const I18N = THEME.i18n || {};
  const doc = document;
  const root = doc.documentElement;

  /* ───────────── utilities ───────────── */

  const sdk = () => (window.qumra && typeof window.qumra === 'object' ? window.qumra : null);
  const isFn = (f) => typeof f === 'function';
  const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776);
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function readJSON(id) {
    const el = doc.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent || 'null'); } catch (e) { return null; }
  }

  function pick(obj, paths) {
    for (const p of paths) {
      const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
      if (Array.isArray(v)) return v;
    }
    return [];
  }

  async function http(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || (data && data.success === false)) {
      const err = new Error((data && data.message) || I18N.error || 'Error');
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  function isPreview() {
    try {
      const l = window.location;
      if (l.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(l.hostname)) return true;
      if (/[?&](theme|theme_id|preview_theme_id|editor)=/.test(l.search)) return true;
      return window.self !== window.top;
    } catch (e) { return true; }
  }

  /** demo catalogue may fill empty product/collection sections: always in preview, and on the live store
      only when the merchant turns the `demoProducts` setting on (off by default: HOME-11 / EDGE-01) — real items always win */
  function demoAllowed() { return THEME.demoProducts === true || isPreview(); }

  const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ───────────── money (format inferred from a server-rendered `123456 | money` sample) ───────────── */

  const Money = (() => {
    const raw = String(THEME.moneySample || '');
    const arabicDigits = /[٠-٩]/.test(raw);
    const sample = toLatinDigits(raw);
    const m = sample.match(/\d[\d.,٬٫   ]*\d|\d/);
    let prefix = '', suffix = ' ' + (THEME.currency || ''), decimals = 2, divisor = 100, group = ',', decSep = '.';
    if (m) {
      prefix = sample.slice(0, m.index);
      suffix = sample.slice(m.index + m[0].length);
      const n = m[0].replace(/[   ]/g, '');
      const tail = n.match(/([.,٫])(\d+)$/);
      let value;
      if (tail && tail[2].length !== 3) {
        decSep = tail[1];
        decimals = tail[2].length;
        const intPart = n.slice(0, n.length - tail[0].length);
        const g = intPart.match(/[.,٬]/); if (g) group = g[0];
        value = Number(intPart.replace(/[^\d]/g, '') + '.' + tail[2]);
      } else {
        decimals = 0;
        const g = n.match(/[.,٬]/); if (g) group = g[0];
        value = Number(n.replace(/[^\d]/g, ''));
      }
      const guess = value ? 123456 / value : 100;
      divisor = [1, 10, 100, 1000].reduce((best, d) => (Math.abs(d - guess) < Math.abs(best - guess) ? d : best), 100);
    }
    const toArabic = (s) => s.replace(/\d/g, (d) => String.fromCharCode(1632 + Number(d)));
    function toNumber(minor) { return num(minor) / divisor; }
    function fromMajor(major) { return Math.round(num(major) * divisor); }
    function format(minor) {
      const v = toNumber(minor);
      const fixed = Math.abs(v).toFixed(decimals);
      let [i, f] = fixed.split('.');
      i = i.replace(/\B(?=(\d{3})+(?!\d))/g, group);
      let out = (v < 0 ? '-' : '') + prefix + i + (f ? decSep + f : '') + suffix;
      if (arabicDigits) out = toArabic(out);
      return out.trim();
    }
    return { format, toNumber, fromMajor, divisor };
  })();

  /* ───────────── product helpers (shared by server-rendered + JS cards) ───────────── */

  const ATTR_KEYS = {
    origin: ['origin', 'المنشأ', 'منشأ', 'بلد المنشأ', 'البلد'],
    roast: ['roast', 'التحميص', 'تحميص', 'درجة التحميص'],
    notes: ['notes', 'النكهات', 'نكهات', 'نكهة', 'الإيحاءات'],
    process: ['process', 'المعالجة', 'معالجة'],
    altitude: ['altitude', 'الارتفاع', 'ارتفاع'],
    variety: ['variety', 'السلالة', 'سلالة'],
    brew: ['brew', 'التحضير', 'طريقة التحضير'],
    weight: ['weight', 'الوزن', 'وزن'],
    badge: ['badge', 'شارة'],
  };
  const WEIGHT_OPTION = /(weight|size|الوزن|وزن|الحجم|حجم|العبوة)/i;

  function tagText(t) { return typeof t === 'string' ? t : (t && (t.name || t.displayName || t.title || t.label || t.value)) || ''; }

  /** Parse `key:value` product tags into { origin:[...], roast:[...], ... } */
  function productAttrs(p) {
    const out = {};
    ((p && p.tags) || []).forEach((t) => {
      const s = tagText(t);
      const mm = s.match(/^\s*([^:：=]+?)\s*[:：=]\s*(.+?)\s*$/);
      if (!mm) return;
      const key = mm[1].toLowerCase();
      for (const k in ATTR_KEYS) {
        if (ATTR_KEYS[k].includes(key)) { (out[k] = out[k] || []).push(mm[2]); break; }
      }
    });
    return out;
  }

  function productUrl(p) {
    if (!p) return '#';
    if (p.__demo) return '#product=' + encodeURIComponent(p._id); // preview-only: rendered in-page (no store page exists)
    const h = p.slug || p.handle;
    return h ? '/products/' + encodeURIComponent(h) : '#';
  }
  function collectionUrl(c) { const h = c && (c.handle || c.slug); return h ? '/collections/' + encodeURIComponent(h) : '/collections'; }
  function productImage(p) {
    if (!p) return '';
    const img = (p.images && p.images[0]) || p.image;
    if (!img) return '';
    return typeof img === 'string' ? img : img.fileUrl || img.url || '';
  }
  function productPrice(p) { return p ? num(p.pricing && p.pricing.price != null ? p.pricing.price : p.price) : 0; }
  function productCompare(p) { return p ? num(p.pricing && p.pricing.compareAtPrice != null ? p.pricing.compareAtPrice : p.compareAtPrice) : 0; }
  function productVariants(p) { return p && Array.isArray(p.variants) ? p.variants : []; }
  function productHasOptions(p) { return !!p && ((Array.isArray(p.options) && p.options.some((o) => o && o.values && o.values.length)) || num(p.variantsCount) > 0 || productVariants(p).length > 0); }
  function variantSold(p, v) { return v.allowBackorder !== true && (v.isAvailable === false || (p.trackQuantity === true && typeof v.quantity === 'number' && v.quantity <= 0)); }
  /** Listings usually carry no variant data, so quantity 0 alone proves nothing: «نفد» needs variants, an explicit
      isAvailable:false, or a tracked product known to have no options. Everything else is productUnknown(). */
  function productOut(p) {
    if (!p || THEME.followStock === false || p.allowBackorder === true) return false;
    const vars = productVariants(p);
    if (vars.length) return vars.every((v) => variantSold(p, v));
    if (productHasOptions(p)) return false;
    if (p.isAvailable === false) return true;
    const knownSimple = Array.isArray(p.options) || p.variantsCount === 0;
    return knownSimple && p.trackQuantity === true && typeof p.quantity === 'number' && p.quantity <= 0;
  }
  function productUnknown(p) {
    return !!p && !p.__demo && p.allowBackorder !== true && typeof p.quantity === 'number' && p.quantity <= 0 && !productHasOptions(p) && !productOut(p);
  }
  /** Arabic count grammar: منتج واحد، منتجان، 3 منتجات، 11 منتج (other languages reuse the same keys). */
  function countProducts(n) {
    n = Math.max(0, Math.floor(num(n)));
    const r = n % 100;
    const tpl = n === 1 ? I18N.countOne : n === 2 ? I18N.countTwo : r >= 3 && r <= 10 ? I18N.countFew : I18N.countMany;
    return String(tpl || '{count}').replace('{count}', n);
  }
  function productLow(p) {
    if (!p || THEME.followStock === false || p.trackQuantity !== true || p.allowBackorder === true) return false;
    return typeof p.quantity === 'number' && p.quantity > 0 && p.quantity <= num(THEME.lowStock, 3);
  }
  function discountOf(p) { const pr = productPrice(p), c = productCompare(p); return c > pr && c > 0 ? Math.floor(((c - pr) / c) * 100) : 0; }
  /** Small line under a card title: weight option values, else weight tag, else origin tag. */
  function cardMeta(p) {
    if (!p) return '';
    if (p.subtitle) return p.subtitle;
    const opt = (p.options || []).find((o) => o && WEIGHT_OPTION.test(o.name || o.title || ''));
    if (opt && opt.values && opt.values.length) return opt.values.map((v) => v.label || v.value || v.name).filter(Boolean).join(' · ');
    const a = productAttrs(p);
    return (a.weight && a.weight[0]) || (a.origin && a.origin[0]) || '';
  }
  function normProduct(p) {
    if (!p || typeof p !== 'object') return null;
    return p._id ? p : Object.assign({}, p, { _id: p.id });
  }
  function isListable(p) { return p && p.status !== 'draft' && p.status !== 'archived' && p.published !== false && p.isActive !== false; }

  /* ───────────── preview demo catalogue (rendered by ui/demo-data.njk, used only in preview) ───────────── */

  const Demo = {
    _data: null,
    data() {
      if (this._data) return this._data;
      const d = readJSON('dc-demo-data') || {};
      const products = (d.products || []).map((x) => ({
        _id: x.id, __demo: true, title: x.title, slug: x.id, subtitle: x.meta || '',
        images: [{ fileUrl: x.image }], imageLarge: x.large || x.image, pricing: { price: Money.fromMajor(x.price), compareAtPrice: x.compare ? Money.fromMajor(x.compare) : 0 },
        tags: x.tags || [], quantity: 50, averageRating: x.rating || 0, reviewsCount: x.reviews || 0, kind: x.kind || [],
      }));
      this._data = { products, collections: d.collections || [] };
      return this._data;
    },
    products(kind, limit) {
      const all = this.data().products;
      const list = kind ? all.filter((p) => p.kind.includes(kind)) : all;
      return (list.length ? list : all).slice(0, limit || 8);
    },
  };

  /* ───────────── platform store (SDK first, documented AJAX otherwise) ───────────── */

  function normalizeCart(res) {
    if (!res || typeof res !== 'object') return null;
    const c = res.cart && Array.isArray(res.cart.items) ? res.cart : res.data && Array.isArray(res.data.items) ? res.data : res;
    return Array.isArray(c.items) ? c : null;
  }

  const Store = {
    async cartFetch() {
      const s = sdk();
      if (s && s.cart && isFn(s.cart.fetch)) { try { const c = normalizeCart(await s.cart.fetch()); if (c) return c; } catch (e) { /* fall through */ } }
      return normalizeCart(await http('GET', '/ajax/cart'));
    },
    async cartAdd(productId, quantity, opts = {}) {
      const options = (opts.options || []).filter(Boolean);
      const s = sdk();
      if (s && s.cart && isFn(s.cart.add)) {
        const r = await s.cart.add(productId, quantity, options.length ? options : undefined);
        return normalizeCart(r) || this.cartFetch();
      }
      const body = { productId, quantity };
      if (options.length) body.options = options;          // resolves the variant server-side
      if (opts.variantId) body.variantId = opts.variantId;  // documented field
      return normalizeCart(await http('POST', '/ajax/cart/add', body)) || this.cartFetch();
    },
    async cartChange(itemId, quantity) {
      const s = sdk();
      if (s && s.cart && isFn(s.cart.update)) return normalizeCart(await s.cart.update(itemId, quantity)) || this.cartFetch();
      return normalizeCart(await http('POST', '/ajax/cart/change', { itemId, quantity })) || this.cartFetch();
    },
    async cartRemove(itemId) {
      const s = sdk();
      if (s && s.cart && isFn(s.cart.remove)) return normalizeCart(await s.cart.remove(itemId)) || this.cartFetch();
      return normalizeCart(await http('POST', '/ajax/cart/remove', { itemId })) || this.cartFetch();
    },
    async cartClear() {
      const s = sdk();
      if (s && s.cart && isFn(s.cart.clear)) return normalizeCart(await s.cart.clear()) || this.cartFetch();
      return normalizeCart(await http('POST', '/ajax/cart/clear')) || this.cartFetch();
    },
    async wishlist(action, productId) {
      const s = sdk();
      if (s && s.wishlist && isFn(s.wishlist[action])) return s.wishlist[action](productId);
      return http('POST', '/ajax/wishlist/' + action, action === 'clear' ? undefined : { productId });
    },
    async suggest(q, limit = 6) {
      const params = new URLSearchParams({ q, 'resources[type]': 'product,collection', 'resources[limit]': String(limit) });
      const res = await http('GET', '/ajax/search/suggest?' + params.toString());
      return {
        products: pick(res, ['resources.products', 'products', 'resources.results.products', 'data.products']).map(normProduct).filter(Boolean),
        collections: pick(res, ['resources.collections', 'collections', 'resources.results.collections']),
      };
    },
    /** params: { q, sort, page, limit, collectionId, min, max } — price in major units */
    async searchProducts(params = {}) {
      const qs = new URLSearchParams();
      qs.set('q', params.q || '');
      ['sort', 'page', 'limit', 'collectionId'].forEach((k) => { if (params[k]) qs.set(k, String(params[k])); });
      if (params.min != null && params.min !== '') { qs.set('filters[price][min]', params.min); qs.set('minPrice', String(Money.fromMajor(params.min))); }
      if (params.max != null && params.max !== '') { qs.set('filters[price][max]', params.max); qs.set('maxPrice', String(Money.fromMajor(params.max))); }
      let res;
      try { res = await http('GET', '/ajax/search/products?' + qs.toString()); }
      catch (e) {
        if (e.status === 500 && qs.has('limit')) { qs.delete('limit'); res = await http('GET', '/ajax/search/products?' + qs.toString()); }
        else throw e;
      }
      const pg = (res && res.pagination) || {};
      return {
        products: pick(res, ['products', 'data.products', 'data', 'items', 'results']).map(normProduct).filter(isListable),
        total: num(pg.totalItems || res.total || res.count, 0),
        hasNext: !!pg.hasNextPage,
      };
    },
    _productCache: {},
    async productByHandle(handle) {
      if (this._productCache[handle]) return this._productCache[handle];
      const res = await http('GET', '/ajax/product?handle=' + encodeURIComponent(handle));
      const p = normProduct((res && (res.product || (res.data && res.data.product) || res.data)) || res);
      this._productCache[handle] = p;
      return p;
    },
    async resolveVariant(productId, options, quantity = 1) {
      const res = await http('POST', '/ajax/product/resolve-variant-by-options', { productId, options, quantity });
      return (res && (res.variant || (res.data && res.data.variant) || res.data)) || res;
    },

  };

  /* ───────────── unknown stock on listing cards: ask /ajax/product once a card is near the screen, 2 at a time ───────────── */

  const StockCheck = {
    io: null, waiting: [], running: 0,
    add(el, slug, done) {
      el.__dcStock = { slug, done };
      if (!('IntersectionObserver' in window)) { this.enqueue(el); return; }
      this.io = this.io || new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { this.io.unobserve(e.target); this.enqueue(e.target); } });
      }, { rootMargin: '200px 0px' });
      this.io.observe(el);
    },
    enqueue(el) { this.waiting.push(el.__dcStock); this.pump(); },
    pump() {
      while (this.running < 2 && this.waiting.length) {
        const job = this.waiting.shift();
        this.running += 1;
        Store.productByHandle(job.slug)
          .then((p) => { if (p && p._id) job.done(productOut(p) ? 'out' : productHasOptions(p) ? 'options' : 'view'); })
          .catch(() => { /* stays «عرض المنتج», which is always true */ })
          .finally(() => { this.running -= 1; this.pump(); });
      }
    },
  };

  /* ───────────── scroll lock (ref-counted so stacked overlays don't fight) ───────────── */

  const ScrollLock = {
    n: 0,
    lock() { if (this.n++ === 0) { const w = window.innerWidth - root.clientWidth; root.style.overflow = 'hidden'; if (w > 0) root.style.paddingInlineEnd = w + 'px'; } },
    unlock() { if (this.n > 0 && --this.n === 0) { root.style.overflow = ''; root.style.paddingInlineEnd = ''; } },
  };

  /* ───────────── scroll reveal ───────────── */

  const Reveal = {
    io: null,
    init() {
      if (!root.classList.contains('motion-ok')) { root.classList.add('reveal-ready'); return; }
      this.io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); this.io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px 20% 0px', threshold: 0 });
      this.scan(doc);
      root.classList.add('reveal-ready');
      // theme editor re-renders sections in place: pick up new nodes
      new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && this.scan(n)))).observe(doc.body, { childList: true, subtree: true });
    },
    scan(scope) {
      if (!this.io) return;
      const nodes = scope.matches && scope.matches('[data-reveal]') ? [scope] : [];
      nodes.push(...scope.querySelectorAll('[data-reveal]:not(.is-in)'));
      nodes.forEach((el) => {
        const group = el.parentElement && el.parentElement.closest('[data-reveal-stagger]');
        if (group && !el.style.getPropertyValue('--reveal-i')) {
          const sibs = Array.from(group.querySelectorAll(':scope > [data-reveal], :scope > * > [data-reveal]'));
          el.style.setProperty('--reveal-i', Math.min(sibs.indexOf(el), 6));
        }
        this.io.observe(el);
      });
    },
  };

  /* ───────────── scroll-linked motion (only with html.motion-ok: animations setting on + no reduced motion) ─────────────
     · section headings / intros / grids get reveal + stagger automatically (widgets stay markup-light)
     · [data-parallax="0.1"] drifts against the scroll via the independent `translate` property (keeps hover transforms)
     · floating coffee beans in dark sections, a hairline reading-progress bar, hero copy easing out as you scroll */

  const BEAN_SVG = '<svg viewBox="0 0 40 56" aria-hidden="true" focusable="false"><ellipse cx="20" cy="28" rx="15" ry="24" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 6c8 8 1 15 5 23 3 7 8 10 6 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const Motion = {
    items: [],
    init() {
      if (!root.classList.contains('motion-ok')) return;
      doc.querySelectorAll('.dc-section-heading, .dc-collection-heading, .dc-journey__intro > div, .dc-newsletter__inner > div:not([data-reveal])')
        .forEach((el) => { if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', ''); });
      doc.querySelectorAll('.dc-product-grid, .dc-category-grid, .dc-journal-grid, .dc-journey__steps')
        .forEach((el) => el.setAttribute('data-reveal-stagger', ''));

      const hero = doc.querySelector('[data-hero-overlay]');
      if (hero) {
        const layer = hero.querySelector('.hero-media-in');
        if (layer && layer.parentElement && layer.parentElement.parentElement) { layer.parentElement.parentElement.setAttribute('data-parallax', '0.12'); layer.parentElement.parentElement.setAttribute('data-parallax-cap', '0.05'); }
        this.heroCopy = hero.querySelector('.hero-in');
        this.hero = hero;
      }
      doc.querySelectorAll('.dc-journey__photo img').forEach((el) => { el.setAttribute('data-parallax', '0.08'); el.setAttribute('data-parallax-cap', '0.045'); });

      doc.querySelectorAll('.dc-journey, .surface-dark.dc-newsletter').forEach((sec, si) => {
        const beans = doc.createElement('div');
        beans.className = 'dc-beans';
        beans.setAttribute('aria-hidden', 'true');
        const spots = si % 2 ? [[8, 18, .9, .22], [88, 30, .55, .3], [72, 82, .7, .14], [18, 74, .45, .26]]
                             : [[6, 12, .7, .18], [92, 22, 1, .3], [80, 70, .55, .12], [14, 86, .85, .24], [52, 6, .4, .2]];
        beans.innerHTML = spots.map(([x, y, sz, sp], i) =>
          `<span class="dc-bean" data-parallax="${sp}" style="--x:${x}%;--y:${y}%;--s:${sz};--d:${i * 1.7}s">${BEAN_SVG}</span>`).join('');
        sec.prepend(beans);
      });

      const bar = doc.createElement('div');
      bar.className = 'dc-progress';
      bar.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(bar);
      this.bar = bar;

      this.collect();
      new MutationObserver(() => this.collect()).observe(doc.body, { childList: true, subtree: true });
      let ticking = false;
      const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; this.frame(); }); } };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      this.frame();
    },
    collect() { this.items = Array.from(doc.querySelectorAll('[data-parallax]')); },
    frame() {
      const vh = window.innerHeight, y = window.scrollY;
      const max = Math.max(1, doc.documentElement.scrollHeight - vh);
      if (this.bar) this.bar.style.transform = 'scaleX(' + Math.min(1, y / max).toFixed(4) + ')';
      this.items.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        const f = parseFloat(el.getAttribute('data-parallax')) || 0;
        let t = (r.top + r.height / 2 - vh / 2) * -f;
        // oversized media (CSS `scale`) only has so much spare edge: never drift past it
        const cap = parseFloat(el.getAttribute('data-parallax-cap'));
        if (cap) { const m = el.offsetHeight * cap; t = Math.max(-m, Math.min(m, t)); }
        el.style.translate = '0 ' + t.toFixed(1) + 'px';
      });
      if (this.heroCopy && this.hero && this.hero.isConnected) {
        const h = this.hero.offsetHeight || 1, p = Math.min(1, Math.max(0, y / (h * .75)));
        this.heroCopy.style.translate = '0 ' + (p * -40).toFixed(1) + 'px';
        this.heroCopy.style.opacity = (1 - p * .85).toFixed(3);
      }
    },
  };

  /* ───────────── language switch (Qumra resolves language from the `lang` cookie) ───────────── */

  function pathWithoutLang(p) { return p.replace(/^\/(ar|en)(?=\/|$)/, '').replace(/^\/(ar|en)(?=\/|$)/, '') || '/'; }
  function switchLanguage(lang) {
    if (!/^(ar|en)$/.test(lang)) return;
    const host = location.hostname;
    const parts = host.split('.');
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push('; domain=.' + parts.slice(i).join('.'));
    domains.forEach((d) => { doc.cookie = 'lang=; path=/; max-age=0' + d; });
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    let inFrame = false; try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
    if (inFrame && secure) doc.cookie = 'lang=' + lang + '; path=/; max-age=31536000; SameSite=None; Secure; Partitioned';
    doc.cookie = 'lang=' + lang + '; path=/; max-age=31536000; SameSite=Lax' + secure;
    const path = pathWithoutLang(location.pathname) + location.search + location.hash;
    if (!/(?:^|;\s*)lang=/.test(doc.cookie)) { location.assign('/' + lang + path); return; }
    try { sessionStorage.setItem('dc-lang-pending', lang); } catch (e) { /* ignore */ }
    if (path !== location.pathname + location.search + location.hash) location.replace(path); else location.reload();
  }
  doc.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-lang-switch]');
    if (!btn) return;
    e.preventDefault();
    btn.setAttribute('aria-busy', 'true');
    switchLanguage(btn.getAttribute('data-lang-switch'));
  });

  /* ───────────── currency switch (Qumra resolves currency from the `currency` cookie) ───────────── */

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-currency-switch]');
    if (!btn) return;
    e.preventDefault();
    const code = String(btn.getAttribute('data-currency-switch') || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return;
    btn.setAttribute('aria-busy', 'true');
    const parts = location.hostname.split('.');
    const domains = [''];
    for (let i = 0; i < parts.length - 1; i++) domains.push('; domain=.' + parts.slice(i).join('.'));
    domains.forEach((d) => { doc.cookie = 'currency=; path=/; max-age=0' + d; });
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    doc.cookie = 'currency=' + code + '; path=/; max-age=31536000; SameSite=Lax' + secure;
    location.reload();
  });

  /**
   * The header ships a hidden #dc-currency placeholder carrying the merchant's comma-separated list
   * (widget `currencies`) plus whatever `localization.availableCurrencies` exposes. Buttons mount only
   * with ≥2 codes: a single-currency store renders nothing, because a switcher without a target is a lie.
   */
  function mountCurrencySwitch() {
    const hosts = doc.querySelectorAll('[data-currency-host]');
    if (!hosts.length) return;
    const seed = hosts[0].dataset;
    const codes = Array.from(new Set([seed.currencies || '', seed.platform || ''].join(',')
      .split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s))));
    if (codes.length < 2) return;
    const current = (seed.current || '').toUpperCase();
    const label = I18N.currencySwitch || 'Currency: {code}';
    const html = codes.filter((c) => c !== current).map((c) =>
      '<button type="button" data-currency-switch="' + c + '" lang="en" dir="ltr" aria-label="' +
      esc(label.replace('{code}', c)) + '" class="dc-currency-btn">' + c + '</button>').join('');
    hosts.forEach((host) => { host.innerHTML = html; host.hidden = false; });
  }

  /* ───────────── merchant line breaks ───────────── */

  /**
   * Theme-editor copy stores intended line breaks as a literal `\n` (two characters), which no
   * template filter can safely match. Turn them into real <br> elements in headline blocks.
   */
  function normaliseLineBreaks(scope) {
    const SEL = '.h-display, .h-section, .dc-section-heading__title, .dc-product-title';
    (scope || doc).querySelectorAll(SEL).forEach((el) => {
      if (el.hasAttribute('data-nl-done')) return;
      el.setAttribute('data-nl-done', '');
      const walk = (node) => {
        Array.prototype.slice.call(node.childNodes).forEach((n) => {
          if (n.nodeType === 3 && n.nodeValue.indexOf('\\n') !== -1) {
            const frag = doc.createDocumentFragment();
            n.nodeValue.split('\\n').forEach((part, i) => {
              if (i) frag.appendChild(doc.createElement('br'));
              const text = part.trim();
              if (text) frag.appendChild(doc.createTextNode(text));
            });
            n.parentNode.replaceChild(frag, n);
          } else if (n.nodeType === 1 && n.tagName !== 'BR') {
            walk(n);
          }
        });
      };
      walk(el);
    });
  }

  /* ───────────── dates ───────────── */

  function localiseDates(scope) {
    const lang = root.lang || 'ar';
    (scope || doc).querySelectorAll('time[data-date]:not([data-date-done])').forEach((el) => {
      const dt = new Date(el.getAttribute('datetime'));
      if (isNaN(dt)) return;
      try { el.textContent = dt.toLocaleDateString(lang === 'ar' ? 'ar-EG' : lang, { year: 'numeric', month: 'long', day: 'numeric' }); el.setAttribute('data-date-done', ''); } catch (e) { /* ignore */ }
    });
  }

  /* ═════════════ root component ═════════════ */

  window.decafeApp = function () {
    // preview-only demo cart survives reloads so «add to cart» stays clickable on an empty store
    const savedDemo = (() => { try { const s = JSON.parse(localStorage.getItem('dc-demo-cart') || 'null'); return s && s.__demo && Array.isArray(s.items) && s.items.length ? s : null; } catch (e) { return null; } })();
    const initialCart = savedDemo || normalizeCart(readJSON('dc-initial-cart')) || { items: [], totalQuantity: 0, totalPrice: 0 };
    const wl = readJSON('dc-initial-wishlist') || {};
    const wishIds = pick(wl, ['products', 'data.products']).map((p) => p && (p._id || p.id)).concat(wl.productIds || []).filter(Boolean);

    return {
      i18n: I18N,
      modal: null,
      _lastFocus: null,
      cart: initialCart,
      wishlist: Array.from(new Set(wishIds.map(String))),
      busy: {},
      toasts: [],
      scrolled: false,
      video: { src: '', title: '' },
      search: { q: '', loading: false, done: false, products: [], collections: [], active: -1 },

      init() {
        const onScroll = () => { this.scrolled = window.scrollY > 24; };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('hashchange', () => this.syncDemoProduct());
        this.$nextTick(() => this.syncDemoProduct());
        doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') this.refreshCart(); });
        window.addEventListener('pageshow', (e) => { if (e.persisted) { this.busy = {}; this.refreshCart(); } });
        doc.addEventListener('keydown', (e) => {
          if (e.key === '/' && !this.modal && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) && !e.target.isContentEditable) { e.preventDefault(); this.openModal('search'); }
        });
        // platform runtime (window.qumra) emits { event, data: { cart } } — keep in sync with carts changed outside the theme
        const s = sdk();
        if (s && isFn(s.on)) {
          ['cart:added', 'cart:updated', 'cart:removed', 'cart:cleared'].forEach((ev) => {
            try { s.on(ev, (e) => { const d = e && e.data; const c = normalizeCart((d && d.cart) || d); if (c && c !== this.cart) this.setCart(c, false); }); } catch (err) { /* ignore */ }
          });
        }
        try {
          const pending = sessionStorage.getItem('dc-lang-pending');
          if (pending) { sessionStorage.removeItem('dc-lang-pending'); if (root.lang !== pending) this.notify(I18N.langFailed, 'error'); }
        } catch (e) { /* ignore */ }
        Motion.init();
        Reveal.init();
        localiseDates();
      },

      /* modals: 'cart' | 'search' | 'nav' | 'filters' | 'video' */
      openModal(name) {
        if (this.modal === name) return;
        if (!this.modal) { this._lastFocus = doc.activeElement; ScrollLock.lock(); }
        this.modal = name;
        this.$nextTick(() => {
          const panel = doc.querySelector('[data-modal="' + name + '"]');
          if (!panel) return;
          const target = panel.querySelector('[data-autofocus]') || panel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
          if (target) target.focus({ preventScroll: true });
        });
      },
      closeModal() {
        if (!this.modal) return;
        if (this.modal === 'video') this.video = { src: '', title: '' };
        this.modal = null;
        ScrollLock.unlock();
        const f = this._lastFocus; this._lastFocus = null;
        if (f && isFn(f.focus)) this.$nextTick(() => f.focus({ preventScroll: true }));
      },
      toggleModal(name) { if (this.modal === name) this.closeModal(); else this.openModal(name); },
      isOpen(name) { return this.modal === name; },
      /** keep Tab inside the open dialog */
      /** GEN-09: nudge a header dropdown back inside the viewport (16px gutter) */
      fitDropdown(el) {
        if (!el) return;
        el.style.translate = '';
        const r = el.getBoundingClientRect(), vw = doc.documentElement.clientWidth, g = 16;
        const shift = r.right > vw - g ? vw - g - r.right : r.left < g ? g - r.left : 0;
        if (shift) el.style.translate = shift + 'px 0';
      },
      trapFocus(e) {
        if (e.key !== 'Tab') return;
        const panel = e.currentTarget;
        const f = Array.from(panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      },
      openVideo(src, title) {
        if (!src) return;
        let url = String(src);
        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
        const vm = url.match(/vimeo\.com\/(\d+)/);
        if (yt) url = 'https://www.youtube-nocookie.com/embed/' + yt[1] + '?autoplay=1&rel=0';
        else if (vm) url = 'https://player.vimeo.com/video/' + vm[1] + '?autoplay=1';
        this.video = { src: url, title: title || '', file: !yt && !vm };
        this.openModal('video');
      },

      /* toasts */
      demoNotice() { this.notify(I18N.demoProduct); },
      /**
       * Preview-only product page for demo items: `#product=demo-…` mounts the inert #dc-demo-product-tpl
       * (ui/demo-data.njk) filled with that product in place of the page's sections; clearing the hash restores them.
       */
      syncDemoProduct() {
        const main = doc.getElementById('main');
        if (!main || !window.Alpine) return;
        const mounted = main.querySelector(':scope > [data-demo-page]');
        if (mounted) {
          window.Alpine.mutateDom(() => mounted.remove());
          main.querySelectorAll(':scope > [data-demo-hid]').forEach((c) => { c.classList.remove('dc-is-hidden'); c.removeAttribute('data-demo-hid'); });
          doc.querySelectorAll('[data-hero-overlay-off]').forEach((h) => { h.removeAttribute('data-hero-overlay-off'); h.setAttribute('data-hero-overlay', ''); });
        }
        const m = /^#product=(demo-[\w-]+)$/.exec(decodeURIComponent(window.location.hash || ''));
        if (!m || !demoAllowed()) { if (this._docTitle) { doc.title = this._docTitle; this._docTitle = ''; } return; }
        const p = Demo.data().products.find((x) => x._id === m[1]);
        const tpl = doc.getElementById('dc-demo-product-tpl');
        if (!p || !tpl) { this.demoNotice(); return; }
        const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
        const html = tpl.innerHTML.split('__DC_TITLE__').join(esc(p.title)).split('__DC_META__').join(esc(p.subtitle))
          .split('__DC_IMG__').join(esc(p.imageLarge || productImage(p))).split('__DC_ID__').join(esc(p._id));
        const wrap = doc.createElement('div');
        wrap.setAttribute('data-demo-page', '');
        wrap.innerHTML = html;
        const view = wrap.querySelector('[data-product-view]');
        if (view) view.setAttribute('x-data', 'dcProduct(' + JSON.stringify({ product: p }) + ')');
        const demoTitle = wrap.querySelector('h2.dc-product-title');
        if (demoTitle) { const h1 = doc.createElement('h1'); h1.className = demoTitle.className; h1.innerHTML = demoTitle.innerHTML; demoTitle.replaceWith(h1); }
        Array.from(main.children).forEach((c) => { if (!c.classList.contains('dc-is-hidden')) { c.classList.add('dc-is-hidden'); c.setAttribute('data-demo-hid', ''); } });
        // a hidden hero would still make the header transparent (body:has([data-hero-overlay]))
        doc.querySelectorAll('[data-hero-overlay]').forEach((h) => { h.removeAttribute('data-hero-overlay'); h.setAttribute('data-hero-overlay-off', ''); });
        window.Alpine.mutateDom(() => main.appendChild(wrap));
        window.Alpine.initTree(wrap);
        if (this.modal) this.closeModal();
        window.scrollTo({ top: 0, behavior: 'auto' });
        if (!this._docTitle) this._docTitle = doc.title;
        doc.title = p.title;
      },
      notify(message, type = 'success') {
        if (!message) return;
        const id = Date.now() + Math.random();
        this.toasts.push({ id, message, type });
        setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 3600);
      },
      dismissToast(id) { this.toasts = this.toasts.filter((t) => t.id !== id); },

      isBusy(key) { return !!this.busy[key]; },
      async run(key, fn) {
        if (this.busy[key]) return null;
        this.busy = Object.assign({}, this.busy, { [key]: true });
        try { return await fn(); }
        catch (e) { this.notify((e && e.message) || I18N.error, 'error'); return null; }
        finally { const b = Object.assign({}, this.busy); delete b[key]; this.busy = b; }
      },

      /* money + product helpers exposed to templates */
      formatMoney(minor) { return Money.format(minor); },
      cardButtons: THEME.cardButtons !== false,
      productUrl, collectionUrl, productImage, productPrice, productCompare, productHasOptions, productOut, productUnknown, productLow, discountOf, cardMeta, productAttrs, countProducts,

      /* listing cards with unknown stock (see StockCheck) */
      stockStates: {},
      watchStock(el, id, slug) {
        if (!slug || !id || this.stockStates[id]) return;
        StockCheck.add(el, slug, (state) => { this.stockStates = Object.assign({}, this.stockStates, { [id]: state }); });
      },
      cardState(id) { return this.stockStates[id] || ''; },
      cardOut(p) { return productOut(p) || (!!p && THEME.followStock !== false && this.stockStates[p._id] === 'out'); },
      /** add from a card: listings don't say whether a product has options, and the platform answers 400 when it does → show the options */
      async cardAdd(id, slug, url, buy) {
        if (String(id).startsWith('demo-')) return buy ? this.buyNow(id, 1) : this.addToCart(id, 1);
        const key = 'add:' + id;
        if (this.busy[key]) return false;
        this.busy = Object.assign({}, this.busy, { [key]: true });
        let cart = null;
        try { cart = await Store.cartAdd(id, 1); } catch (e) { cart = null; }
        const b = Object.assign({}, this.busy); delete b[key]; this.busy = b;
        if (!cart) { await this.quickView(slug, url); return false; }
        this.setCart(cart);
        if (buy) { this.checkout(); return true; }
        if (THEME.cartOpenOnAdd !== false) this.openModal('cart'); else this.notify(I18N.added);
        return true;
      },

      /* ── cart ── */
      setCart(c, announce = true) {
        if (!c) return;
        this.cart = c;
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: c }));
        if (announce) this.$nextTick(() => { const live = doc.getElementById('dc-cart-live'); if (live) live.textContent = ''; });
      },
      get cartItems() { return (this.cart && this.cart.items) || []; },
      get cartCount() { return this.cart && this.cart.totalQuantity != null ? num(this.cart.totalQuantity) : this.cartItems.reduce((s, i) => s + num(i.quantity), 0); },
      get cartSubtotal() { return this.cartItems.reduce((s, i) => s + (i.totalPrice != null ? num(i.totalPrice) : num(i.price) * num(i.quantity)), 0); },
      get cartTotal() { return this.cart && this.cart.totalPrice != null ? num(this.cart.totalPrice) : this.cartSubtotal; },
      get cartSavings() { return num(this.cart && this.cart.totalSavings); },
      itemData(item) { return (item && (item.productData || item.product)) || {}; },
      itemTitle(item) { return this.itemData(item).title || ''; },
      itemImage(item) { const d = this.itemData(item); return (d.image && (d.image.fileUrl || d.image.url)) || (typeof d.image === 'string' ? d.image : '') || productImage(d); },
      itemUrl(item) { const d = this.itemData(item); const h = d.slug || d.handle; return h ? '/products/' + encodeURIComponent(h) : '#'; },
      itemOptions(item) {
        const opts = (item && (item.options || item.selectedOptions || (item.variant && item.variant.options) || (item.variantData && item.variantData.options))) || [];
        return opts.map((o) => (typeof o === 'string' ? o : o && (o.label || o.value || o.name))).filter(Boolean).join(' · ');
      },
      itemLineTotal(item) { return item.totalPrice != null ? num(item.totalPrice) : num(item.price) * num(item.quantity); },
      inCartQty(productId, variantId) {
        return this.cartItems.filter((i) => i.productId === productId && (!variantId || i.variantId === variantId)).reduce((s, i) => s + num(i.quantity), 0);
      },

      /* ── preview-only demo cart (real platform cart stays untouched) ── */
      demoFind(id) { return (Demo.data().products || []).find((x) => x._id === id) || null; },
      demoItem(p, qty) {
        const price = productPrice(p);
        return { _id: 'demo-' + p._id, productId: p._id, quantity: qty, price, totalPrice: price * qty,
                 compareAtPrice: productCompare(p), productData: { title: p.title, image: productImage(p) } };
      },
      demoCart(items) {
        const totalQuantity = items.reduce((s, i) => s + num(i.quantity), 0);
        const totalPrice = items.reduce((s, i) => s + num(i.totalPrice), 0);
        return { items, totalQuantity, totalPrice, __demo: true };
      },
      persistDemoCart() {
        try { if (this.cart && this.cart.__demo) localStorage.setItem('dc-demo-cart', JSON.stringify(this.cart)); else localStorage.removeItem('dc-demo-cart'); } catch (e) { /* private mode */ }
      },
      demoAdd(productId, quantity = 1, opts = {}) {
        const p = this.demoFind(productId);
        if (!p) { this.notify(I18N.demoCheckout, 'error'); return false; }
        const qty = Math.max(1, num(quantity, 1));
        const id = 'demo-' + productId;
        let seen = false;
        const items = this.cartItems.map((i) => {
          if (i._id !== id) return i;
          seen = true;
          const q = num(i.quantity) + qty;
          return Object.assign({}, i, { quantity: q, totalPrice: num(i.price) * q });
        });
        if (!seen) items.push(this.demoItem(p, qty));
        this.setCart(this.demoCart(items));
        this.persistDemoCart();
        if (opts.silent) return true;
        if (THEME.cartOpenOnAdd !== false) this.openModal('cart'); else this.notify(I18N.added);
        return true;
      },
      demoChange(item, qty) {
        qty = Math.floor(num(qty));
        const items = qty < 1
          ? this.cartItems.filter((i) => i._id !== item._id)
          : this.cartItems.map((i) => (i._id === item._id ? Object.assign({}, i, { quantity: qty, totalPrice: num(i.price) * qty }) : i));
        this.setCart(this.demoCart(items));
        this.persistDemoCart();
        if (qty < 1) this.notify(I18N.removed);
      },

      /**
       * Add to cart. opts: { options: [optionValueIds], variantId, silent }
       * Returns true on success. Opens the drawer (theme setting) and announces via toast.
       */
      async addToCart(productId, quantity = 1, opts = {}) {
        if (!productId) return false;
        if (String(productId).startsWith('demo-')) return this.demoAdd(productId, quantity, opts);
        const c = await this.run('add:' + productId, () => Store.cartAdd(productId, Math.max(1, num(quantity, 1)), opts));
        if (!c) return false;
        this.setCart(c);
        if (opts.silent) return true;
        if (THEME.cartOpenOnAdd !== false) this.openModal('cart'); else this.notify(I18N.added);
        return true;
      },
      /**
       * Quick view for products with options (weight / grind): renders only the `quick-view` widget for the
       * product (`/products/<slug>?widgetKey=quick-view`) into the quick drawer. Falls back to the product page.
       */
      async quickView(slug, url) {
        const fallback = () => { if (url && url !== '#') window.location.href = url; };
        if (!slug) return fallback();
        if (String(slug).startsWith('demo-')) { window.location.hash = 'product=' + slug; return; }
        const html = await this.run('qv:' + slug, async () => {
          const r = await fetch('/products/' + encodeURIComponent(slug) + '?widgetKey=quick-view', { credentials: 'same-origin', headers: { Accept: 'text/html' } });
          if (!r.ok) throw new Error(I18N.error);
          return r.text();
        });
        const host = doc.querySelector('[data-quick-host]');
        if (!html || !host || !window.Alpine) return fallback();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const node = parsed.querySelector('[data-quick-view]');
        if (!node) return fallback();
        const mounted = doc.importNode(node, true);
        mounted.removeAttribute('x-ignore');
        mounted.classList.remove('dc-is-hidden');
        window.Alpine.mutateDom(() => { host.innerHTML = ''; host.appendChild(mounted); });
        window.Alpine.initTree(host.firstElementChild);
        this.openModal('quick');
      },
      closeQuick() {
        this.closeModal();
        setTimeout(() => { const host = doc.querySelector('[data-quick-host]'); if (host && !this.isOpen('quick') && window.Alpine) window.Alpine.mutateDom(() => { host.innerHTML = ''; }); }, 400);
      },
      async updateItem(item, qty) {
        qty = Math.floor(num(qty));
        if (String(item._id).startsWith('demo-')) return this.demoChange(item, qty);
        if (qty < 1) return this.removeItem(item);
        const c = await this.run('item:' + item._id, () => Store.cartChange(item._id, qty));
        if (c) this.setCart(c);
      },
      async removeItem(item) {
        if (String(item._id).startsWith('demo-')) return this.demoChange(item, 0);
        const c = await this.run('item:' + item._id, () => Store.cartRemove(item._id));
        if (c) { this.setCart(c); this.notify(I18N.removed); } else this.refreshCart();
      },
      async clearCart() {
        if (this.cart && this.cart.__demo) { this.setCart(this.demoCart([])); this.persistDemoCart(); return; }
        const c = await this.run('clear', () => Store.cartClear()); if (c) this.setCart(c);
      },
      async refreshCart() { if (this.cart && this.cart.__demo) return; try { const c = await Store.cartFetch(); if (c) this.setCart(c, false); } catch (e) { /* offline, ignore */ } },
      /**
       * Checkout handoff — same protocol as the platform runtime: GET /checkout with `x-qumra-checkout: 1`
       * returns { success, url } (the hosted checkout). Any other answer falls back to a plain navigation.
       */
      async checkout() {
        if (this.cart && this.cart.__demo) { this.notify(I18N.demoCheckout, 'error'); return; }
        if (!this.cartItems.length || this.isBusy('checkout')) return;
        const res = await this.run('checkout', async () => {
          const r = await fetch('/checkout', { method: 'GET', credentials: 'same-origin', headers: { 'x-qumra-checkout': '1', Accept: 'application/json' } });
          return r.json().catch(() => ({}));
        });
        if (res && res.success && res.url) { this.busy = Object.assign({}, this.busy, { checkout: true }); window.location.assign(res.url); return; }
        if (res && res.message) { this.notify(res.message, 'error'); return; }
        window.location.href = '/checkout';
      },
      async buyNow(productId, quantity, opts = {}) {
        const ok = await this.addToCart(productId, quantity, Object.assign({}, opts, { silent: true }));
        if (ok) this.checkout();
      },

      /* ── wishlist ── */
      isWished(id) { return this.wishlist.includes(String(id)); },
      get wishCount() { return this.wishlist.length; },
      async toggleWish(id) {
        if (!id) return;
        id = String(id);
        if (id.startsWith('demo-')) { this.notify(I18N.demoCheckout, 'error'); return; }
        const had = this.isWished(id);
        this.wishlist = had ? this.wishlist.filter((x) => x !== id) : this.wishlist.concat(id);
        const res = await this.run('wish:' + id, () => Store.wishlist(had ? 'remove' : 'add', id));
        if (res === null) { this.wishlist = had ? this.wishlist.concat(id) : this.wishlist.filter((x) => x !== id); return; }
        const ids = pick(res, ['products', 'wishlist.products', 'data.products']).map((p) => String(p && (p._id || p.id))).filter(Boolean);
        if (ids.length || (res && Array.isArray(res.products))) this.wishlist = ids;
        this.notify(had ? I18N.wishRemoved : I18N.wishAdded);
        window.dispatchEvent(new CustomEvent('wishlist:updated', { detail: res }));
      },

      /* ── search overlay suggestions ── */
      async loadSuggestions() {
        const q = (this.search.q || '').trim();
        this.search.active = -1;
        if (q.length < 2) { this.search.products = []; this.search.collections = []; this.search.done = false; return; }
        this.search.loading = true;
        const ticket = (this._sTicket = (this._sTicket || 0) + 1);
        try {
          const r = await Store.suggest(q, 6);
          if (ticket !== this._sTicket) return;
          let products = r.products;
          if (!products.length) { const s = await Store.searchProducts({ q, limit: 6 }); products = s.products; }
          if (ticket !== this._sTicket) return;
          this.search.products = products.slice(0, 6);
          this.search.collections = (r.collections || []).slice(0, 4);
        } catch (e) {
          this.search.products = []; this.search.collections = [];
        } finally {
          if (ticket === this._sTicket) { this.search.loading = false; this.search.done = true; }
        }
      },
      searchUrl(q) { return '/search?q=' + encodeURIComponent((q || '').trim()); },
      submitSearch() {
        const sel = this.search.products[this.search.active];
        if (sel) { window.location.href = productUrl(sel); return; }
        const q = (this.search.q || '').trim();
        if (q) window.location.href = this.searchUrl(q);
      },
      searchKey(e) {
        const n = this.search.products.length;
        if (!n) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this.search.active = (this.search.active + 1) % n; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.search.active = (this.search.active - 1 + n) % n; }
      },
    };
  };

  /* ═════════════ product page ═════════════ */

  /**
   * config: { product: {_id, title, slug, pricing, quantity, trackQuantity, allowBackorder, sku, images:[{fileUrl}], options, variants} }
   * Selection model: one slot per option (keyed by option id/name); first available value pre-selected.
   */
  window.dcProduct = function (config) {
    const product = (config && config.product) || {};
    const options = (product.options || []).filter((o) => o && Array.isArray(o.values) && o.values.length);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const valueId = (v) => (v && typeof v === 'object' ? String(v._id || v.id || v.valueId || v.value || v.label) : String(v));
    const optKey = (o, i) => String(o._id || o.name || i);
    const variantValueIds = (v) => (v.options || v.optionValues || v.selectedOptions || []).map(valueId);
    const variantPrice = (v) => (v.price != null ? num(v.price) : v.pricing && v.pricing.price != null ? num(v.pricing.price) : null);
    const variantCompare = (v) => (v.compareAtPrice != null ? num(v.compareAtPrice) : v.pricing && v.pricing.compareAtPrice != null ? num(v.pricing.compareAtPrice) : null);
    const variantQty = (v) => (typeof v.quantity === 'number' ? v.quantity : v.inventoryLevel && typeof v.inventoryLevel.available === 'number' ? v.inventoryLevel.available : null);
    const tracked = product.trackQuantity === true && product.allowBackorder !== true && THEME.followStock !== false;
    /* the platform refuses isAvailable:false whatever trackQuantity says, so «متوفر» there would end in a failed add */
    const platformSold = (o) => !!o && o.isAvailable === false && o.allowBackorder !== true && product.allowBackorder !== true && THEME.followStock !== false;
    const variantBuyable = (v) => !platformSold(v) && (!tracked || v.allowBackorder === true || variantQty(v) === null || variantQty(v) > 0);
    const basePrice = productPrice(product);
    const baseCompare = productCompare(product);

    return {
      product, options, quantity: 1, selected: {}, variant: null, resolving: false, missing: '', notice: '',
      price: basePrice, compareAt: baseCompare, sku: product.sku || '', active: 0, variantImage: '', stuck: false,

      init() {
        // pre-select: URL ?variant=<id> → that variant's values; otherwise first available value per option
        const fromUrl = new URLSearchParams(location.search).get('variant');
        const v0 = fromUrl && variants.find((v) => String(v._id) === fromUrl);
        if (v0) {
          const ids = variantValueIds(v0);
          options.forEach((o, i) => { const hit = o.values.find((val) => ids.includes(valueId(val))); if (hit) this.selected[optKey(o, i)] = valueId(hit); });
        }
        options.forEach((o, i) => {
          if (this.selected[optKey(o, i)]) return;
          const first = o.values.find((val) => this.isAvailable(o, i, val)) || o.values[0];
          this.selected = Object.assign({}, this.selected, { [optKey(o, i)]: valueId(first) });
        });
        if (options.length) this.resolve(true);
        // sticky mobile buy bar: shown once the main buy row has scrolled above the viewport
        const buy = this.$refs && this.$refs.buy;
        if (buy && this.$refs.stickyBar) {
          // on scroll, not IntersectionObserver: an instant jump back to the top never crosses the row, which left the bar stuck open
          const check = () => { this.stuck = buy.getBoundingClientRect().bottom < 0; };
          window.addEventListener('scroll', check, { passive: true });
          check();
        }
      },

      optKey, valueId,
      isSelected(o, i, v) { return this.selected[optKey(o, i)] === valueId(v); },
      // templates pass a slim {_id, name} ref (no values): resolve the full option before looking up the label
      selectedLabel(o, i) {
        const full = options.find((x, j) => optKey(x, j) === optKey(o, i)) || o;
        const v = (full.values || []).find((x) => valueId(x) === this.selected[optKey(o, i)]);
        return v ? v.label || v.value || v.name : '';
      },
      get selectedIds() { return options.map((o, i) => this.selected[optKey(o, i)]).filter(Boolean); },
      get allSelected() { return options.every((o, i) => !!this.selected[optKey(o, i)]); },

      /** a value is available if some variant with it + the other current picks exists and can be bought */
      isAvailable(o, i, v) {
        if (!variants.length || !variants.some((x) => variantValueIds(x).length)) return true;
        const id = valueId(v);
        const others = options.map((oo, j) => (j === i ? null : this.selected[optKey(oo, j)])).filter(Boolean);
        const cands = variants.filter((x) => { const ids = variantValueIds(x); return ids.includes(id) && others.every((o2) => ids.includes(o2)); });
        if (!cands.length) return false;
        /* every variant sold: all values stay open so the shopper can still see the combinations; add stays off and the state reads «نفد» */
        return cands.some(variantBuyable) || !variants.some(variantBuyable);
      },

      async choose(o, i, v) {
        this.selected = Object.assign({}, this.selected, { [optKey(o, i)]: valueId(v) });
        this.missing = '';
        // if the new pick makes other picks impossible, move them to the first compatible value
        options.forEach((oo, j) => {
          if (j === i) return;
          const cur = oo.values.find((x) => valueId(x) === this.selected[optKey(oo, j)]);
          if (cur && !this.isAvailable(oo, j, cur)) {
            const alt = oo.values.find((x) => this.isAvailable(oo, j, x));
            if (alt) this.selected = Object.assign({}, this.selected, { [optKey(oo, j)]: valueId(alt) });
          }
        });
        await this.resolve();
      },

      findLocal() {
        const ids = this.selectedIds;
        return variants.find((v) => { const vi = variantValueIds(v); return vi.length === ids.length && ids.every((id) => vi.includes(id)); }) || null;
      },

      async resolve(initial) {
        if (!this.allSelected) return;
        let v = this.findLocal();
        if (!v && product._id && !String(product._id).startsWith('demo-')) {
          this.resolving = true;
          try { const r = await Store.resolveVariant(product._id, this.selectedIds, 1); v = r && (r._id || r.price != null || r.pricing) ? r : null; }
          catch (e) { v = null; }
          finally { this.resolving = false; }
        }
        this.apply(v, initial);
      },

      apply(v, initial) {
        this.variant = v;
        // always reset to product values first so a variant without its own price never keeps a stale one
        this.price = basePrice; this.compareAt = baseCompare; this.sku = product.sku || ''; this.variantImage = '';
        if (v) {
          const p = variantPrice(v), c = variantCompare(v);
          if (p !== null) this.price = p;
          if (c !== null) this.compareAt = c;
          if (v.sku) this.sku = v.sku;
          const img = v.image && (v.image.fileUrl || v.image.url || (typeof v.image === 'string' ? v.image : ''));
          if (img) {
            const idx = (product.images || []).findIndex((x) => (x.fileUrl || x.url) === img);
            if (idx >= 0) this.goTo(idx); else this.variantImage = img;
          }
          if (!initial && v._id && history.replaceState) {
            const u = new URL(location.href); u.searchParams.set('variant', v._id); history.replaceState(history.state, '', u.toString());
          }
        }
        this.clamp();
      },

      get comboMissing() { return options.length > 0 && this.allSelected && !this.variant && variants.length > 0 && !this.resolving; },
      get stockQty() { if (this.variant) return variantQty(this.variant); return typeof product.quantity === 'number' ? product.quantity : null; },
      get stock() {
        if (this.comboMissing) return 'out';
        if (platformSold(this.variant || (variants.length ? null : product))) return 'out';
        if (!tracked) return 'in';
        if (this.variant && this.variant.allowBackorder === true) return 'in';
        const q = this.stockQty;
        if (q === null) return 'in';
        if (q <= 0) return 'out';
        return q <= num(THEME.lowStock, 3) ? 'low' : 'in';
      },
      get canBuy() { return this.stock !== 'out' && !this.resolving; },
      get maxQty() {
        const q = this.stockQty;
        if (!tracked || q === null) return 99;
        return Math.max(1, q - this.inCartQty(product._id, this.variant && this.variant._id));
      },
      get discount() { return this.compareAt > this.price && this.compareAt > 0 ? Math.floor(((this.compareAt - this.price) / this.compareAt) * 100) : 0; },
      lowText() { return (I18N.lowStock || '').replace('{count}', this.stockQty); },

      clamp() {
        let q = Math.floor(num(toLatinDigits(this.quantity), 1));
        if (q < 1) q = 1;
        if (q > this.maxQty) { q = this.maxQty; this.notice = (I18N.maxQty || '').replace('{count}', this.maxQty); } else this.notice = '';
        this.quantity = q;
      },
      inc() { this.quantity = num(this.quantity, 1) + 1; this.clamp(); },
      dec() { this.quantity = Math.max(1, num(this.quantity, 1) - 1); this.clamp(); },

      validate() {
        const i = options.findIndex((o, j) => !this.selected[optKey(o, j)]);
        if (i === -1) return true;
        this.missing = (I18N.selectOption || '') + ' ' + (options[i].name || options[i].title || '');
        const el = this.$root.querySelector('[data-option-index="' + i + '"]');
        if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
        return false;
      },
      cartOpts() { return { options: this.selectedIds, variantId: this.variant && this.variant._id }; },
      async add() { if (!this.validate() || !this.canBuy) return false; this.clamp(); return this.addToCart(product._id, this.quantity, this.cartOpts()); },
      async buy() { if (!this.validate() || !this.canBuy) return; this.clamp(); return this.buyNow(product._id, this.quantity, this.cartOpts()); },

      /* gallery (scroll-snap track + thumbs) */
      goTo(i) {
        this.active = i;
        const track = this.$refs && this.$refs.track;
        const slide = track && track.children[i];
        if (slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      },
      zoom: false, zoomIndex: 0, zoomScaled: false, zoomOrigin: '',
      get zoomSrc() { const s = this.$refs.track && this.$refs.track.children[this.zoomIndex]; const i = s && s.querySelector('img'); return i ? (i.currentSrc || i.src) : ''; },
      openZoom(i) { this.zoomIndex = i; this.zoomScaled = false; this.zoom = true; ScrollLock.lock(); },
      closeZoom() { this.zoom = false; this.zoomScaled = false; ScrollLock.unlock(); this.goTo(this.zoomIndex); },
      stepZoom(d) { const n = this.$refs.track ? this.$refs.track.children.length : 1; this.zoomIndex = (this.zoomIndex + d + n) % n; this.zoomScaled = false; },
      toggleZoomScale(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this.zoomOrigin = 'transform-origin:' + (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '% ' + (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%';
        this.zoomScaled = !this.zoomScaled;
      },
      step(d) {
        const n = this.$refs.track ? this.$refs.track.children.length : 0;
        if (n) this.goTo((this.active + d + n) % n);
      },
      onTrackScroll() {
        const track = this.$refs.track; if (!track) return;
        const center = track.scrollLeft + track.clientWidth / 2;
        let best = 0, bestD = Infinity;
        Array.from(track.children).forEach((c, i) => { const d = Math.abs(c.offsetLeft - track.offsetLeft + c.clientWidth / 2 - center); if (d < bestD) { bestD = d; best = i; } });
        this.active = best;
      },
      canNativeShare: !!navigator.share,
      /** share link without the theme's own hash routes (#product=…) or tracking noise */
      shareUrl() { const u = new URL(location.href); if (/^#product=/.test(u.hash) && product.__demo) return u.href; u.hash = ''; return u.href; },
      async copyLink() {
        try { await navigator.clipboard.writeText(this.shareUrl()); this.notify(I18N.linkCopied); }
        catch (e) { window.prompt('', this.shareUrl()); }
      },
      async share() {
        const data = { title: product.title, url: this.shareUrl() };
        try { if (navigator.share) { await navigator.share(data); return; } await navigator.clipboard.writeText(location.href); this.notify(I18N.linkCopied); }
        catch (e) { /* user cancelled */ }
      },
    };
  };

  /* ═════════════ collection / shop listing (server-rendered results + client-side facets) ═════════════ */

  const FACET_KEYS = ['origin', 'roast', 'grind', 'weight'];
  const FACET_TAG_KEYS = {
    origin: ['origin', 'المنشأ', 'منشأ', 'بلد المنشأ', 'البلد'],
    roast: ['roast', 'التحميص', 'تحميص', 'درجة التحميص'],
    grind: ['grind', 'الطحن', 'طحن', 'نوع الطحن', 'طحنة'],
    weight: ['weight', 'الوزن', 'وزن'],
  };
  const GRIND_OPTION = /(grind|طحن|طحنة|مطحونة)/i;

  /** Facet values of one card — parsed from its real tags/options, never invented. */
  function cardFacets(el) {
    const out = { origin: [], roast: [], grind: [], weight: [] };
    let tags = [], options = [];
    try { tags = JSON.parse(el.getAttribute('data-dc-tags') || '[]') || []; } catch (e) { tags = []; }
    try { options = JSON.parse(el.getAttribute('data-dc-options') || '[]') || []; } catch (e) { options = []; }
    tags.forEach((raw) => {
      const m = tagText(raw).match(/^\s*([^:：=]+?)\s*[:：=]\s*(.+?)\s*$/);
      if (!m) return;
      const key = m[1].trim().toLowerCase();
      for (let i = 0; i < FACET_KEYS.length; i += 1) {
        const k = FACET_KEYS[i];
        if (FACET_TAG_KEYS[k].indexOf(key) !== -1) { out[k].push(m[2].trim()); break; }
      }
    });
    options.forEach((o) => {
      const name = String((o && (o.name || o.title)) || '');
      const vals = ((o && o.values) || []).map((v) => (v && (v.label || v.value || v.name)) || '').filter(Boolean);
      if (!vals.length) return;
      if (GRIND_OPTION.test(name)) out.grind = out.grind.concat(vals);
      else if (WEIGHT_OPTION.test(name)) out.weight = out.weight.concat(vals);
    });
    FACET_KEYS.forEach((k) => { out[k] = Array.from(new Set(out[k].map(String))); });
    return out;
  }

  /**
   * config: { sort, min, max, labels:{origin,roast,grind,weight,stock,price}, showing, results }
   * Facets filter the server-rendered cards client-side (works with the documented ?sort= navigation);
   * selection lives in the URL (filters[handle][] / filters[price][min|max]) so a
   * filtered view is shareable and survives reloads.
   */
  window.dcCollection = function (config) {
    const cfg = config || {};
    const sp = new URLSearchParams(location.search);
    const labels = cfg.labels || {};
    const readSel = (k) => sp.getAll('filters[' + k + '][]').map((v) => String(v).trim()).filter(Boolean);
    // FLT-01: dashboard filters (server mode) vs facets discovered from card tags (client mode)
    const server = Array.isArray(cfg.serverKeys) && cfg.serverKeys.length > 0;
    const KEYS = server ? cfg.serverKeys.map(String) : FACET_KEYS;
    const major = (v) => { const n = num(toLatinDigits(String(v == null ? '' : v)), -1); return n >= 0 ? Money.fromMajor(n) : null; };
    return {
      sort: sp.get('sort') || '',
      min: sp.get('filters[price][min]') || '',
      max: sp.get('filters[price][max]') || '',
      sel: KEYS.reduce((a, k) => { a[k] = readSel(k); return a; }, {}),
      server,
      facets: [],
      shown: -1,
      total: 0,
      open: false,
      navigating: false,
      init() { this.scan(); this.apply(); },
      cards() { return this.$root.querySelectorAll('[data-dc-card]'); },
      scan() {
        if (server) { this.total = this.cards().length; this.facets = []; return; }
        const acc = FACET_KEYS.reduce((a, k) => { a[k] = new Map(); return a; }, {});
        this.cards().forEach((el) => {
          const f = cardFacets(el);
          FACET_KEYS.forEach((k) => f[k].forEach((v) => acc[k].set(v, (acc[k].get(v) || 0) + 1)));
        });
        this.total = this.cards().length;
        this.facets = FACET_KEYS.filter((k) => acc[k].size).map((k) => ({
          key: k,
          label: labels[k] || k,
          values: Array.from(acc[k], (entry) => ({ v: entry[0], count: entry[1] }))
            .sort((a, b) => (b.count - a.count) || String(a.v).localeCompare(String(b.v), root.lang || 'ar')),
        }));
      },
      isSel(k, v) { return (this.sel[k] || []).indexOf(String(v)) !== -1; },
      toggle(k, v) {
        const val = String(v); const cur = this.sel[k] || [];
        this.sel[k] = cur.indexOf(val) === -1 ? cur.concat(val) : cur.filter((x) => x !== val);
        this.commit();
      },
      /** client mode filters this page live; server mode reloads with the filters in the URL — but inside the
          mobile drawer nothing is sent until «عرض النتائج» (FLT-11) */
      commit() { if (!server) { this.apply(); this.sync(); } else if (!this.open) this.navigateFilters(); },
      filterUrl() {
        const u = new URL(location.href);
        Array.from(u.searchParams.keys()).filter((k) => /^filters\[/.test(k)).forEach((k) => u.searchParams.delete(k));
        u.searchParams.delete('page');
        KEYS.forEach((k) => (this.sel[k] || []).forEach((v) => u.searchParams.append('filters[' + k + '][]', v)));
        if (String(this.min).trim() !== '') u.searchParams.set('filters[price][min]', String(this.min).trim());
        if (String(this.max).trim() !== '') u.searchParams.set('filters[price][max]', String(this.max).trim());
        return u;
      },
      navigateFilters() { const u = this.filterUrl(); if (u.search !== location.search) this.go(u); },
      priceNote: '',
      /** FLT-04: negatives drop to empty, an inverted range is swapped with a visible note */
      applyPrice() {
        const clean = (v) => { const t = toLatinDigits(String(v == null ? '' : v)).trim(); if (t === '') return ''; const n = Number(t); return Number.isFinite(n) && n >= 0 ? String(n) : ''; };
        this.min = clean(this.min); this.max = clean(this.max); this.priceNote = '';
        if (this.min !== '' && this.max !== '' && Number(this.min) > Number(this.max)) { const t = this.min; this.min = this.max; this.max = t; this.priceNote = cfg.priceSwapped || ''; }
        this.commit();
      },
      /* FLT-11: the mobile drawer works on a draft — cancel restores the state it opened with */
      _snap: null,
      openFilters() { this._snap = JSON.stringify({ sel: this.sel, min: this.min, max: this.max }); this.open = true; },
      applyFilters() { this._snap = null; this.open = false; if (server) this.navigateFilters(); },
      cancelFilters() {
        if (this._snap) { const s = JSON.parse(this._snap); this.sel = s.sel; this.min = s.min; this.max = s.max; if (!server) { this.apply(); this.sync(); } }
        this._snap = null; this.priceNote = ''; this.open = false;
      },
      clearAll() {
        KEYS.forEach((k) => { this.sel[k] = []; });
        this.min = ''; this.max = ''; this.priceNote = '';
        if (server) { this.open = false; this.navigateFilters(); } else { this.apply(); this.sync(); }
      },
      matches(el) {
        const f = cardFacets(el);
        for (let i = 0; i < FACET_KEYS.length; i += 1) {
          const k = FACET_KEYS[i]; const want = this.sel[k];
          if (want && want.length && !want.some((v) => f[k].indexOf(v) !== -1)) return false;
        }
        const price = num(el.getAttribute('data-dc-price'), -1);
        if (price >= 0) {
          const lo = this.min === '' ? null : major(this.min);
          const hi = this.max === '' ? null : major(this.max);
          if (lo !== null && price < lo) return false;
          if (hi !== null && price > hi) return false;
        }
        return true;
      },
      apply() {
        if (server) { this.shown = this.cards().length; return; } // the server already filtered these
        let n = 0;
        this.cards().forEach((el) => { const ok = this.matches(el); el.hidden = !ok; if (ok) n += 1; });
        this.shown = n;
      },
      get activeCount() {
        const facets = KEYS.reduce((n, k) => n + ((this.sel[k] || []).length ? 1 : 0), 0);
        return facets + ((this.min !== '' || this.max !== '') ? 1 : 0);
      },
      get countText() {
        if (this.shown < 0 || this.shown === this.total) return countProducts(Math.max(this.total, num(cfg.totalItems, 0))); // COL-06: whole result set, not just this page
        return (cfg.showing || '{shown}/{total}').replace('{shown}', String(this.shown)).replace('{total}', String(this.total));
      },
      sync() {
        const u = new URL(location.href);
        KEYS.forEach((k) => {
          const key = 'filters[' + k + '][]';
          u.searchParams.delete(key);
          (this.sel[k] || []).forEach((v) => u.searchParams.append(key, v));
        });
        const set = (k, v) => { if (v !== '' && v != null) u.searchParams.set(k, String(v)); else u.searchParams.delete(k); };
        set('filters[price][min]', String(this.min).trim());
        set('filters[price][max]', String(this.max).trim());
        try { history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* file:// preview */ }
      },
      go(u) { u.searchParams.delete('page'); this.navigating = true; location.href = u.pathname + u.search; },
      setSort(v) { const u = new URL(location.href); if (v) u.searchParams.set('sort', v); else u.searchParams.delete('sort'); this.go(u); },
      pageUrl(n) { const u = new URL(location.href); u.searchParams.set('page', n); return u.pathname + u.search; },
    };
  };
  window.dcPageUrl = function (n) { const u = new URL(location.href); u.searchParams.set('page', n); return u.pathname + u.search; };

  /* ═════════════ search results page ═════════════ */

  /** config: { limit } — reads q, sort, filters[price][min|max] from the URL */
  window.dcSearchPage = function (config) {
    const sp = new URLSearchParams(location.search);
    const limit = Math.min(48, Math.max(8, num(config && config.limit, 24)));
    return {
      q: sp.get('q') || String((config && config.seed && config.seed.q) || ''), sort: sp.get('sort') || '', min: sp.get('filters[price][min]') || '', max: sp.get('filters[price][max]') || '',
      items: [], page: 1, total: 0, hasNext: false, loading: false, error: false, loaded: false,
      init() {
        // server-rendered first page (context.products on live /search) — no AJAX round-trip when it matches the URL
        const seed = config && config.seed;
        if (seed && Array.isArray(seed.items) && seed.items.length && String(seed.q || '').trim() === this.q.trim() && !this.sort && !this.min && !this.max) {
          this.items = seed.items.map(normProduct).filter(isListable); this.page = num(seed.page, 1) || 1;
          this.total = num(seed.total, 0) || this.items.length; this.hasNext = !!seed.hasNext; this.loaded = true;
          return;
        }
        if (this.q.trim()) this.fetch(); else this.loaded = true;
      },
      async fetch(more) {
        this.loading = true; this.error = false;
        try {
          const r = await Store.searchProducts({ q: this.q.trim(), sort: this.sort, page: more ? this.page + 1 : 1, limit, min: this.min, max: this.max });
          const lo = this.min !== '' ? Money.fromMajor(this.min) : null, hi = this.max !== '' ? Money.fromMajor(this.max) : null;
          const list = r.products.filter((p) => (lo === null || productPrice(p) >= lo) && (hi === null || productPrice(p) <= hi));
          if (more) { this.page += 1; this.items = this.items.concat(list.filter((p) => !this.items.some((x) => x._id === p._id))); }
          else { this.page = 1; this.items = list; }
          this.total = r.total || this.items.length; this.hasNext = r.hasNext;
        } catch (e) { this.error = true; }
        finally { this.loading = false; this.loaded = true; }
      },
      sync() {
        const u = new URL(location.href);
        const set = (k, v) => (v !== '' && v != null ? u.searchParams.set(k, v) : u.searchParams.delete(k));
        set('q', this.q.trim()); set('sort', this.sort); set('filters[price][min]', this.min); set('filters[price][max]', this.max);
        history.replaceState(history.state, '', u.pathname + u.search);
      },
      submit() { this.sync(); this.fetch(); },
    };
  };

  /* ═════════════ product rails (home sections) ═════════════ */

  /**
   * config: { source: 'newest' | 'top-rated' | 'collection' | 'none', limit, collectionId, kind }
   * Used only when the merchant hasn't picked products: queries the live store; demo items only in preview.
   */
  window.dcProducts = function (config) {
    const cfg = config || {};
    const limit = Math.min(24, Math.max(1, num(cfg.limit, 4)));
    return {
      items: [], loading: true, demo: false,
      async init() {
        const sort = cfg.source === 'top-rated' ? 'rating-desc' : 'created-desc';
        if (cfg.source && cfg.source !== 'none') {
          try {
            // ask for one extra so excluding the current product (related products) still fills the row
            const r = await Store.searchProducts({ q: '', sort, limit: cfg.exclude ? limit + 1 : limit, collectionId: cfg.source === 'collection' ? cfg.collectionId : undefined });
            this.items = r.products.filter((p) => !cfg.exclude || String(p._id) !== String(cfg.exclude)).slice(0, limit);
          } catch (e) { this.items = []; }
        }
        if (!this.items.length && demoAllowed()) { this.items = Demo.products(cfg.kind, limit + 1).filter((p) => String(p._id) !== String(cfg.exclude || '')).slice(0, limit); this.demo = true; }
        this.loading = false;
        this.$nextTick(() => Reveal.scan(this.$el));
      },
    };
  };

  /* ═════════════ /blogs: the platform sends categories only, so the cards come from each category's own page ═════════════ */

  window.dcBlogMerge = function (urls) {
    return {
      loading: true, none: false,
      async init() {
        const cards = [], seen = new Set(), parser = new DOMParser();
        for (const u of (urls || []).slice(0, 8)) {
          try {
            const r = await fetch(u, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
            if (!r.ok) continue;
            parser.parseFromString(await r.text(), 'text/html').querySelectorAll('.dc-journal-grid .dc-journal-card').forEach((c) => {
              const a = c.querySelector('a[href]'); const k = a ? a.getAttribute('href') : c.textContent;
              if (!seen.has(k)) { seen.add(k); cards.push(c); }
            });
          } catch (e) { /* that category stays out */ }
        }
        const when = (c) => { const t = c.querySelector('time[datetime]'); return t ? Date.parse(t.getAttribute('datetime')) || 0 : 0; };
        cards.sort((a, b) => when(b) - when(a));
        const grid = this.$refs.grid;
        cards.forEach((c) => grid.appendChild(doc.importNode(c, true)));
        localiseDates(grid);
        Reveal.scan(grid);
        this.none = !cards.length;
        this.loading = false;
      },
    };
  };

  window.dcDemoCollections = function (real) {
    return {
      items: [],
      init() {
        if (demoAllowed()) this.items = Demo.data().collections;
        if (real) (window.requestIdleCallback || setTimeout)(() => this.loadReal(), { timeout: 2500 });
      },
      /* nothing picked in the builder: the store's own collections, as its /collections page lists them. On failure the section stays as it was */
      async loadReal() {
        try {
          const res = await fetch('/collections', { credentials: 'same-origin' });
          if (!res.ok) return;
          const page = new DOMParser().parseFromString(await res.text(), 'text/html');
          const list = Array.from(page.querySelectorAll('.dc-category-grid > a.dc-category-card')).map((a) => {
            const text = (cls) => { const el = a.querySelector(cls); return el ? el.textContent.trim() : ''; };
            const img = a.querySelector('img');
            return { _id: a.getAttribute('href'), url: a.getAttribute('href'), title: text('.dc-category-card__title'), description: text('.dc-category-card__text'), image: img ? img.getAttribute('src') : '' };
          }).filter((c) => c.title);
          if (list.length) this.items = list.slice(0, 8);
        } catch (e) { /* keep what's there */ }
      }
    };
  };

  /* ═════════════ newsletter ═════════════ */

  /**
   * Qumra has no storefront newsletter endpoint, so the form posts to the merchant's provider
   * (Mailchimp / Klaviyo / Brevo / Google Form…) set in the widget's `form_action`. Validation only here.
   */
  window.dcNewsletter = function () {
    return {
      email: '', state: 'idle', message: '',
      submit(e) {
        const v = (this.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { e.preventDefault(); this.state = 'error'; this.message = I18N.newsletterInvalid; return; }
        this.state = 'sent';
        // let the native POST (target _blank-safe providers) proceed
      },
    };
  };

  /* ═════════════ contact ═════════════ */

  /**
   * Same contract as the newsletter: Qumra exposes no storefront contact endpoint, so the form posts
   * to the merchant's endpoint (`form_action` — Formspree / Getform / Google Form…) and falls back to
   * mailto: when only settings.contactEmail exists. Validation only here.
   */
  window.dcContact = function () {
    return {
      name: '', email: '', message: '', state: 'idle', error: '',
      submit(e) {
        const name = (this.name || '').trim();
        const email = (this.email || '').trim();
        const msg = (this.message || '').trim();
        if (name.length < 2 || msg.length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          e.preventDefault();
          this.state = 'error';
          this.error = I18N.contactInvalid || I18N.newsletterInvalid;
          return;
        }
        this.state = 'sent';
        // let the native POST proceed (target _blank-safe providers)
      },
    };
  };

  /* ═════════════ documented facades ═════════════ */

  const app = () => (window.Alpine && doc.body && isFn(window.Alpine.$data) ? window.Alpine.$data(doc.body) : null);

  window.CartManager = window.CartManager || {
    async add(productId, qty = 1, variantId, options) {
      const a = app();
      if (a) return a.addToCart(productId, qty, { variantId, options });
      const c = await Store.cartAdd(productId, qty, { variantId, options });
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: c }));
      return c;
    },
    async update(itemId, qty) {
      const a = app();
      if (a) { const item = a.cartItems.find((i) => i._id === itemId) || { _id: itemId }; return a.updateItem(item, qty); }
      const c = qty < 1 ? await Store.cartRemove(itemId) : await Store.cartChange(itemId, qty);
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: c }));
      return c;
    },
    increment(itemId, currentQty) { return this.update(itemId, num(currentQty) + 1); },
    decrement(itemId, currentQty) { return this.update(itemId, num(currentQty) - 1); },
    remove(itemId) { return this.update(itemId, 0); },
    async clear() { const a = app(); if (a) return a.clearCart(); const c = await Store.cartClear(); window.dispatchEvent(new CustomEvent('cart:updated', { detail: c })); return c; },
    get() { return Store.cartFetch(); },
  };

  window.WishlistManager = window.WishlistManager || {
    has(id) { const a = app(); return !!a && a.isWished(id); },
    async toggle(id) { const a = app(); if (a) return a.toggleWish(id); return Store.wishlist('add', id); },
    async add(id) { const a = app(); if (a && !a.isWished(id)) return a.toggleWish(id); return a ? null : Store.wishlist('add', id); },
    async remove(id) { const a = app(); if (a && a.isWished(id)) return a.toggleWish(id); return a ? null : Store.wishlist('remove', id); },
    clear() { return Store.wishlist('clear'); },
  };

  window.SearchManager = window.SearchManager || {
    search(query, opts = {}) { return Store.searchProducts(Object.assign({ q: query }, opts)); },
    suggest(query, cb, debounceMs = 300) {
      if (!isFn(cb)) return Store.suggest(query);
      clearTimeout(this._t);
      this._t = setTimeout(() => Store.suggest(query).then(cb, () => cb({ products: [], collections: [] })), debounceMs);
      return undefined;
    },
  };

  window.ProductManager = window.ProductManager || {
    get(handle) { return Store.productByHandle(handle); },
    getVariant(productId, selectedOptions, quantity) { return Store.resolveVariant(productId, selectedOptions, quantity); },
  };

  window.Decafe = { Money, Store, productAttrs, isPreview };

  // dates rendered after Alpine boots (x-for lists) and editor re-renders
  doc.addEventListener('alpine:initialized', () => setTimeout(() => { localiseDates(); normaliseLineBreaks(); }, 0));
  normaliseLineBreaks();
  mountCurrencySwitch();
})();
