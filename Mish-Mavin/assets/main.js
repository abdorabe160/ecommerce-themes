/* =========================================================
   Mish-Mavin — Storefront Theme
   Alpine.js store/components + Swiper + Store AJAX (/ajax/cart, /ajax/product, /ajax/search)
   - Cart (add / buy now / change / remove) with stock limits
   - Variant picker shared by the product page and the quick-add drawer:
     option compatibility (unavailable combinations are disabled) + per-variant stock
   ========================================================= */
(function () {
  'use strict';

  const CFG = window.MW_CFG || {};
  const I18N = CFG.i18n || {};
  // «أوشك على النفاد» من 1 لحد الحد (افتراضي 3 — خطة QA قمرة PRD-24)
  const LOW_STOCK = Number(CFG.lowStock) > 0 ? Number(CFG.lowStock) : 3;
  const CHECKOUT_URL = CFG.checkoutUrl || '/checkout';
  const FOLLOW_STOCK = CFG.followStock !== false;
  function trHtml(key, fallback, vars) {
    let s = String(I18N[key] || fallback || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function tr(key, fallback, vars) {
    let s = I18N[key] || fallback || '';
    if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  /* ---------- Preview detection ----------
     التطوير المحلي (qumra theme dev)، محرر الثيم (iframe) أو رابط معاينة.
     البيانات التوضيحية تظهر هنا فقط — لا تظهر لعملاء المتجر الحي. */
  function isPreview() {
    try {
      const l = window.location;
      if (l.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(l.hostname)) return true;
      if (/[?&](theme|theme_id|preview|preview_theme_id|editor|demo_product|demo_collection)=/.test(l.search)) return true;
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }
  // المنتجات التوضيحية: في المعاينة/المحرر دايماً، وللعملاء بس لو التاجر فعّل «إظهار منتجات توضيحية» (HOME-11 / EDGE-01)
  const demoAllowed = () => isPreview() || CFG.demoProducts === true;

  /* ---------- Money ----------
     The server renders a sample of `100000 | money` into MW_CFG.moneySample; from it we learn
     the currency format and whether prices come in minor units (÷100) — so JS output matches `| money`. */
  const Money = (function () {
    const latin = (s) => String(s || '')
      .replace(/<[^>]*>/g, '')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/٫/g, '.').replace(/٬/g, ',');
    const sample = latin(CFG.moneySample);
    const m = sample.match(/\d[\d,.\s]*\d|\d/);
    let divisor = 1, prefix = '', suffix = '', decimals = 0;
    if (m) {
      const val = parseFloat(m[0].replace(/[,\s]/g, ''));
      if (val > 0) divisor = Math.max(1, Math.round(100000 / val));
      prefix = sample.slice(0, m.index);
      suffix = sample.slice(m.index + m[0].length);
      // REG-05: نفس عدد الخانات العشرية اللي بيطلعها فلتر | money على السيرفر (مثلاً «100,000ج.م» = 0)
      const dm = m[0].match(/\.(\d+)$/);
      decimals = dm && dm[1].length <= 2 ? dm[1].length : 0;
    }
    return {
      divisor,
      fmt(n) {
        const v = (Number(n) || 0) / divisor;
        return prefix + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) }) + suffix;
      }
    };
  })();

  /* ---------- Scroll lock (ref-counted) ---------- */
  let locks = 0;
  function lockScroll(on) {
    locks = Math.max(0, locks + (on ? 1 : -1));
    document.documentElement.style.overflow = locks ? 'hidden' : '';
  }

  /* ---------- Store AJAX ---------- */
  async function api(url, body) {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok || (data && data.success === false)) {
      const err = new Error('HTTP ' + res.status);
      const msg = data && (data.message || data.error || (Array.isArray(data.errors) && data.errors[0] && (data.errors[0].message || data.errors[0])));
      if (msg && typeof msg === 'string') err.userMessage = msg;
      throw err;
    }
    return data;
  }

  function readJSON(id) {
    try {
      const el = document.getElementById(id);
      return el ? JSON.parse(el.textContent || 'null') : null;
    } catch (e) { return null; }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mix = (target, ...sources) => { sources.forEach((s) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(s))); return target; };

  /* =========================================================
     Products, variants & stock
     Works with the documented shapes: product.options[].values[] ({_id,label}),
     product.variants[] ({_id, price, quantity, options[]}) and product.quantity / trackQuantity / allowBackorder.
     ========================================================= */
  const isObj = (v) => v !== null && typeof v === 'object';
  const imgUrl = (x) => (x && (typeof x === 'string' ? x : (x.fileUrl || x.url || x.src))) || '';
  const valKeys = (v) => (isObj(v)
    ? [v._id, v.id, v.valueId, v.value, v.label, v.name].filter((x) => x != null && x !== '').map(String)
    : (v == null ? [] : [String(v)]));
  const valLabel = (v) => (isObj(v) ? String(v.label || v.value || v.name || v._id || '') : String(v == null ? '' : v));
  const COLOR_RE = /^(colou?r|اللون|لون|الالوان|الألوان)$/i;
  const isColorOpt = (o) => COLOR_RE.test(String((o && o.name) || '').trim());
  /* أسماء الألوان (عربي + إنجليزي) → hex، عشان الزرار يظهر بلونه الصح بدل الرمادي.
     Qumra أحياناً ترجع اللون كاسم فقط (label) بدون color/hex. */
  const COLOR_MAP = {
    'أسود': '#111111', 'اسود': '#111111', 'black': '#111111',
    'أبيض': '#ffffff', 'ابيض': '#ffffff', 'white': '#ffffff', 'offwhite': '#f4f4f4', 'off white': '#f4f4f4', 'أوف وايت': '#f4f4f4', 'اوف وايت': '#f4f4f4',
    'بيج': '#e8dcc8', 'beige': '#e8dcc8', 'nude': '#e8dcc8',
    'بني': '#6b4b2a', 'brown': '#6b4b2a', 'coffee': '#4b3621', 'كافيه': '#4b3621',
    'رمادي': '#9aa0a6', 'رمادى': '#9aa0a6', 'grey': '#9aa0a6', 'gray': '#9aa0a6', 'grey marl': '#8f9398', 'tan': '#c8ad8d', 'رصاصي': '#555555', 'رصاصى': '#555555', 'charcoal': '#4a4a4a', 'فحمي': '#4a4a4a',
    'lightgrey': '#d9d9d9', 'light grey': '#d9d9d9', 'فاتح': '#d9d9d9',
    'كحلي': '#1f2a5a', 'navy': '#2b3f8f', 'navyblue': '#2b3f8f',
    'أزرق': '#2f6fed', 'ازرق': '#2f6fed', 'blue': '#2f6fed', 'lightblue': '#7f9fbf', 'light blue': '#7f9fbf', 'لبني': '#7f9fbf', 'سماوي': '#7f9fbf', 'تركواز': '#3fb6c4', 'turquoise': '#3fb6c4',
    'أخضر': '#1f7a3a', 'اخضر': '#1f7a3a', 'green': '#1f7a3a', 'زيتي': '#4c7a34', 'olive': '#4c7a34', 'forestgreen': '#2e5e3a', 'forest green': '#2e5e3a',
    'أحمر': '#c0392b', 'احمر': '#c0392b', 'red': '#c0392b', 'نبيتي': '#6e1423', 'بورجوندي': '#6e1423', 'burgundy': '#6e1423', 'maroon': '#6e1423',
    'بينك': '#f2a7c3', 'وردي': '#f2a7c3', 'pink': '#f2a7c3', 'فوشيا': '#d63384', 'fuchsia': '#d63384',
    'موف': '#6b4b8a', 'بنفسجي': '#6b4b8a', 'purple': '#6b4b8a',
    'أصفر': '#f5c518', 'اصفر': '#f5c518', 'yellow': '#f5c518', 'مسطردة': '#d9a400', 'mustard': '#d9a400',
    'برتقالي': '#e67e22', 'برتقالى': '#e67e22', 'orange': '#e67e22',
    'ذهبي': '#c9a227', 'gold': '#c9a227', 'فضي': '#c0c0c0', 'silver': '#c0c0c0',
    'gemstone': '#4c7a34', 'mint': '#9fd8c9', 'mintgreen': '#9fd8c9', 'babyblue': '#a9c7e8', 'beige': '#e8dcc8'
  };
  const normColorName = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const normKey = (s) => String(s == null ? '' : s).trim().toLowerCase();
  function resolveSwatch(raw) {
    if (raw == null) return '#cccccc';
    const s = String(raw).trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
    const hit = COLOR_MAP[normColorName(s)] || COLOR_MAP[normColorName(s).replace(/\s+/g, '')];
    if (hit) return hit;
    // أسماء CSS القياسية (red, blue, green...) نشتغل بها كما هي، غير كده رمادي
    if (/^[a-z]{3,20}$/i.test(s.replace(/\s+/g, ''))) return s.replace(/\s+/g, '');
    return '#cccccc';
  }
  const priceOf = (x) => (!x ? null : (x.pricing && x.pricing.price != null ? x.pricing.price : (x.price != null ? x.price : null)));
  const compareOf = (x) => (!x ? null : (x.pricing && x.pricing.compareAtPrice != null ? x.pricing.compareAtPrice : (x.compareAtPrice != null ? x.compareAtPrice : null)));
  const unlimited = (p) => !FOLLOW_STOCK || !!(p && (p.allowBackorder || p.trackQuantity === false));

  function variantKeys(vr) {
    const raw = vr.options || vr.optionValues || vr.values || vr.selectedOptions || vr.attributes || [];
    const arr = Array.isArray(raw) ? raw : Object.values(raw);
    const keys = [];
    arr.forEach((o) => valKeys(o).forEach((k) => keys.push(k)));
    return keys;
  }
  function variantMatches(vr, selected) {
    const keys = variantKeys(vr).map(normKey);
    if (!keys.length) return false;
    return selected.every((v) => {
      if (v == null) return true;
      // مطابقة متسامحة: id أو label، بدون حساسية لحالة الأحرف والمسافات
      return valKeys(v).map(normKey).some((k) => keys.includes(k));
    });
  }
  // Variants are only usable for matching if their option references point at our option values.
  function variantsUsable(p) {
    const vs = (p && p.variants) || [];
    if (!vs.length) return false;
    const vals = [];
    (p.options || []).forEach((o) => (o.values || []).forEach((v) => valKeys(v).map(normKey).forEach((k) => vals.push(k))));
    return vs.some((vr) => variantKeys(vr).map(normKey).some((k) => vals.includes(k)));
  }
  function stockOf(p, vr) {
    if (unlimited(p)) return Infinity;
    if (vr && typeof vr.quantity === 'number') return Math.max(0, vr.quantity);
    // خيار كميته null = مش معروف: كمية الأب تتاخد لو موجبة، و0 منها مش معناها «نفد»
    if (p && typeof p.quantity === 'number' && (p.quantity > 0 || !vr)) return Math.max(0, p.quantity);
    return Infinity;
  }
  // منتج مختصر من غير بيانات خيارات (نتايج البحث، /shop، /latest، المقترحة) — المخزون والخيارات مش معروفين، وvariantsCount: 0 بس هو اللي بيأكد إنه بسيط
  const partialProduct = (p) => !!p && p.variants === undefined && p.options === undefined && p.variantsCount !== 0;
  function productStock(p) {
    if (!p || unlimited(p) || partialProduct(p)) return Infinity;
    const vs = p.variants || [];
    if (vs.length && vs.some((v) => typeof v.quantity === 'number')) return vs.reduce((a, v) => a + Math.max(0, Number(v.quantity) || 0), 0);
    // منتج بخيارات وكميته 0 من غير كميات متغيرات = مش معروف، مش «نفد»
    if (((p.options || []).length > 0 || vs.length > 0 || (p.variantsCount || 0) > 0) && !(p.quantity > 0)) return Infinity;
    return typeof p.quantity === 'number' ? Math.max(0, p.quantity) : Infinity;
  }

  /* Shared variant picker (product page + quick-add drawer) */
  function pickerMixin(product) {
    return {
      product: product || {},
      selected: [],
      variant: null,
      quantity: 1,
      resolving: false,
      optionError: '',
      qtyMsg: '',
      gallery: 0,

      get options() { return (this.product.options || []).filter((o) => (o.values || []).length); },
      imageIndexForValue(v) {
        try {
          const url = v && v.image && (v.image.fileUrl || v.image.url);
          if (!url) return -1;
          const imgs = this.product.images || [];
          const i = imgs.findIndex((im) => im && (im.fileUrl === url || im.url === url));
          return i;
        } catch (e) { return -1; }
      },
      syncGalleryToSelection() {
        // لما اللون يتغير: لو اللون ليه صورة مطابقة في معرض المنتج، اعرضها فوراً
        try {
          const opts = this.options;
          for (let i = 0; i < opts.length; i++) {
            if (isColorOpt(opts[i]) && this.selected[i]) {
              const idx = this.imageIndexForValue(this.selected[i]);
              if (idx >= 0) { this.gallery = idx; return; }
            }
          }
          // لو الـ variant نفسه ليه صورة، استخدمها
          const vu = this.variant && (this.variant.image || this.variant.featuredImage);
          const vuUrl = vu && (vu.fileUrl || vu.url || vu.src);
          if (vuUrl) {
            const imgs = this.product.images || [];
            const j = imgs.findIndex((im) => im && (im.fileUrl === vuUrl || im.url === vuUrl));
            if (j >= 0) { this.gallery = j; return; }
          }
        } catch (e) {}
      },
      pickerInit() {
        const opts = this.options;
        this.selected = opts.map(() => null);
        this.variant = null;
        this.optionError = '';
        this.gallery = 0;
        // preselect من الرابط (?color=أحمر&size=M) — مفيد لما تدوس لون من كارت المنتج
        let urlColor = null, urlSize = null;
        try {
          const q = new URLSearchParams(window.location.search);
          urlColor = q.get('color'); urlSize = q.get('size');
        } catch (e) {}
        opts.forEach((o, i) => {
          const vals = o.values || [];
          if (urlColor && isColorOpt(o)) {
            const f = vals.findIndex((v) => normKey(valLabel(v)) === normKey(urlColor) || valKeys(v).map(normKey).includes(normKey(urlColor)));
            if (f >= 0 && this.isAvailable(i, f)) { this.selected.splice(i, 1, vals[f]); return; }
          }
          if (urlSize && !isColorOpt(o)) {
            const f = vals.findIndex((v) => normKey(valLabel(v)) === normKey(urlSize));
            if (f >= 0 && this.isAvailable(i, f)) { this.selected.splice(i, 1, vals[f]); return; }
          }
          // Like the live site: colour (and single-value options) preselected, size must be chosen.
          if (isColorOpt(o) || vals.length === 1) {
            const vi = vals.findIndex((v, k) => this.isAvailable(i, k));
            this.selected.splice(i, 1, vals[vi >= 0 ? vi : 0]);
          }
        });
        this.syncVariant(true);
        this.syncGalleryToSelection();
      },
      valueAt(i, vi) { return ((this.options[i] || {}).values || [])[vi]; },
      valueLabel(v) { return valLabel(v); },
      isColor(o) { return isColorOpt(o); },
      swatchColor(v) {
        if (!isObj(v)) return resolveSwatch(v);
        return resolveSwatch(v.color || v.hex || v.swatch || v.value || v.label || v.name);
      },
      get inCartText() { return tr('inCartCount', 'You have {count} in your cart', { count: this.inCart }); },
      // مقارنة بالـ keys (مش reference) عشان تفضل شغالة حتى لو الـ product اتعمله re-render
      isSelected(i, vi) {
        const v = this.valueAt(i, vi);
        const s = this.selected[i];
        if (!v || !s) return false;
        if (s === v) return true;
        const sk = valKeys(s).map(normKey);
        return valKeys(v).map(normKey).some((k) => sk.includes(k));
      },
      selectedLabel(i) { return this.selected[i] ? valLabel(this.selected[i]) : ''; },
      // Compatibility (hierarchical, like Shopify): a value is available if some in-stock variant matches it
      // together with the choices made in the options *before* it (e.g. sizes depend on the chosen colour,
      // but every colour that has any stock stays clickable — choosing it clears an incompatible size).
      isAvailable(i, vi) {
        const p = this.product;
        const v = this.valueAt(i, vi);
        if (!v) return false;
        if (unlimited(p)) return true;
        if (variantsUsable(p)) {
          const cand = this.selected.map((s, j) => (j < i ? s : null));
          cand[i] = v;
          // لو ولا variant فيه ستوك أصلاً، خلي الزراير قابلة للضغط عشان اليوزر يشوف رسالة النفاذ بدل زراير ميتة
          const anyStock = p.variants.some((vr) => stockOf(p, vr) > 0);
          if (!anyStock) return true;
          return p.variants.some((vr) => variantMatches(vr, cand) && stockOf(p, vr) > 0);
        }
        if (isObj(v) && typeof v.quantity === 'number') return v.quantity > 0;
        return productStock(p) > 0;
      },
      choose(i, vi) {
        const v = this.valueAt(i, vi);
        if (!v) return;
        if (!this.isAvailable(i, vi)) return;
        const wasColor = isColorOpt(this.options[i]);
        this.selected.splice(i, 1, v);
        // drop other choices that became incompatible with this one
        this.selected.forEach((s, j) => {
          if (j !== i && s) {
            const idx = (this.options[j].values || []).findIndex((x) => x === s || this.sameValue(x, s));
            if (idx < 0 || !this.isAvailable(j, idx)) this.selected.splice(j, 1, null);
          }
        });
        this.optionError = '';
        this.syncVariant();
        // اللون اتغير → غيّر الصورة المعروضة فوراً (أهم طلب)
        if (wasColor) {
          const gi = this.imageIndexForValue(v);
          if (gi >= 0) this.gallery = gi;
          else this.syncGalleryToSelection();
        } else {
          this.syncGalleryToSelection();
        }
      },
      sameValue(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const ak = valKeys(a).map(normKey);
        return valKeys(b).map(normKey).some((k) => ak.includes(k));
      },
      get complete() { return this.selected.every((s) => s != null); },
      get missingOption() { const i = this.selected.findIndex((s) => s == null); return i >= 0 ? this.options[i] : null; },
      async syncVariant(skipGallery) {
        const p = this.product;
        if (!this.options.length || !this.complete) { this.variant = null; this.clampQty(); return; }
        if (variantsUsable(p)) {
          this.variant = p.variants.find((vr) => variantMatches(vr, this.selected)) || null;
          this.clampQty();
          if (!skipGallery) this.syncGalleryToSelection();
          return;
        }
        const ids = this.selected.map((s) => (isObj(s) ? s._id : null)).filter(Boolean);
        if (!p._id || /^demo-/.test(p._id) || ids.length !== this.selected.length) { this.variant = null; this.clampQty(); return; }
        this.resolving = true;
        try {
          const r = await api('/ajax/product/resolve-variant-by-options', { productId: p._id, options: ids, quantity: this.quantity });
          this.variant = r && (r._id ? r : (r.variant || r.data || null));
        } catch (e) { this.variant = null; }
        finally { this.resolving = false; this.clampQty(); if (!skipGallery) this.syncGalleryToSelection(); }
      },
      get price() { const v = priceOf(this.variant); return v != null ? v : (priceOf(this.product) || 0); },
      get compareAt() { const v = compareOf(this.variant); return v != null ? v : (compareOf(this.product) || 0); },
      get onSale() { return this.compareAt > this.price; },
      get discount() { return this.onSale ? Math.floor(((this.compareAt - this.price) / this.compareAt) * 100) : 0; },
      get stock() {
        if (this.options.length && !this.complete) return productStock(this.product);
        return stockOf(this.product, this.variant);
      },
      get inCart() { return Alpine.store('mw').inCart(this.product._id, this.variant && this.variant._id); },
      get available() { return this.stock === Infinity ? Infinity : Math.max(0, this.stock - this.inCart); },
      get soldOut() { return this.stock <= 0; },
      get lowStock() { return this.stock !== Infinity && this.stock > 0 && this.stock <= LOW_STOCK; },
      get maxQty() { return this.available === Infinity ? 99 : Math.max(0, this.available); },
      get atMax() { return this.maxQty > 0 && this.quantity >= this.maxQty; },
      get stockMessage() {
        if (this.soldOut) return { kind: 'out', text: this.options.length && this.complete ? tr('variantSoldOut', 'This option is sold out') : tr('soldOut', 'Sold out') };
        if (this.stock !== Infinity && this.inCart > 0 && this.available <= 0) return { kind: 'max', text: tr('allInCart', 'All available pieces ({count}) are already in your cart', { count: this.stock }) };
        if (this.lowStock) return { kind: 'low', text: tr('onlyLeft', 'Almost sold out — only {count} left', { count: this.stock }) };
        // قبل اختيار المتغير: الحالة من مجموع مخزون المتغيرات (PRD-24 / PRD-25)
        return { kind: 'in', text: tr('inStock', 'In stock') };
      },
      get sku() { return (this.variant && this.variant.sku) || this.product.sku || ''; },
      inc() {
        this.qtyMsg = '';
        if (this.quantity < this.maxQty) this.quantity = (parseInt(this.quantity, 10) || 0) + 1;
        else { this.qtyMsg = tr('maxReached', 'Only {count} available', { count: this.maxQty }); Alpine.store('mw').toast(this.qtyMsg, 'error'); }
      },
      dec() { this.qtyMsg = ''; if (this.quantity > 1) this.quantity = (parseInt(this.quantity, 10) || 2) - 1; },
      /* PRD-06 / PRD-07: الكمية 1…المتاح — 0 / سالب / حروف بتتصحح لـ 1، والأكبر من المخزون بيتصحح للحد الأقصى مع رسالة */
      clampQty(withMsg) {
        const max = Math.max(1, this.maxQty);
        const raw = String(this.quantity == null ? '' : this.quantity).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
        const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
        let q = n;
        let msg = '';
        if (!(n >= 1)) { q = 1; if (withMsg && raw !== '1') msg = tr('qtyInvalid', 'Enter a quantity of 1 or more'); }
        else if (n > max) { q = max; if (withMsg) msg = tr('maxReached', 'Only {count} available', { count: max }); }
        this.quantity = q;
        if (withMsg) this.qtyMsg = msg;
      },
      /* REG-10 / REG-11: أول خيار ناقص بالاسم + الصفحة تنزل عنده */
      flagMissing() {
        const o = this.missingOption;
        this.optionError = tr('selectOption', 'Please select {name}', { name: o ? o.name : '' });
        const i = this.selected.findIndex((x) => x == null);
        this.$nextTick(() => {
          const fs = this.$root.querySelector('[data-option-index="' + i + '"]') || this.$root.querySelector('.mw-pdp__option');
          if (fs && fs.scrollIntoView) fs.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      },
      async submit(buy) {
        if (this.options.length && !this.complete) { this.flagMissing(); return false; }
        if (this.soldOut) { Alpine.store('mw').toast(tr('soldOut', 'Out of stock'), 'error'); return false; }
        this.clampQty(false);
        return Alpine.store('mw').add(this.product._id, this.quantity, this.variant && this.variant._id, {
          stock: this.stock, buy: !!buy, title: this.product.title
        });
      }
    };
  }

  /* ---------- Demo data (preview only) ---------- */
  const DEMO_PRODUCTS = {};
  const isDemoId = (id) => /^demo-/.test(String(id || ''));
  function demoUrl(id, key) {
    const params = new URLSearchParams(window.location.search);
    ['demo_product', 'demo_collection'].forEach((k) => params.delete(k));
    params.set(key || 'demo_product', id);
    return '/?' + params.toString();
  }
  const COLOR_NAMES = { '#111111': 'Black', '#000000': 'Black', '#1a1a1a': 'Black', '#ffffff': 'White', '#f4f4f4': 'Off White', '#efeee8': 'Off White', '#a9a9a9': 'Grey', '#d9d9d9': 'Light Grey', '#555555': 'Charcoal', '#4a4a4a': 'Charcoal', '#5c5c5c': 'Dark Grey', '#444444': 'Dark Grey', '#7f9fbf': 'Light Blue', '#2b3f8f': 'Navy', '#4c7a34': 'Olive', '#2e5e3a': 'Forest Green', '#1f4d36': 'Green', '#a30d0d': 'Red', '#3fb6c4': 'Turquoise', '#6b4b8a': 'Purple', '#c8b89a': 'Sand', '#7a1f2b': 'Burgundy' };
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function demoProduct(d) {
    if (DEMO_PRODUCTS[d._id]) return DEMO_PRODUCTS[d._id];
    const base = (window.MW_DEMO && window.MW_DEMO.imageBase) || '';
    const id = d._id;
    const price = Math.round((d.price || 0) * Money.divisor);
    const compare = Math.round((d.compare || 0) * Money.divisor);
    const colors = (d.swatches || []).slice(0, 4);
    const sizes = d.sizes || ['S', 'M', 'L', 'XL'];
    const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
    const soldOutAll = n % 9 === 5;                 // a few products are completely sold out
    const colorVals = colors.map((c, i) => ({ _id: id + '-c' + i, label: (d.colorNames && d.colorNames[i]) || COLOR_NAMES[c] || 'Color ' + (i + 1), color: c }));
    const sizeVals = sizes.map((s, i) => ({ _id: id + '-s' + i, label: s }));
    const variants = [];
    (colorVals.length ? colorVals : [null]).forEach((c) => sizeVals.forEach((s) => {
      const h = hash(id + (c ? c._id : '') + s._id) % 14;
      const qty = soldOutAll ? 0 : (h < 3 ? 0 : (h < 6 ? h - 2 : h + 4)); // mix of sold out, low (1-3) and normal stock
      variants.push({ _id: id + '-v' + variants.length, options: [c && c._id, s._id].filter(Boolean), quantity: qty, price, compareAtPrice: compare });
    }));
    const fix = (u) => (/^(https?:|data:)/.test(u) ? u : base + u + '?width=720');
    // صور لكل لون (colorImages[i] ↔ swatches[i]) — اختيار اللون بيغيّر الصورة في الكارت وصفحة المنتج
    const perColor = (d.colorImages || []).slice(0, colors.length).map((l) => (l || []).map(fix));
    const cardImages = perColor[0] && perColor[0].length ? perColor[0] : (d.images || []).map(fix);
    const images = perColor.length ? [].concat.apply([], perColor) : cardImages;
    colorVals.forEach((v, i) => { if (perColor[i] && perColor[i][0]) v.image = { fileUrl: perColor[i][0] }; });
    const full = {
      _id: id, title: d.title, slug: id, handle: id, __demo: true,
      pricing: { price, compareAtPrice: compare },
      images: images.map((u) => ({ fileUrl: u })),
      options: [colorVals.length ? { name: tr('color', 'Color'), values: colorVals } : null, { name: tr('size', 'Size'), values: sizeVals }].filter(Boolean),
      variants, trackQuantity: true, quantity: variants.reduce((a, v) => a + v.quantity, 0),
      reviewsCount: d.reviews || 0, averageRating: d.rating || 0
    };
    const p = {
      _id: id, __demo: true, title: d.title, fit: d.fit || '', handle: id,
      price, compare, rating: d.rating || 0, reviews: d.reviews || 0,
      images, cardImages, sizes, url: demoUrl(id),
      swatches: colorVals.map((v, i) => ({ label: v.label, color: v.color, img: perColor[i] && perColor[i][0], img2: perColor[i] && perColor[i][1] })),
      hasOptions: true, stock: productStock(full), full
    };
    DEMO_PRODUCTS[id] = p;
    return p;
  }
  const cartProductLoads = new Set();
  const DemoCart = (function () {
    const KEY = 'mw-demo-cart-v2';
    // لو المتصفح مانع localStorage (زي معاينة المحرر جوه iframe في بعض المتصفحات) السلة تفضل شغالة من الذاكرة
    const clone = (v) => v.map((i) => Object.assign({}, i));
    let mem = [];
    let stored = true;
    const read = () => {
      if (!stored) return clone(mem);
      try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { stored = false; return clone(mem); }
    };
    const write = (v) => { mem = clone(v); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { stored = false; } };
    const k = (i) => i.id + '|' + (i.vid || '');
    return {
      items: read,
      add(id, vid, qty) { const v = read(); const ex = v.find((i) => k(i) === id + '|' + (vid || '')); if (ex) ex.qty += qty; else v.push({ id, vid: vid || null, qty }); write(v); },
      set(key, qty) { write(read().map((i) => (k(i) === key ? Object.assign({}, i, { qty }) : i)).filter((i) => i.qty > 0)); },
      remove(key) { write(read().filter((i) => k(i) !== key)); },
      // تغيير لون سطر في السلة: نفس المكان، ولو اللون الجديد موجود أصلاً بيتدمج معاه
      replace(key, id, vid, qty) {
        const v = read();
        const at = v.findIndex((i) => k(i) === key);
        const ex = v.find((i) => k(i) === id + '|' + (vid || ''));
        if (ex) { ex.qty += qty; if (at >= 0) v.splice(at, 1); }
        else if (at >= 0) v[at] = { id, vid: vid || null, qty };
        else v.push({ id, vid: vid || null, qty });
        write(v);
      }
    };
  })();
  function demoCartItems() {
    return DemoCart.items().map((i) => {
      const p = DEMO_PRODUCTS[i.id];
      if (!p) return null;
      const vr = i.vid ? (p.full.variants || []).find((v) => v._id === i.vid) : null;
      const label = vr ? (vr.options || []).map((oid) => {
        for (const o of p.full.options) { const v = o.values.find((x) => x._id === oid); if (v) return v.label; }
        return '';
      }).filter(Boolean).join(' / ') : '';
      // صورة اللون المختار في السلة
      let vImg = '';
      if (vr) p.full.options.forEach((o) => o.values.forEach((v) => { if (!vImg && v.image && (vr.options || []).includes(v._id)) vImg = v.image.fileUrl; }));
      return {
        _id: i.id + '|' + (i.vid || ''), productId: i.id, variantId: i.vid || null, variantTitle: label, quantity: i.qty, __demo: true,
        price: p.price, compareAtPrice: p.compare, totalPrice: p.price * i.qty,
        totalCompareAtPrice: (p.compare || p.price) * i.qty, totalSavings: p.compare > p.price ? (p.compare - p.price) * i.qty : 0,
        __stock: stockOf(p.full, vr),
        productData: { title: p.title, handle: '', url: p.url, image: { fileUrl: vImg || p.images[0] || '' } }
      };
    }).filter(Boolean);
  }

  /* ---------- Card markup (mirror of ui/product-card.njk) ---------- */
  const BAG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 8.5h13l-.9 11.2a1.5 1.5 0 0 1-1.5 1.3H7.9a1.5 1.5 0 0 1-1.5-1.3L5.5 8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.1l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8L12 2.5Z"/></svg>';
  // منتج واحد، منتجان، 3 منتجات، 11 منتج
  function countLabel(n) {
    const m = n % 100;
    const key = n === 1 ? 'countOne' : (n === 2 ? 'countTwo' : (m >= 3 && m <= 10 ? 'countFew' : 'countMany'));
    return tr(key, '{count} products').replace('{count}', String(n));
  }
  function discountLabel(d) {
    return CFG.lang === 'ar' || !CFG.lang ? '%' + d + ' ' + esc(tr('off', 'خصم')) : d + '% ' + esc(tr('off', 'OFF'));
  }
  // Normalise a product from the API (search / quick add) into card data
  function apiToCard(p) {
    const colorOpt = (p.options || []).find(isColorOpt);
    const fitTag = (p.tags || []).map((t) => (t && typeof t === 'object' ? (t.name || t.displayName || t.title || t.label || t.value || '') : String(t || ''))).find((t) => /fit/i.test(t)); /* live tags are objects */
    const fitText = fitTag ? fitTag.split(':').pop() : '';
    return {
      _id: p._id, title: p.title, handle: p.slug || p.handle, url: '/products/' + (p.slug || p.handle),
      price: priceOf(p) || 0, compare: compareOf(p) || 0,
      images: (p.images || []).map((i) => i && i.fileUrl).filter(Boolean),
      fit: p.subtitle || fitText, rating: p.averageRating || 0, reviews: p.reviewsCount || 0,
      swatches: colorOpt ? (colorOpt.values || []).map((v) => ({ label: valLabel(v), color: resolveSwatch(isObj(v) ? (v.color || v.hex || v.swatch || v.value || v.label) : v), img: isObj(v) ? imgUrl(v.image) : '' })) : [],
      hasOptions: (p.options || []).length > 0 || (p.variants || []).length > 0 || (p.variantsCount || 0) > 0 || partialProduct(p), stock: productStock(p),
      facets: [].concat(
        (p.tags || []).map((t) => (t && typeof t === 'object' ? String(t.name || t.displayName || t.title || t.label || t.value || '') : String(t))).filter((t) => t.indexOf(':') > 0),
        [].concat.apply([], (p.options || []).filter((o) => o && o.name).map((o) => (o.values || []).map((v) => o.name + ':' + valLabel(v))))
      )
    };
  }
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  // #1, #2… mean a rating order: with no ratings in the list they mean nothing
  const rankedCards = (el, list) => {
    const ranked = el.dataset.mwDemoRank && list.some((p) => Number(p.rating) > 0 || Number(p.reviews) > 0);
    return list.map((p, i) => cardHTML(p, ranked ? i + 1 : 0)).join('');
  };
  function cardHTML(p, rank) {
    const onSale = p.compare > p.price;
    const disc = onSale ? Math.floor(((p.compare - p.price) / p.compare) * 100) : 0;
    const promo = CFG.promo || '';
    const out = p.stock <= 0;
    const low = p.stock !== Infinity && p.stock > 0 && p.stock <= LOW_STOCK;
    const pid = esc(p._id);
    const ci = p.cardImages || p.images;
    const imgs = ci.length
      ? '<img src="' + esc(ci[0]) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async" width="600" height="800"/>' +
        (ci[1] ? '<img class="mw-card__img--hover" src="' + esc(ci[1]) + '" alt="" loading="lazy" decoding="async" width="600" height="800"/>' : '')
      : '';
    const sw = p.swatches.length > 1
      ? '<div class="mw-card__swatches">' + p.swatches.slice(0, 9).map((s, i) => {
          const c = (s && s.color) || resolveSwatch(s && s.label || s);
          const label = (s && s.label) || s;
          const imgs = (s && s.img ? ' data-img="' + esc(s.img) + '"' : '') + (s && s.img2 ? ' data-img2="' + esc(s.img2) + '"' : '');
          return '<button type="button" class="mw-card__swatch' + (i === 0 ? ' is-active' : '') + '" style="--sw: ' + esc(c) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '" data-color="' + esc(label) + '"' + imgs + ' onclick="window.mwCardSwatch&&window.mwCardSwatch(this)"><span></span></button>';
        }).join('') + '</div>'
      : '';
    const actions = out
      ? '<button type="button" class="mw-card__btn mw-card__btn--soldout" disabled>' + esc(tr('soldOut', 'Sold out')) + '</button>'
      : '<button type="button" class="mw-card__btn mw-card__btn--add" @click="$store.mw.cardAction($el, \'add\')" :disabled="$store.mw.isBusy(\'add:' + pid + '\')">' + (p.hasOptions ? '' : BAG) + '<span>' + esc(p.hasOptions ? tr('chooseOptions', 'Choose options') : tr('addToCart', 'Add to cart')) + '</span></button>' +
        '<button type="button" class="mw-card__btn mw-card__btn--buy" @click="$store.mw.cardAction($el, \'buy\')" :disabled="$store.mw.isBusy(\'add:' + pid + '\')"><span>' + esc(tr('buyNow', 'Buy now')) + '</span></button>';
    const wish = CFG.wishlist ? '<button type="button" class="mw-wish" :class="{ \'is-on\': $store.mw.isWished(\'' + pid + '\') }" :aria-pressed="$store.mw.isWished(\'' + pid + '\').toString()" @click="$store.mw.toggleWish(\'' + pid + '\')" aria-label="' + esc(tr('wishToggle', 'Wishlist')) + '">' + HEART + '</button>' : '';
    const imgsOrPh = imgs || '<span class="mw-card__placeholder" role="img" aria-label="' + esc(p.title) + '"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.5 3.5 4 6l1.5 4H8V20.5h8V10h2.5L20 6l-4.5-2.5c-.6 1.4-1.9 2.3-3.5 2.3S9.1 4.9 8.5 3.5Z" stroke="currentColor" stroke-width=".8" stroke-linejoin="round"/></svg></span>';
    return '<article class="mw-card' + (out ? ' is-soldout' : '') + '" x-data data-mw-card data-id="' + pid + '" data-handle="' + esc(p.handle || '') + '" data-url="' + esc(p.url) + '" data-options="' + (p.hasOptions ? '1' : '0') + '" data-stock="' + (p.stock === Infinity ? -1 : p.stock) + '" data-price="' + p.price + '" data-rating="' + (p.rating || 0) + '" data-title="' + esc(p.title) + '" data-facets="' + esc((p.facets || []).join('|')) + '">' +
      '<div class="mw-card__media">' +
        '<a href="' + esc(p.url) + '" tabindex="-1" aria-hidden="true">' + imgsOrPh + '</a>' +
        (rank ? '<span class="mw-card__rank">#' + rank + '</span>' : '') +
        '<div class="mw-card__badges">' +
          (out ? '<span class="mw-badge mw-badge--soldout">' + esc(tr('soldOut', 'Out of stock')) + '</span>'
               : (disc > 0 ? '<span class="mw-badge mw-badge--discount">' + discountLabel(disc) + '</span>' : '') +
                 (low ? '<span class="mw-badge mw-badge--low">' + esc(tr('lowBadge', 'Almost gone')) + '</span>' : '') +
                 (promo ? '<span class="mw-badge mw-badge--promo">' + esc(promo) + '</span>' : '')) +
        '</div>' + wish +
      '</div>' + sw +
      '<div class="mw-card__info">' +
        '<h3 class="mw-card__title"><a href="' + esc(p.url) + '" title="' + esc(p.title) + '">' + esc(p.title) + '</a></h3>' +
        (p.fit ? '<p class="mw-card__fit">' + esc(p.fit) + '</p>' : '') +
        '<div class="mw-price">' +
          (onSale ? '<s>' + Money.fmt(p.compare) + '</s><span class="is-sale">' + Money.fmt(p.price) + '</span>' : '<span>' + (Number(p.price) > 0 ? Money.fmt(p.price) : esc(tr('free', 'Free'))) + '</span>') +
        '</div>' +
        (p.reviews > 0 ? '<div class="mw-rating">' + STAR + '<span class="mw-rating__value">' + p.rating + '</span><span class="mw-rating__count">(' + p.reviews + ')</span></div>' : '') +
        (low ? '<p class="mw-stock mw-stock--low">' + esc(tr('onlyLeftShort', 'Only {count} left', { count: p.stock })) + '</p>' : '') +
      '</div>' +
      (CFG.cardButtons === false ? '' : '<div class="mw-card__actions">' + actions + '</div>') +
    '</article>';
  }

  /* =========================================================
     Search — suggestions + products available by name
     Uses /ajax/search/products and /ajax/search/suggest in parallel (both documented),
     Arabic-tolerant matching (أ/إ/آ = ا, ة = ه, ى = ي, no tashkeel) and in-stock products first.
     ========================================================= */
  const AR_MARKS = /[ً-ْٰـ]/g;
  function normText(s) {
    return String(s || '').toLowerCase().replace(AR_MARKS, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/\s+/g, ' ').trim();
  }
  function queryRegex(q) {
    const cls = { 'ا': '[اأإآٱ]', 'ه': '[هة]', 'ي': '[يىئ]', 'و': '[وؤ]' };
    const parts = Array.from(normText(q)).map((ch) => (ch === ' ' ? '\\s+' : (cls[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    return new RegExp(parts.join('[\\u064B-\\u0652\\u0670\\u0640]*'), 'i');
  }
  function highlight(text, q) {
    const s = String(text == null ? '' : text);
    if (!q || !normText(q)) return esc(s);
    let m = null;
    try { m = s.match(queryRegex(q)); } catch (e) { m = null; }
    if (!m) return esc(s);
    return esc(s.slice(0, m.index)) + '<mark>' + esc(m[0]) + '</mark>' + esc(s.slice(m.index + m[0].length));
  }
  const matchesAll = (text, q) => { const t = normText(text); return normText(q).split(' ').every((w) => t.includes(w)); };
  const listOf = (d) => (d && (d.products || d.items || d.data || d.results)) || (Array.isArray(d) ? d : []);
  function parseSuggest(d) {
    const pick = (x) => (typeof x === 'string' ? x : (x && (x.text || x.query || x.title || x.name || x.value)));
    const terms = [];
    const cols = [];
    const prods = [];
    if (!d) return { terms, cols, prods };
    [d.suggestions, d.queries, d.terms, d.keywords, d.data && d.data.queries].forEach((arr) => (Array.isArray(arr) ? arr : []).forEach((x) => { const t = pick(x); if (t) terms.push(String(t)); }));
    const res = (d.resources && (d.resources.results || d.resources)) || d.results || d.data || d;
    (Array.isArray(res.collections) ? res.collections : []).forEach((c) => { if (c && c.title) cols.push({ title: c.title, url: c.url || '/collections/' + (c.handle || c.slug), image: (c.image && c.image.fileUrl) || '' }); });
    (Array.isArray(res.products) ? res.products : []).forEach((p) => { if (p && p.title) prods.push(p); });
    return { terms, cols, prods };
  }
  function stockLabel(p) {
    if (p.stock <= 0) return { kind: 'out', text: tr('soldOut', 'Out of stock') };
    if (p.stock !== Infinity && p.stock <= LOW_STOCK) return { kind: 'low', text: tr('onlyLeftShort', 'Only {count} left', { count: p.stock }) };
    return { kind: 'in', text: tr('inStock', 'In stock') };
  }
  const SearchEngine = {
    cache: new Map(),
    async run(q) {
      const key = normText(q);
      if (this.cache.has(key)) return this.cache.get(key);
      let products = [];
      let terms = [];
      let cols = [];
      if (isPreview() && window.MW_DEMO) {
        products = Object.values(DEMO_PRODUCTS).filter((p) => matchesAll(p.title + ' ' + p.fit, q));
        cols = (window.MW_DEMO.cats || []).filter((c) => matchesAll(c.title, q))
          .map((c) => ({ title: c.title, url: demoUrl('demo-c-' + c.title.toLowerCase(), 'demo_collection'), image: c.image }));
      } else {
        const [pr, sg] = await Promise.allSettled([
          api('/ajax/search/products?' + new URLSearchParams({ q, limit: '24' })),
          api('/ajax/search/suggest?' + new URLSearchParams({ q, 'resources[type]': 'product,collection', 'resources[limit]': '8' }))
        ]);
        if (pr.status === 'rejected' && sg.status === 'rejected') throw pr.reason;
        if (pr.status === 'fulfilled') products = listOf(pr.value).map(apiToCard);
        if (sg.status === 'fulfilled') {
          const s = parseSuggest(sg.value);
          terms = s.terms;
          cols = s.cols;
          if (!products.length) products = s.prods.map(apiToCard);
        }
      }
      // one entry per product (and per title, so colour duplicates don't flood the list)
      const seen = new Set();
      products = products.filter((p) => { const k = p._id + '|' + normText(p.title); if (seen.has(p._id) || seen.has(k)) return false; seen.add(p._id); seen.add(k); return true; });
      // in-stock first, then low stock, sold out last
      const rank = (p) => (p.stock <= 0 ? 2 : (p.stock !== Infinity && p.stock <= LOW_STOCK ? 1 : 0));
      products = products.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
      // suggestions: from the API, completed with matching product names / fits
      const nq = normText(q);
      const sugg = [];
      const addS = (t) => { const n = normText(t); if (t && n && n !== nq && !sugg.some((x) => normText(x) === n)) sugg.push(String(t).trim()); };
      terms.forEach(addS);
      products.forEach((p) => { addS(p.title); if (p.fit && matchesAll(p.fit, q)) addS(p.fit); });
      const out = {
        products,
        terms: sugg.slice(0, 6),
        cols: cols.slice(0, 4),
        available: products.filter((p) => p.stock > 0).length
      };
      this.cache.set(key, out);
      return out;
    }
  };
  const RECENT_KEY = 'mw-recent-searches';
  function readRecent() { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 6) : []; } catch (e) { return []; } }
  function saveRecent(q) {
    try {
      if (q == null) { localStorage.removeItem(RECENT_KEY); return []; }
      const t = String(q).trim();
      if (!t) return readRecent();
      const list = [t].concat(readRecent().filter((x) => normText(x) !== normText(t))).slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      return list;
    } catch (e) { return []; }
  }

  function renderDemos() {
    const D = window.MW_DEMO;
    if (!D) return;
    document.querySelectorAll('[data-mw-demo]').forEach((el) => {
      if (el.children.length) return;
      const kind = el.dataset.mwDemo;
      const limit = parseInt(el.dataset.mwDemoLimit || '10', 10);
      if (kind === 'cats' || kind === 'collections') {
        el.innerHTML = D.cats.map((c) =>
          '<a href="' + esc(demoUrl('demo-c-' + c.title.toLowerCase(), 'demo_collection')) + '" class="mw-cat"><div class="mw-cat__media"><img src="' + esc(c.image) + '" alt="' + esc(c.title) + '" loading="lazy" width="600" height="800"/></div><span class="mw-cat__label">' + esc(c.title) + '</span></a>').join('');
      } else if (kind === 'fcols') {
        el.innerHTML = D.fcols.map((c) =>
          '<a href="' + esc(demoUrl('demo-c-all', 'demo_collection')) + '" class="mw-fcol"><img src="' + esc(c.image) + '" alt="' + esc(c.title) + '" loading="lazy" width="600" height="800"/><h3 class="mw-fcol__title">' + esc(c.title) + '</h3></a>').join('');
      } else {
        const list = (D.sets[kind] || []).slice(0, limit).map(demoProduct);
        el.innerHTML = kind === 'look'
          ? list.map((p, i) => '<div ' + (i ? 'x-cloak ' : '') + 'x-show="i === ' + i + '">' + cardHTML(p) + '</div>').join('')
          : rankedCards(el, list);
      }
      const empty = el.parentElement && el.parentElement.querySelector('[data-mw-empty]');
      if (empty) empty.remove();
      el.dispatchEvent(new CustomEvent('mw:demo-rendered', { bubbles: true }));
    });
    document.querySelectorAll('.mw-look__media').forEach((m) => {
      if (m.querySelector('img') || !D.lookImage) return;
      m.insertAdjacentHTML('afterbegin', '<img src="' + esc(D.lookImage) + '" alt="" loading="lazy" width="900" height="1200"/>');
    });
    Alpine.store('mw').syncDemo();
  }

  /* ---------- منتجات حقيقية من المتجر (AJAX) ---------- */
  async function fetchProducts(opts) {
    const o = opts || {};
    const qs = new URLSearchParams({ q: o.q || '', sort: o.sort || 'created-desc', limit: String(o.limit || 8) });
    if (o.collectionId) qs.set('collectionId', o.collectionId);
    let d;
    try { d = await api('/ajax/search/products?' + qs); }
    catch (e) { qs.delete('limit'); d = await api('/ajax/search/products?' + qs); }
    return listOf(d).filter((p) => p && p._id && p.title);
  }

  /* المتجر الحي (من غير منتجات توضيحية): «وصل حديثاً» و«الأكثر مبيعاً» اللي التاجر ما اختارلهاش منتجات بتتملا من منتجات المتجر الحقيقية؛
     لو مفيش منتجات خالص القسم بيفضل مخفي (CSS :has) — مفيش منتجات وهمية قدام العملاء (HOME-11 / EDGE-01). */
  async function fillLiveSections() {
    const els = Array.from(document.querySelectorAll('.mw-section--featured [data-mw-demo]')).filter((el) => !el.children.length);
    for (const el of els) {
      const kind = el.dataset.mwDemo;
      const limit = parseInt(el.dataset.mwDemoLimit || '8', 10) || 8;
      try {
        const list = (await fetchProducts({ sort: kind === 'best' ? 'rating-desc' : 'created-desc', limit })).slice(0, limit).map(apiToCard);
        if (list.length) el.innerHTML = rankedCards(el, list);
      } catch (e) { /* القسم بيفضل مخفي */ }
    }
    // تبويبات من غير منتجات: زرار التبويب بيستخبى (والقسم كله لو كل التبويبات فاضية — CSS)
    document.querySelectorAll('.mw-tabbed').forEach((sec) => {
      const panels = sec.querySelectorAll('[role="tabpanel"]');
      const tabs = sec.querySelectorAll('[role="tab"]');
      panels.forEach((pn, i) => { const g = pn.querySelector('.mw-products'); if (g && !g.children.length && tabs[i]) tabs[i].hidden = true; });
      const firstFull = Array.from(panels).findIndex((pn) => { const g = pn.querySelector('.mw-products'); return g && g.children.length; });
      if (firstFull > 0 && window.Alpine) { try { window.Alpine.$data(sec).tab = firstFull; } catch (e) { /* ignore */ } }
    });
  }

  function loadDemo() {
    // المنتجات الافتراضية بتملا أي قسم مالوش منتجات حقيقية — في المحرر واللوكال والمعاينة، أو للعملاء لو التاجر فعّل «منتجات توضيحية».
    // الأقسام اللي فيها منتجات حقيقية مش بتتأثر، والسلة مش بتسمح بالدفع بمنتج افتراضي (goCheckout).
    if (!CFG.demoSrc) return;
    if (!demoAllowed()) { fillLiveSections(); return; }
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo_product') || params.get('demo_collection')) document.documentElement.classList.add('mw-demo-page-active');
    const done = () => {
      Object.values((window.MW_DEMO && window.MW_DEMO.sets) || {}).forEach((set) => set.forEach(demoProduct));
      renderDemos();
      window.dispatchEvent(new CustomEvent('mw:demo-ready'));
    };
    if (window.MW_DEMO) return done();
    const s = document.createElement('script');
    s.src = CFG.demoSrc;
    s.onload = done;
    document.head.appendChild(s);
  }

  /* =========================================================
     Alpine
     ========================================================= */
  document.addEventListener('alpine:init', () => {
    const initialCart = readJSON('mw-cart-json') || {};
    const initialWish = readJSON('mw-wishlist-json') || {};
    const wishIds = (initialWish.products || initialWish.items || []).map((x) => String((x && (x.productId || (x.product && x.product._id) || x._id)) || x)).filter(Boolean);

    Alpine.store('mw', {
      cart: Object.assign({ items: [], totalQuantity: 0, totalPrice: 0, totalSavings: 0 }, initialCart),
      busy: {},
      stock: {},          // known stock per product|variant (from product data) — used to cap quantities
      products: {},       // product data per productId for cart lines (colour switching in the cart)
      cartOpen: false,
      quickOpen: false,
      quickTarget: null,
      _toast: null,
      wish: wishIds,
      canShare: !!(navigator.share),

      // Alpine calls this once: re-sync with the server so stock checks use the real cart (pages can be cached)
      init() {
        if (!isPreview()) this.refresh();
      },
      isBusy(key) { return !!this.busy[key]; },
      setBusy(key, v) { this.busy = Object.assign({}, this.busy, { [key]: v }); },
      money(n) { return Money.fmt(n); },
      freeText() { return tr('free', 'Free'); },
      soldOutText() { return tr('soldOut', 'Out of stock'); },
      get placeholder() { return IMG_FB; },
      discountText(d) { return CFG.lang === 'ar' || !CFG.lang ? '%' + d + ' ' + tr('off', 'خصم') : d + '% ' + tr('off', 'OFF'); },
      /* PROMO-08 / REG-19…21: رسالة الشحن المجاني بس لو التاجر كاتب نفس حد العرض المفعّل (0 = مفيش رسالة) */
      get freeShip() { return Number(CFG.freeShip) > 0 ? Number(CFG.freeShip) * Money.divisor : 0; },
      get freeShipLeft() { return Math.max(0, this.freeShip - (Number(this.cart.totalPrice) || 0)); },
      get freeShipPct() { return this.freeShip ? Math.min(100, Math.round(((Number(this.cart.totalPrice) || 0) / this.freeShip) * 100)) : 0; },
      get freeShipText() { return this.freeShipLeft > 0 ? tr('freeShipLeft', 'Add {amount} more for free shipping', { amount: Money.fmt(this.freeShipLeft) }) : tr('freeShipDone', 'Your order ships free'); },
      /* المفضلة (/ajax/wishlist) */
      isWished(id) { return this.wish.indexOf(String(id)) !== -1; },
      async toggleWish(id) {
        id = String(id);
        const on = this.isWished(id);
        this.wish = on ? this.wish.filter((x) => x !== id) : this.wish.concat(id);
        if (isDemoId(id)) { this.toast(tr(on ? 'wishRemoved' : 'wishAdded', on ? 'Removed from wishlist' : 'Added to wishlist'), 'success'); return; }
        try {
          await api('/ajax/wishlist/' + (on ? 'remove' : 'add'), { productId: id });
          this.toast(tr(on ? 'wishRemoved' : 'wishAdded', on ? 'Removed from wishlist' : 'Added to wishlist'), 'success');
        } catch (e) {
          this.wish = on ? this.wish.concat(id) : this.wish.filter((x) => x !== id);
          this.toast(e.userMessage || tr('error', 'Something went wrong. Please try again!'), 'error');
        }
      },
      copyLink(url) {
        const u = url || window.location.href.split('#')[0];
        const ok = () => this.toast(tr('linkCopied', 'Link copied'), 'success');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(ok, () => this.toast(u));
        else { try { const t = document.createElement('textarea'); t.value = u; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); ok(); } catch (e) { this.toast(u); } }
      },
      nativeShare(title) { if (navigator.share) navigator.share({ title: title || document.title, url: window.location.href.split('#')[0] }).catch(() => {}); },
      skey(pid, vid) { return pid + '|' + (vid || ''); },
      itemUrl(item) {
        const d = item.productData || {};
        return d.url || (d.handle ? '/products/' + d.handle : '#');
      },
      inCart(pid, vid) {
        return (this.cart.items || [])
          .filter((i) => i.productId === pid && (!vid || i.variantId === vid))
          .reduce((a, i) => a + (Number(i.quantity) || 0), 0);
      },
      maxFor(item) {
        if (typeof item.__stock === 'number') return item.__stock;
        const s = this.stock[this.skey(item.productId, item.variantId)];
        return typeof s === 'number' && isFinite(s) ? s : Infinity;
      },
      atMax(item) { return item.quantity >= this.maxFor(item); },
      maxText(item) { return tr('maxAvailable', 'Max available: {count}', { count: this.maxFor(item) }); },

      setCart(c, keepDemo) {
        if (!c || !Array.isArray(c.items)) return;
        const real = c.items.filter((i) => !i.__demo);
        const demo = keepDemo === false ? [] : demoCartItems();
        const items = real.concat(demo);
        const sum = (k) => items.reduce((a, i) => a + (Number(i[k]) || 0), 0);
        this.cart = Object.assign({}, c, {
          items,
          totalQuantity: demo.length ? sum('quantity') : (c.totalQuantity != null ? c.totalQuantity : sum('quantity')),
          totalPrice: demo.length ? sum('totalPrice') : (c.totalPrice != null ? c.totalPrice : sum('totalPrice')),
          totalSavings: demo.length ? sum('totalSavings') : (c.totalSavings || 0)
        });
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: this.cart }));
      },
      syncDemo() { this.setCart({ items: this.cart.items.filter((i) => !i.__demo) }); },

      async refresh() {
        try { this.setCart(await api('/ajax/cart')); } catch (e) { /* offline preview */ }
      },

      /* Add to cart / buy now. opts: { stock, buy, title } — stock caps the quantity (including what is already in the cart). */
      async add(productId, quantity, variantId, opts) {
        opts = opts || {};
        quantity = Math.max(1, parseInt(quantity, 10) || 1);
        const key = 'add:' + productId;
        if (this.busy[key]) return false;
        this.setBusy(key, true);
        try {
          if (typeof opts.stock === 'number' && isFinite(opts.stock)) {
            this.stock = Object.assign({}, this.stock, { [this.skey(productId, variantId)]: opts.stock });
            if (opts.stock <= 0) { this.toast(tr('soldOut', 'Out of stock'), 'error'); return false; }
            const avail = opts.stock - this.inCart(productId, variantId);
            if (avail <= 0) {
              if (opts.buy) return this.goCheckout();
              this.toast(tr('allInCart', 'All available pieces ({count}) are already in your cart', { count: opts.stock }), 'error');
              this.openCart();
              return false;
            }
            if (quantity > avail) { quantity = avail; this.toast(tr('maxReached', 'Only {count} available', { count: avail }), 'error'); }
          }
          if (isDemoId(productId)) {
            DemoCart.add(productId, variantId, quantity);
            this.syncDemo();
          } else {
            const body = { productId, quantity };
            if (variantId) body.variantId = variantId;
            this.setCart(await api('/ajax/cart/add', body));
          }
          if (opts.buy) return this.goCheckout(isDemoId(productId));
          this.toast(tr('added', 'Added to cart'), 'success');
          if (CFG.cartOpenOnAdd !== false) this.openCart();
          return true;
        } catch (e) {
          this.toast(e.userMessage || tr('error', 'Something went wrong. Please try again!'), 'error');
          return false;
        } finally {
          this.setBusy(key, false);
        }
      },
      goCheckout(demo) {
        if (demo || this.cart.items.some((i) => i.__demo)) {
          this.toast(tr('previewCheckout', 'Preview: checkout opens on the live store'), 'info');
          this.openCart();
          return true;
        }
        window.location.href = CHECKOUT_URL;
        return true;
      },

      /* Product card buttons: products with options open the quick-add drawer, others are added directly */
      cardAction(el, mode) {
        const card = el.closest('[data-id]');
        if (!card) return;
        const d = card.dataset;
        const stock = d.stock === '-1' || d.stock == null || d.stock === '' ? Infinity : Number(d.stock);
        if (d.options === '1') {
          // البوب أب بيطلع من صورة المنتج اللي اتداس عليه
          const r = (card.querySelector('.mw-card__media') || card).getBoundingClientRect();
          return this.quick({ id: d.id, handle: d.handle, url: d.url, title: d.title, mode, color: card.dataset.color || '', origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
        }
        return this.add(d.id, 1, null, { stock, buy: mode === 'buy', title: d.title });
      },
      quick(target) {
        const el = document.querySelector('.mw-quick');
        if (el) {
          const o = target && target.origin;
          el.style.setProperty('--mw-pop-x', (o ? Math.round(o.x - window.innerWidth / 2) : 0) + 'px');
          el.style.setProperty('--mw-pop-y', (o ? Math.round(o.y - window.innerHeight / 2) : 0) + 'px');
        }
        this.quickTarget = Object.assign({ t: Date.now() }, target);
        if (!this.quickOpen) { this.quickOpen = true; lockScroll(true); }
      },
      closeQuick() { if (this.quickOpen) { this.quickOpen = false; lockScroll(false); } },

      async change(item, qty) {
        qty = parseInt(qty, 10) || 0;
        if (qty < 1) return this.remove(item);
        const max = this.maxFor(item);
        if (qty > max) { this.toast(tr('maxReached', 'Only {count} available', { count: max }), 'error'); qty = max; if (qty === item.quantity) return; }
        const key = 'qty:' + item._id;
        if (this.busy[key]) return;
        this.setBusy(key, true);
        try {
          if (item.__demo) { DemoCart.set(item._id, qty); this.syncDemo(); }
          else this.setCart(await api('/ajax/cart/change', { itemId: item._id, quantity: qty }));
        } catch (e) {
          // the server refuses quantities above stock — remember the limit so "+" gets disabled
          if (qty > item.quantity) this.stock = Object.assign({}, this.stock, { [this.skey(item.productId, item.variantId)]: item.quantity });
          this.toast(e.userMessage || tr('maxReachedGeneric', 'No more pieces available'), 'error');
        } finally { this.setBusy(key, false); }
      },

      async remove(item) {
        try {
          if (item.__demo) { DemoCart.remove(item._id); this.syncDemo(); }
          else this.setCart(await api('/ajax/cart/remove', { itemId: item._id }));
          this.toast(tr('removed', 'Removed from cart'), 'success');
        } catch (e) { this.toast(e.userMessage || tr('error', 'Something went wrong. Please try again!'), 'error'); }
      },

      /* ---------- تغيير اللون من السلة ----------
         مفيش endpoint لتغيير الـ variant، فبنضيف نفس المنتج باللون الجديد (نفس المقاس والكمية في حدود المخزون) وبعدين نشيل السطر القديم. */
      productFor(item) {
        const id = item && item.productId;
        if (!id) return null;
        if (isDemoId(id)) return (DEMO_PRODUCTS[id] && DEMO_PRODUCTS[id].full) || null;
        const p = this.products[id];
        if (p === undefined && !cartProductLoads.has(id)) {
          cartProductLoads.add(id);
          const h = (item.productData && (item.productData.handle || item.productData.slug)) || ((this.itemUrl(item).match(/\/products\/([^/?#]+)/) || [])[1]);
          if (h) {
            api('/ajax/product?' + new URLSearchParams({ handle: decodeURIComponent(h) })).then((d) => {
              const prod = d && (d.product || (d.data && d.data.product) || d.data || d);
              this.products = Object.assign({}, this.products, { [id]: prod && Array.isArray(prod.options) ? prod : null });
            }).catch(() => { this.products = Object.assign({}, this.products, { [id]: null }); });
          }
        }
        return p || null;
      },
      // قيمة كل خيار في السطر الحالي (من الـ variant، وإلا من اسم الـ variant "Black / M")
      lineValues(p, item) {
        const vr = (p.variants || []).find((x) => x._id === item.variantId);
        const keys = vr ? variantKeys(vr).map(normKey) : [];
        const parts = String(item.variantTitle || '').split('/').map(normKey).filter(Boolean);
        return (p.options || []).map((o) => (o.values || []).find((v) => {
          const vk = valKeys(v).map(normKey);
          return keys.length ? vk.some((x) => keys.includes(x)) : parts.includes(normKey(valLabel(v)));
        }) || null);
      },
      lineVariant(p, sel) {
        return variantsUsable(p) ? ((p.variants || []).find((x) => variantMatches(x, sel)) || null) : undefined;
      },
      colorsFor(item) {
        const p = this.productFor(item);
        if (!p) return [];
        const oi = (p.options || []).findIndex(isColorOpt);
        const vals = oi >= 0 ? (p.options[oi].values || []) : [];
        if (vals.length < 2) return [];
        const cur = this.lineValues(p, item);
        return vals.map((v, i) => {
          const active = !!cur[oi] && valKeys(cur[oi]).some((k) => valKeys(v).includes(k));
          const sel = cur.slice(); sel[oi] = v;
          const vr = this.lineVariant(p, sel);
          return {
            key: i, v, label: valLabel(v), active,
            color: resolveSwatch(isObj(v) ? (v.color || v.hex || v.swatch || v.value || v.label) : v),
            available: active || vr === undefined || (!!vr && stockOf(p, vr) > 0)
          };
        });
      },
      async setColor(item, v) {
        const key = 'qty:' + item._id;
        if (this.busy[key]) return;
        const p = this.productFor(item);
        if (!p) return;
        this.setBusy(key, true);
        try {
          const oi = (p.options || []).findIndex(isColorOpt);
          const sel = this.lineValues(p, item); sel[oi] = v;
          let vr = this.lineVariant(p, sel);
          if (vr === undefined) {
            const ids = sel.filter(Boolean).map((x) => (isObj(x) ? x._id || x.id || x.valueId : x)).filter(Boolean);
            const r = await api('/ajax/product/resolve-variant-by-options', { productId: item.productId, options: ids, quantity: 1 }).catch(() => null);
            vr = r && (r.variant || (r.data && r.data.variant) || r.data || r);
            if (!vr || !vr._id) vr = null;
          }
          if (!vr) { this.toast(tr('variantSoldOut', 'This option is sold out'), 'error'); return; }
          if (vr._id === item.variantId) return;
          const stock = stockOf(p, vr);
          const room = stock - this.inCart(item.productId, vr._id);
          if (room <= 0) { this.toast(stock <= 0 ? tr('variantSoldOut', 'This option is sold out') : tr('allInCart', 'All available pieces ({count}) are already in your cart', { count: stock }), 'error'); return; }
          const qty = Math.min(item.quantity, room);
          if (isFinite(stock)) this.stock = Object.assign({}, this.stock, { [this.skey(item.productId, vr._id)]: stock });
          if (item.__demo) {
            DemoCart.replace(item._id, item.productId, vr._id, qty);
            this.syncDemo();
          } else {
            await api('/ajax/cart/add', { productId: item.productId, variantId: vr._id, quantity: qty });
            this.setCart(await api('/ajax/cart/remove', { itemId: item._id }));
          }
          this.toast(qty < item.quantity ? tr('maxReached', 'Only {count} available', { count: qty }) : tr('colorChanged', 'Colour updated'), qty < item.quantity ? 'error' : 'success');
        } catch (e) {
          this.toast(e.userMessage || tr('error', 'Something went wrong. Please try again!'), 'error');
          if (!item.__demo) this.refresh();
        } finally { this.setBusy(key, false); }
      },

      openCart() { if (!this.cartOpen) { this.cartOpen = true; lockScroll(true); } },
      closeCart() { if (this.cartOpen) { this.cartOpen = false; lockScroll(false); } },

      /* GEN-16: التوست في مكان ثابت، الخطأ أحمر بأيقونة وrole=alert، النجاح أخضر، وبيختفي لوحده */
      toast(msg, kind) {
        if (!msg) return;
        kind = kind || 'info';
        let el = document.querySelector('.mw-toast');
        if (!el) {
          el = document.createElement('div');
          el.innerHTML = '<span class="mw-toast__icon" aria-hidden="true"></span><span class="mw-toast__text"></span><button type="button" class="mw-toast__close" aria-label="' + esc(tr('close', 'Close')) + '"><span aria-hidden="true">×</span></button>';
          el.querySelector('.mw-toast__close').addEventListener('click', () => el.classList.remove('is-visible'));
          document.body.appendChild(el);
        }
        el.className = 'mw-toast mw-toast--' + kind;
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
        el.querySelector('.mw-toast__icon').textContent = kind === 'error' ? '!' : (kind === 'success' ? '✓' : 'i');
        el.querySelector('.mw-toast__text').textContent = msg;
        requestAnimationFrame(() => el.classList.add('is-visible'));
        clearTimeout(this._toast);
        this._toast = setTimeout(() => el.classList.remove('is-visible'), kind === 'error' ? 4500 : 2800);
      }
    });

    /* Header: dropdowns (hover intent), drawers, search, notifications */
    Alpine.data('mwHeader', () => ({
      panel: null,
      menuOpen: null,
      notif: false,
      seen: false,
      _t: null,
      init() {
        try { this.seen = localStorage.getItem('mw-notif-seen') === '1'; } catch (e) {}
        this.$watch('seen', (v) => { try { if (v) localStorage.setItem('mw-notif-seen', '1'); } catch (e) {} });
      },
      setDimTop() {
        const h = this.$el.querySelector('.mw-header');
        if (h) document.documentElement.style.setProperty('--mw-dim-top', Math.round(h.getBoundingClientRect().bottom) + 'px');
      },
      openMenu(i, item) {
        clearTimeout(this._t);
        this._t = setTimeout(() => { this.setDimTop(); this.menuOpen = i; this.$nextTick(() => this.fit(item)); }, this.menuOpen === null ? 90 : 0);
      },
      /* GEN-09: القائمة المنسدلة متخرجش برا الشاشة (بتتزق جوه لو قربت من الحافة) */
      fit(item) {
        const d = item && item.querySelector && item.querySelector('.mw-nav__dropdown');
        if (!d || d.classList.contains('mw-nav__dropdown--mega')) return;
        d.style.transform = '';
        const r = d.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        let dx = 0;
        if (r.right > vw - 8) dx = (vw - 8) - r.right;
        if (r.left + dx < 8) dx = 8 - r.left;
        if (dx) d.style.transform = 'translateX(' + Math.round(dx) + 'px)';
      },
      /* HOME-09: شريط الإعلانات بيتقفل ويفضل مقفول طول الجلسة */
      closeAnnouncement() {
        document.documentElement.classList.add('mw-ann-closed');
        try { sessionStorage.setItem('mw-ann-closed', '1'); } catch (e) { /* ignore */ }
      },
      closeMenu() {
        clearTimeout(this._t);
        this._t = setTimeout(() => { this.menuOpen = null; }, 140);
      },
      openDrawer(name) {
        if (this.panel === name) return;
        if (!this.panel) lockScroll(true);
        this.panel = name;
        this.menuOpen = null;
        if (name === 'search') setTimeout(() => { const i = this.$el.querySelector('.mw-search__input'); if (i) i.focus(); }, 120);
      },
      closeAll() {
        if (this.panel) lockScroll(false);
        this.panel = null;
        this.notif = false;
        this.menuOpen = null;
        Alpine.store('mw').closeCart();
        Alpine.store('mw').closeQuick();
      },
      openCart() { Alpine.store('mw').openCart(); }
    }));

    /* Live search panel (header): suggestions + collections + products available by that name */
    Alpine.data('mwSearch', () => ({
      query: '',
      loading: false,
      error: false,
      searched: false,
      products: [],
      terms: [],
      cols: [],
      total: 0,
      available: 0,
      recent: [],
      popular: [],
      active: -1,
      _seq: 0,
      init() {
        this.recent = readRecent();
        this.popular = String(this.$root.dataset.popular || '').split(/[,،\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
      },
      get q() { return this.query.trim(); },
      get navCount() { return this.terms.length + this.cols.length + this.products.length; },
      get availableText() {
        return trHtml('availableByName', '{count} products available for {q}', { count: this.available, q: '<bdi><b>' + esc(this.q) + '</b></bdi>' });
      },
      async input() {
        const q = this.q;
        this.active = -1;
        if (!q) { this.reset(); return; }
        const seq = ++this._seq;
        this.loading = true;
        this.error = false;
        try {
          const r = await SearchEngine.run(q);
          if (seq !== this._seq) return;
          this.products = r.products.slice(0, 8);
          this.total = r.products.length;
          this.available = r.available;
          this.terms = r.terms;
          this.cols = r.cols;
          this.searched = true;
        } catch (e) {
          if (seq !== this._seq) return;
          this.error = true;
          this.searched = true;
          this.products = []; this.terms = []; this.cols = []; this.total = 0; this.available = 0;
        } finally {
          if (seq === this._seq) this.loading = false;
        }
      },
      reset() {
        this._seq++;
        this.products = []; this.terms = []; this.cols = [];
        this.total = 0; this.available = 0;
        this.searched = false; this.loading = false; this.error = false; this.active = -1;
      },
      clear() {
        this.query = '';
        this.reset();
        const i = this.$root.querySelector('.mw-search__input');
        if (i) i.focus();
      },
      use(term) {
        this.query = term;
        this.input();
        const i = this.$root.querySelector('.mw-search__input');
        if (i) i.focus();
      },
      go(term) {
        const q = String(term || this.q).trim();
        if (!q) return;
        this.recent = saveRecent(q);
        window.location.href = '/search?q=' + encodeURIComponent(q);
      },
      remember() { if (this.q) this.recent = saveRecent(this.q); },
      submit() {
        if (this.active >= 0) {
          const el = this.$root.querySelector('[data-nav="' + this.active + '"]');
          if (el) {
            if (el.dataset.term != null) { this.use(el.dataset.term); return; }
            const link = el.matches('a') ? el : el.querySelector('a');
            if (link) { this.remember(); window.location.href = link.getAttribute('href'); return; }
          }
        }
        this.go();
      },
      move(d) {
        const n = this.navCount;
        if (!n) return;
        this.active = (this.active + d + n) % n;
        this.$nextTick(() => { const el = this.$root.querySelector('[data-nav="' + this.active + '"]'); if (el) el.scrollIntoView({ block: 'nearest' }); });
      },
      clearRecent() { this.recent = saveRecent(null); },
      hl(text) { return highlight(text, this.q); },
      money(n) { return Money.fmt(n); },
      stockOf(p) { return stockLabel(p); },
      img(p) { return (p.images && p.images[0]) || ''; }
    }));

    /* Hero (only when more than one slide) */
    Alpine.data('mwHero', (opts) => ({
      init() {
        if (!window.Swiper) return;
        new window.Swiper(this.$el.querySelector('.mw-hero__swiper'), {
          loop: true,
          speed: 700,
          effect: 'fade',
          fadeEffect: { crossFade: true },
          autoplay: opts && opts.autoplay && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('mw-no-motion') ? { delay: opts.interval || 8000, disableOnInteraction: false, pauseOnMouseEnter: true } : false,
          pagination: { el: this.$el.querySelector('.swiper-pagination'), clickable: true }
        });
      }
    }));

    /* Generic horizontal scroller with prev/next (RTL aware) */
    Alpine.data('mwScroller', () => ({
      atStart: true,
      atEnd: false,
      init() {
        this.$nextTick(() => this.update());
        window.addEventListener('resize', () => this.update(), { passive: true });
        this.$el.addEventListener('mw:demo-rendered', () => this.$nextTick(() => this.update()));
      },
      update() {
        const t = this.$refs.track;
        if (!t) return;
        const max = t.scrollWidth - t.clientWidth;
        const pos = Math.abs(t.scrollLeft);
        this.atStart = pos < 4;
        this.atEnd = pos >= max - 4;
      },
      step(dir) {
        const t = this.$refs.track;
        if (!t) return;
        const first = t.firstElementChild;
        const gap = parseFloat(getComputedStyle(t).columnGap) || 0;
        const w = first ? first.getBoundingClientRect().width + gap : t.clientWidth * 0.8;
        const rtl = getComputedStyle(t).direction === 'rtl';
        t.scrollBy({ left: dir * w * (rtl ? -1 : 1), behavior: 'smooth' });
        setTimeout(() => this.update(), 450);
      },
      next() { this.step(1); },
      prev() { this.step(-1); }
    }));

    /* Product page */
    Alpine.data('mwProduct', (product) => mix({}, pickerMixin(product), {
      zoom: false,
      scaled: false,
      zx: 50,
      zy: 50,
      buybar: false,
      _sx: null,
      init() {
        this.pickerInit();
        // شريط الشراء الثابت (≤1023px): بيظهر لما أزرار الشراء الأصلية تطلع لفوق برا الشاشة
        const btns = this.$refs.buyButtons;
        if (btns && 'IntersectionObserver' in window) {
          const mq = window.matchMedia('(max-width: 1023px)');
          const io = new IntersectionObserver((entries) => {
            const e = entries[0];
            this.buybar = mq.matches && !e.isIntersecting;
          });
          io.observe(btns);
          this.$watch('buybar', (v) => document.documentElement.classList.toggle('mw-has-buybar', !!v));
        }
      },
      buyBarAdd() {
        if (this.options.length && !this.complete) { this.flagMissing(); return; }
        this.submit(false);
      },
      swipeStart(e) { const t = e.touches && e.touches[0]; this._sx = t ? t.clientX : null; },
      swipeEnd(e, n) {
        const t = e.changedTouches && e.changedTouches[0];
        if (this._sx == null || !t || n < 2) return;
        const dx = t.clientX - this._sx;
        this._sx = null;
        if (Math.abs(dx) < 40) return;
        const rtl = document.documentElement.dir === 'rtl';
        const next = (dx < 0) !== rtl;
        this.gallery = (this.gallery + (next ? 1 : -1) + n) % n;
      },
      openZoom() { this.zoom = true; this.scaled = false; lockScroll(true); },
      closeZoom() { if (!this.zoom) return; this.zoom = false; this.scaled = false; lockScroll(false); },
      zoomStep(d, n) { this.scaled = false; this.gallery = (this.gallery + d + n) % n; },
      toggleScale(e) { this.zoomMove(e); this.scaled = !this.scaled; },
      zoomMove(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this.zx = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
        this.zy = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
      }
    }));

    /* منتجات مقترحة (صفحة المنتج لو التوصيات فاضية / 404 / بحث بلا نتائج) — من المتجر الحقيقي، ومن غير المنتج الحالي */
    Alpine.data('mwRelated', (cfg) => ({
      html: '',
      async init() {
        const c = cfg || {};
        const limit = c.limit || 4;
        let list = [];
        try {
          list = (await fetchProducts({ collectionId: c.collectionId, sort: c.sort || 'created-desc', limit: limit + 1 }))
            .filter((p) => String(p._id) !== String(c.exclude || '')).slice(0, limit).map(apiToCard);
        } catch (e) { list = []; }
        if (!list.length && demoAllowed() && window.MW_DEMO) list = Object.values(DEMO_PRODUCTS).slice(0, limit);
        // كارت لوحده مش قسم: أقل من اتنين يستخبى
        this.html = list.length > 1 ? list.map((p) => cardHTML(p)).join('') : '';
      }
    }));

    /* نموذج تواصل معنا (CNT-06) — تحقق من الحقول قبل الإرسال */
    Alpine.data('mwContact', () => ({
      name: '', email: '', phone: '', message: '', state: 'idle', errors: {},
      submit(e) {
        const er = {};
        if (this.name.trim().length < 2) er.name = tr('errName', 'Please enter your name');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(this.email.trim())) er.email = tr('errEmail', 'Please enter a valid email');
        if (this.message.trim().length < 5) er.message = tr('errMessage', 'Please write your message');
        this.errors = er;
        if (Object.keys(er).length) {
          e.preventDefault();
          this.state = 'error';
          this.$nextTick(() => { const f = this.$root.querySelector('[aria-invalid="true"]'); if (f) f.focus(); });
          return;
        }
        this.state = 'sent';
      }
    }));

    /* Quick add drawer (cards with options) */
    Alpine.data('mwQuickAdd', () => mix({}, pickerMixin({}), {
      loading: false,
      loadError: false,
      mode: 'add',
      url: '#',
      init() {
        this.$watch('$store.mw.quickTarget', (t) => { if (t) this.load(t); });
      },
      async load(t) {
        this.mode = t.mode || 'add';
        this.url = t.url || '#';
        this.loading = true;
        this.loadError = false;
        this.product = { _id: t.id, title: t.title || '', images: [], options: [] };
        this.selected = [];
        this.quantity = 1;
        this.gallery = 0;
        try {
          let p = null;
          if (isDemoId(t.id)) p = DEMO_PRODUCTS[t.id] && DEMO_PRODUCTS[t.id].full;
          else {
            const d = await api('/ajax/product?' + new URLSearchParams({ handle: t.handle || '' }));
            p = d && (d.product || d.data || d);
          }
          if (!p || !p._id) throw new Error('no product');
          this.product = p;
          this.pickerInit();
          // اللون اللي اختاره اليوزر على الكارت يتطبق هنا تلقائياً (بدون ما يروح صفحة تانية)
          if (t.color) {
            try {
              const oi = this.options.findIndex((o) => this.isColor(o));
              if (oi >= 0) {
                const vi = this.options[oi].values.findIndex((v) => normKey(valLabel(v)) === normKey(t.color));
                if (vi >= 0 && this.isAvailable(oi, vi)) this.choose(oi, vi);
              }
            } catch (e) {}
          }
        } catch (e) {
          this.loadError = true;
        } finally {
          this.loading = false;
        }
      },
      // الصورة بتتبع اللون المختار (gallery بيتظبط من pickerMixin لما اللون يتغير)
      get image() { const imgs = this.product.images || []; const im = imgs[this.gallery] || imgs[0]; return (im && im.fileUrl) || ''; },
      close() { Alpine.store('mw').closeQuick(); },
      async go(buy) {
        const ok = await this.submit(buy);
        if (ok) this.close();
      }
    }));

    /* Delivery estimate (product page) — "Order placed / Dispatched / Delivered" like the live site */
    Alpine.data('mwDeliveryDates', (dispatch, min, max) => ({
      placed: '', dispatched: '', delivered: '',
      init() {
        const loc = CFG.lang === 'ar' ? 'ar-EG' : (CFG.lang || 'en');
        const f = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' });
        const add = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return f.format(d); };
        this.placed = add(0);
        this.dispatched = dispatch > 0 ? add(dispatch) : add(0);
        this.delivered = add(min) + ' – ' + add(max);
      }
    }));

    /* Collection / shop / search listing — FLT-01…12.
       server mode: dashboard filters → navigate with filters[name][]=… (server filters every page).
       client mode: facets from the cards' data-facets (tags key:value + option values), «in stock», price — filter this page live.
       Mobile drawer works on a draft: «عرض النتائج» applies, «إلغاء» / ✕ / scrim / Esc restore (FLT-11). Sort is server-side (?sort=). */
    Alpine.data('mwCollection', (config) => {
      const cfg = config || {};
      const sp = new URLSearchParams(window.location.search);
      const server = Array.isArray(cfg.serverKeys) && cfg.serverKeys.length > 0;
      const readSel = (k) => sp.getAll('filters[' + k + '][]').map((v) => String(v).trim()).filter(Boolean);
      const latin = (v) => String(v == null ? '' : v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
      const facetsOf = (el) => {
        const out = {};
        String(el.getAttribute('data-facets') || '').split('|').forEach((pair) => {
          const i = pair.indexOf(':');
          if (i <= 0) return;
          const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
          if (!k || !v) return;
          (out[k] = out[k] || []).indexOf(v) === -1 && out[k].push(v);
        });
        return out;
      };
      const urlKeys = () => { const ks = []; sp.forEach((v, k) => { const m = k.match(/^filters\[([^\]]+)\]\[\]$/); if (m && ks.indexOf(m[1]) === -1) ks.push(m[1]); }); return ks; };
      return {
        sort: sp.get('sort') || '',
        min: sp.get('filters[price][min]') || '',
        max: sp.get('filters[price][max]') || '',
        inStock: false,
        sel: (server ? cfg.serverKeys.map(String) : urlKeys()).reduce((a, k) => { a[k] = readSel(k); return a; }, {}),
        facets: [],
        shown: -1,
        total: 0,
        open: false,
        priceNote: '',
        _snap: null,
        init() {
          this.scan(); this.applySort(); this.apply();
          this.$el.addEventListener('mw:demo-rendered', () => this.$nextTick(() => { this.scan(); this.apply(); }));
        },
        cards() { return Array.from(this.$root.querySelectorAll('.mw-collection__results [data-mw-card]')); },
        scan() {
          const cards = this.cards();
          const el = this.$root.querySelector('.mw-toolbar__count');
          const serverTotal = el ? parseInt(el.getAttribute('data-total') || '0', 10) : 0;
          this.total = server ? Math.max(serverTotal, cards.length) : cards.length;
          if (server) { this.facets = []; return; }
          const acc = {};
          cards.forEach((c) => { const f = facetsOf(c); Object.keys(f).forEach((k) => { acc[k] = acc[k] || new Map(); f[k].forEach((v) => acc[k].set(v, (acc[k].get(v) || 0) + 1)); }); });
          const labels = cfg.labels || {};
          this.facets = Object.keys(acc).map((k) => ({
            key: k,
            label: labels[k.toLowerCase()] || k,
            values: Array.from(acc[k], (e) => ({ v: e[0], count: e[1] })).sort((a, b) => (b.count - a.count) || String(a.v).localeCompare(String(b.v), CFG.lang || 'ar'))
          }));
          this.facets.forEach((f) => { if (!this.sel[f.key]) this.sel[f.key] = []; });
        },
        keys() { return Object.keys(this.sel); },
        isSel(k, v) { return (this.sel[k] || []).indexOf(String(v)) !== -1; },
        toggle(k, v) {
          const val = String(v); const cur = this.sel[k] || [];
          this.sel = Object.assign({}, this.sel, { [k]: cur.indexOf(val) === -1 ? cur.concat(val) : cur.filter((x) => x !== val) });
          this.commit();
        },
        toggleStock() { this.inStock = !this.inStock; this.commit(); },
        commit() { if (!server) { this.apply(); this.sync(); } else if (!this.open) this.navigate(); },
        filterUrl() {
          const u = new URL(window.location.href);
          Array.from(u.searchParams.keys()).filter((k) => /^filters\[/.test(k)).forEach((k) => u.searchParams.delete(k));
          u.searchParams.delete('page');
          this.keys().forEach((k) => (this.sel[k] || []).forEach((v) => u.searchParams.append('filters[' + k + '][]', v)));
          if (String(this.min).trim() !== '') u.searchParams.set('filters[price][min]', String(this.min).trim());
          if (String(this.max).trim() !== '') u.searchParams.set('filters[price][max]', String(this.max).trim());
          if (this.inStock && !server) u.searchParams.set('filters[stock]', 'in');
          return u;
        },
        navigate() { const u = this.filterUrl(); if (u.search !== window.location.search) window.location.href = u.pathname + u.search; },
        sync() { const u = this.filterUrl(); try { window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* ignore */ } },
        /* FLT-04: سالب = فاضي، والمدى المقلوب بيتبدّل مع ملاحظة ظاهرة */
        applyPrice() {
          const clean = (v) => { const t = latin(v); if (t === '') return ''; const n = Number(t); return Number.isFinite(n) && n >= 0 ? String(n) : ''; };
          this.min = clean(this.min); this.max = clean(this.max); this.priceNote = '';
          if (this.min !== '' && this.max !== '' && Number(this.min) > Number(this.max)) { const t = this.min; this.min = this.max; this.max = t; this.priceNote = tr('priceSwapped', 'Min and max were swapped'); }
          this.commit();
        },
        openFilters() {
          this._snap = JSON.stringify({ sel: this.sel, inStock: this.inStock, min: this.min, max: this.max });
          this.open = true; lockScroll(true);
          this.$nextTick(() => { const b = this.$root.querySelector('.mw-filter-panel .mw-filter-close'); if (b) b.focus(); });
        },
        closeDrawer() { if (this.open) { this.open = false; lockScroll(false); } },
        applyFilters() { this._snap = null; this.closeDrawer(); if (server) this.navigate(); },
        cancelFilters() {
          if (this._snap) { const sn = JSON.parse(this._snap); this.sel = sn.sel; this.inStock = sn.inStock; this.min = sn.min; this.max = sn.max; if (!server) { this.apply(); this.sync(); } }
          this._snap = null; this.priceNote = ''; this.closeDrawer();
        },
        clearAll() {
          const cleared = {}; this.keys().forEach((k) => { cleared[k] = []; });
          this.sel = cleared; this.inStock = false; this.min = ''; this.max = ''; this.priceNote = '';
          if (server) { this._snap = null; this.closeDrawer(); this.navigate(); }
          else { this.apply(); this.sync(); }
        },
        matches(el) {
          const f = facetsOf(el);
          const ks = this.keys();
          for (let i = 0; i < ks.length; i++) {
            const want = this.sel[ks[i]];
            if (want && want.length && !want.some((v) => (f[ks[i]] || []).indexOf(v) !== -1)) return false;
          }
          if (this.inStock && el.getAttribute('data-stock') === '0') return false;
          const price = parseFloat(el.getAttribute('data-price'));
          if (!isNaN(price)) {
            const lo = this.min === '' ? null : Number(this.min) * Money.divisor;
            const hi = this.max === '' ? null : Number(this.max) * Money.divisor;
            if (lo !== null && price < lo) return false;
            if (hi !== null && price > hi) return false;
          }
          return true;
        },
        apply() {
          const cards = this.cards();
          if (server) { this.shown = cards.length; return; }
          let n = 0;
          cards.forEach((el) => { const ok = this.matches(el); el.hidden = !ok; if (ok) n++; });
          this.shown = cards.length ? n : -1;
        },
        /* الترتيب من السيرفر؛ وبنرتب الصفحة الحالية كمان لو السيرفر تجاهل القيمة */
        applySort() {
          const g = this.$refs.grid;
          if (!g || !this.sort) return;
          const num = (c, k) => parseFloat(c.dataset[k]) || 0;
          const by = { 'price-asc': (a, b) => num(a, 'price') - num(b, 'price'), 'price-desc': (a, b) => num(b, 'price') - num(a, 'price'), 'rating-desc': (a, b) => num(b, 'rating') - num(a, 'rating') }[this.sort];
          if (by) Array.from(g.children).sort(by).forEach((c) => g.appendChild(c));
        },
        setSort(v) { const u = new URL(window.location.href); if (v) u.searchParams.set('sort', v); else u.searchParams.delete('sort'); u.searchParams.delete('page'); window.location.href = u.pathname + u.search; },
        get activeCount() {
          return this.keys().reduce((n, k) => n + ((this.sel[k] || []).length ? 1 : 0), 0) + (this.inStock ? 1 : 0) + ((this.min !== '' || this.max !== '') ? 1 : 0);
        },
        get countText() {
          if (this.shown < 0 || this.shown === this.total || server) return countLabel(this.total);
          return tr('showing', '{shown} of {total} products').replace('{shown}', String(this.shown)).replace('{total}', String(this.total));
        }
      };
    });

    /* Search page: live results while typing + suggestions + "available only" + sort */
    Alpine.data('mwSearchPage', () => ({
      query: new URLSearchParams(window.location.search).get('q') || '',
      sort: new URLSearchParams(window.location.search).get('sort') || '',
      inStock: false,
      loading: false,
      searched: false,
      error: false,
      cards: [],
      terms: [],
      cols: [],
      recent: [],
      _seq: 0,
      init() {
        this.recent = readRecent();
        if (this.query.trim()) this.run(true);
      },
      get q() { return this.query.trim(); },
      get total() { return this.cards.length; },
      get available() { return this.cards.filter((c) => c.stock > 0).length; },
      get shown() {
        let list = this.inStock ? this.cards.filter((c) => c.stock > 0) : this.cards.slice();
        const by = {
          'price-asc': (a, b) => a.price - b.price,
          'price-desc': (a, b) => b.price - a.price,
          'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0)
        }[this.sort];
        if (by) list = list.sort(by);
        return list;
      },
      get html() { return this.shown.map((c) => cardHTML(c)).join(''); },
      get summary() {
        return trHtml('searchSummary', '{total} results for {q} — {available} available', { total: this.total, q: '<bdi><b>' + esc(this.q) + '</b></bdi>', available: this.available });
      },
      syncUrl() {
        const url = new URL(window.location.href);
        if (this.q) url.searchParams.set('q', this.q); else url.searchParams.delete('q');
        if (this.sort) url.searchParams.set('sort', this.sort); else url.searchParams.delete('sort');
        if (this.inStock) url.searchParams.set('available', '1'); else url.searchParams.delete('available');
        window.history.replaceState({}, '', url);
      },
      async run(remember) {
        const q = this.q;
        this.syncUrl();
        if (!q) { this._seq++; this.cards = []; this.terms = []; this.cols = []; this.searched = false; this.loading = false; return; }
        const seq = ++this._seq;
        this.loading = true;
        this.error = false;
        try {
          const r = await SearchEngine.run(q);
          if (seq !== this._seq) return;
          this.cards = r.products;
          this.terms = r.terms;
          this.cols = r.cols;
          this.searched = true;
          if (remember) this.recent = saveRecent(q);
        } catch (e) {
          if (seq !== this._seq) return;
          this.error = true;
          this.searched = true;
          this.cards = [];
        } finally {
          if (seq === this._seq) this.loading = false;
        }
      },
      use(term) { this.query = term; this.run(true); },
      hl(text) { return highlight(text, this.q); }
    }));

    /* Demo product page (preview only) — uses the same picker as the real product page */
    Alpine.data('mwDemoProduct', () => mix({}, pickerMixin({}), {
      p: null,
      init() {
        const id = new URLSearchParams(window.location.search).get('demo_product');
        if (!id) return;
        const go = () => {
          const d = DEMO_PRODUCTS[id];
          if (!d) return;
          this.product = d.full;
          this.p = d;
          this.pickerInit();
        };
        if (window.MW_DEMO) go(); else window.addEventListener('mw:demo-ready', go, { once: true });
      },
      money(n) { return Money.fmt(n); }
    }));

    /* Demo collection page (preview only) */
    Alpine.data('mwDemoCollection', () => ({
      active: false,
      title: '',
      html: '',
      init() {
        const id = new URLSearchParams(window.location.search).get('demo_collection');
        if (!id) return;
        const go = () => {
          const D = window.MW_DEMO;
          const key = id.replace('demo-c-', '');
          const map = { tops: 'tops', tshirts: 'tops', 't-shirts': 'tops', compression: 'compressions', compressions: 'compressions', tanks: 'tanks', tanktop: 'tanks', bottoms: 'bottoms', shorts: 'bottoms', 'new-arrivals': 'new', 'new-drop': 'new', 'best-sellers': 'best' };
          const all = [].concat(D.sets.tops, D.sets.compressions, D.sets.tanks, D.sets.bottoms).filter((p, i, a) => a.findIndex((x) => x._id === p._id) === i);
          const byWord = /hood|sweat/.test(key) ? all.filter((p) => /hoodie|sweatshirt/i.test(p.title)) : null;
          const list = map[key] ? D.sets[map[key]] : (byWord && byWord.length ? byWord : all);
          this.title = map[key] || byWord ? key.replace(/-/g, ' ') : 'All products';
          this.html = list.map(demoProduct).map((p) => cardHTML(p)).join('');
          this.active = true;
        };
        if (window.MW_DEMO) go(); else window.addEventListener('mw:demo-ready', go, { once: true });
      }
    }));
  });

  /* ---------- Demo links: لينك لتصنيف/منتج مش موجود في المتجر → نسخته الافتراضية بدل صفحة الخطأ ----------
     بيشتغل بس لما المنتجات الافتراضية متحمّلة (أقسام من غير منتجات حقيقية). اللينكات اللي ليها صفحة حقيقية بتفتح عادي. */
  const linkChecks = new Map();
  const demoSlug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  document.addEventListener('click', (e) => {
    if (!window.MW_DEMO || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank') return;
    const m = (a.getAttribute('href') || '').match(/^\/(?:(?:ar|en|fr)\/)?(collections|products)\/([^/?#]+)/);
    if (!m) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    const handle = decodeURIComponent(m[2]).toLowerCase();
    const demoHref = () => {
      if (m[1] === 'collections') return demoUrl('demo-c-' + handle, 'demo_collection');
      const p = Object.values(DEMO_PRODUCTS).find((x) => demoSlug(x.title) === handle);
      return p ? p.url : demoUrl('demo-c-all', 'demo_collection');
    };
    if (!linkChecks.has(href)) linkChecks.set(href, fetch(href, { method: 'HEAD', credentials: 'same-origin' }).then((r) => r.ok).catch(() => true));
    linkChecks.get(href).then((ok) => { window.location.href = ok ? href : demoHref(); });
  });

  /* ---------- Image fallback: no broken images anywhere (banner, sections, products, search) ---------- */
  const IMG_FB_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='800' viewBox='0 0 600 800'><rect width='600' height='800' fill='#f1f1f1'/><g fill='none' stroke='#c9c9c9' stroke-width='12' stroke-linejoin='round'><path d='M230 170 145 225l48 118 57-27v334h100V316l57 27 48-118-85-55c-14 38-40 60-70 60s-56-22-70-60z'/></g></svg>";
  const IMG_FB = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(IMG_FB_SVG);
  function imgFallback(img) {
    if (!img || img.dataset.fb) return;
    img.dataset.fb = '1';
    try { img.src = IMG_FB; } catch (e) {}
  }
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG') imgFallback(t);
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0 && !img.dataset.fb && img.src) imgFallback(img);
    });
  });

  /* Card swatches change in place (no navigation): toggle active + remember choice for quick-add */
  /* ---------- Card swatches: اختيار لون من الكارت بيغيّر الصورة فعلاً + بيفتح صفحة المنتج على نفس اللون ---------- */
  const cardProducts = {};
  // صورة اللون لمنتج حقيقي: صورة القيمة نفسها ← صورة أي variant بنفس اللون ← صورة اسم ملفها فيه اسم اللون
  async function colorImageFor(card, color) {
    const handle = card.dataset.handle;
    if (!handle || !color || isDemoId(card.dataset.id)) return '';
    if (!cardProducts[handle]) cardProducts[handle] = api('/ajax/product?' + new URLSearchParams({ handle })).catch(() => null);
    const d = await cardProducts[handle];
    const p = d && (d.product || (d.data && d.data.product) || d.data || d);
    const opt = p && (p.options || []).find(isColorOpt);
    if (!opt) return '';
    const key = normKey(color);
    const val = (opt.values || []).find((v) => normKey(valLabel(v)) === key || valKeys(v).map(normKey).includes(key));
    if (!val) return '';
    let img = imgUrl(val.image);
    if (!img) {
      const ids = valKeys(val);
      const vr = (p.variants || []).find((x) => imgUrl(x.image || x.featuredImage) &&
        (x.options || []).some((o) => valKeys(o).some((k) => ids.includes(k))));
      img = vr ? imgUrl(vr.image || vr.featuredImage) : '';
    }
    if (!img) {
      const words = key.split(/\s+/).filter(Boolean);
      img = (p.images || []).map(imgUrl).find((u) => { const f = normKey(decodeURIComponent(u.split('?')[0].split('/').pop())); return words.length && words.every((w) => f.includes(w)); }) || '';
    }
    return img;
  }
  function setCardImages(card, main, hover) {
    const a = card.querySelector('.mw-card__media a');
    const im = a && a.querySelector('img:not(.mw-card__img--hover)');
    if (!im || !main) return;
    const hv = a.querySelector('.mw-card__img--hover');
    if (im.dataset.orig == null) { im.dataset.orig = im.getAttribute('src') || ''; if (hv) hv.dataset.orig = hv.getAttribute('src') || ''; }
    delete im.dataset.fb;
    im.src = main;
    if (hv) { if (hover) { delete hv.dataset.fb; hv.src = hover; } hv.hidden = !hover; }
  }
  window.mwCardSwatch = function (btn) {
    try {
      const card = btn.closest('.mw-card');
      if (!card) return false;
      card.querySelectorAll('.mw-card__swatch').forEach((s) => s.classList.remove('is-active'));
      btn.classList.add('is-active');
      const color = btn.dataset.color || '';
      card.dataset.color = color;
      // الروابط تفتح صفحة المنتج واللون ده متختار
      card.querySelectorAll('a[href]').forEach((a) => {
        try {
          const u = new URL(a.getAttribute('href'), window.location.origin);
          u.searchParams.set('color', color);
          a.setAttribute('href', u.pathname + u.search + u.hash);
        } catch (e) {}
      });
      const im = card.querySelector('.mw-card__media a img:not(.mw-card__img--hover)');
      const first = btn === card.querySelector('.mw-card__swatch');
      if (btn.dataset.img) setCardImages(card, btn.dataset.img, btn.dataset.img2 || '');
      else if (first && im && im.dataset.orig != null) { const hv = card.querySelector('.mw-card__img--hover'); setCardImages(card, im.dataset.orig, hv ? hv.dataset.orig : ''); }
      else {
        card.dataset.swatchSeq = String((parseInt(card.dataset.swatchSeq || '0', 10) || 0) + 1);
        const seq = card.dataset.swatchSeq;
        colorImageFor(card, color).then((img) => {
          if (card.dataset.swatchSeq !== seq) return;
          if (img) { btn.dataset.img = img; setCardImages(card, img, ''); return; }
          // اللون ده ملوش صورة خاصة: ارجع للصورة الأصلية بدل ما تفضل صورة لون تاني
          const hv = card.querySelector('.mw-card__img--hover');
          if (im && im.dataset.orig != null) setCardImages(card, im.dataset.orig, hv ? hv.dataset.orig : '');
        });
      }
    } catch (e) {}
    return false;
  };

  /* ---------- Language: نفس الصفحة باللغة التانية (/en/... أو /ar/...) بدل الرجوع للرئيسية ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-mw-lang]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const lang = a.getAttribute('data-mw-lang');
    if (!/^(ar|en|fr)$/.test(lang)) return;
    e.preventDefault();
    const path = window.location.pathname.replace(/^\/(ar|en|fr)(?=\/|$)/, '') || '/';
    window.location.href = '/' + lang + (path === '/' ? '' : path) + window.location.search + window.location.hash;
  });

  /* ---------- Currency (GEN-15): أزرار بس لو فيه عملتين أو أكتر — قمرة بتقرا العملة من كوكي currency ---------- */
  function mountCurrency() {
    document.querySelectorAll('[data-mw-currency]').forEach((host) => {
      const codes = Array.from(new Set(String(host.dataset.currencies || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{3}$/.test(x))));
      const cur = String(host.dataset.current || '').toUpperCase();
      if (codes.length < 2) return;
      host.innerHTML = codes.map((c) => '<button type="button" class="mw-currency__btn' + (c === cur ? ' is-current' : '') + '" data-mw-cur="' + c + '" lang="en" dir="ltr"' + (c === cur ? ' aria-current="true"' : '') + '>' + c + '</button>').join('');
      host.hidden = false;
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-mw-cur]');
    if (!b || b.classList.contains('is-current')) return;
    const code = b.getAttribute('data-mw-cur');
    const parts = window.location.hostname.split('.');
    const doms = [''];
    for (let i = 0; i < parts.length - 1; i++) doms.push('; domain=.' + parts.slice(i).join('.'));
    doms.forEach((d) => { document.cookie = 'currency=; path=/; max-age=0' + d; });
    document.cookie = 'currency=' + code + '; path=/; max-age=31536000; SameSite=Lax' + (window.location.protocol === 'https:' ? '; Secure' : '');
    window.location.reload();
  });

  /* ---------- Pagination: الصفحة التالية بنفس الفلاتر والترتيب وكلمة البحث (COL-06 / FLT-10) ---------- */
  function fixPagination() {
    document.querySelectorAll('.mw-pagination a[data-page]').forEach((a) => {
      const u = new URL(window.location.href);
      u.searchParams.set('page', a.getAttribute('data-page'));
      a.setAttribute('href', u.pathname + u.search);
    });
  }
  /* ---------- السنة في الفوتر: فلتر date في المنصة مابيفهمش "now" ---------- */
  function fillYear() {
    const y = String(new Date().getFullYear());
    document.querySelectorAll('[data-mw-year]').forEach((el) => { el.textContent = y; });
  }

  /* ---------- /blogs: المنصة بتبعت التصنيفات بس، فبنجيب كروت كل تصنيف من صفحته، الأحدث الأول ---------- */
  async function mergeBlogPosts() {
    const grid = document.querySelector('[data-mw-blog-merge]');
    if (!grid) return;
    const seen = new Set();
    const cards = [];
    for (const h of grid.getAttribute('data-mw-blog-merge').split('|').filter(Boolean).slice(0, 12)) {
      try {
        const res = await fetch('/blogs/' + encodeURIComponent(h), { credentials: 'same-origin' });
        if (!res.ok) continue;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        doc.querySelectorAll('.mw-posts .mw-post').forEach((a) => {
          const href = a.getAttribute('href');
          if (seen.has(href)) return;
          seen.add(href);
          cards.push(a);
        });
      } catch (e) { /* التصنيف ده يتخطى */ }
    }
    cards.sort((a, b) => String(b.dataset.date || '').localeCompare(String(a.dataset.date || '')));
    cards.forEach((a) => grid.appendChild(document.importNode(a, true)));
    const empty = document.querySelector('[data-mw-blog-empty]');
    if (empty && !cards.length) empty.hidden = false;
  }

  /* Lone last card: style.css handles it with nth-of-type, which also counts cards JS has hidden (page filters,
     wishlist removals). While some are hidden, those rules are off and the last shown card is marked here. */
  function tidyLoneCard(g) {
    const kids = Array.from(g.children).filter((c) => c.matches('.mw-card, .mw-wish-cell'));
    const shown = kids.filter((c) => getComputedStyle(c).display !== 'none');
    kids.forEach((c) => c.classList.remove('is-lone'));
    g.classList.toggle('is-filtered', shown.length < kids.length);
    if (shown.length === kids.length) return;
    const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
    if (cols < 2 || shown.length % cols !== 1 || (shown.length === 1 && cols > 2)) return;
    g.style.setProperty('--mw-lone-n', cols);
    shown[shown.length - 1].classList.add('is-lone');
  }
  function watchLoneCards() {
    const grids = document.querySelectorAll('.mw-products--grid, .mw-products--wish');
    if (!grids.length) return;
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => grids.forEach(tidyLoneCard)); };
    grids.forEach((g) => new MutationObserver((ms) => {
      if (ms.some((m) => m.type === 'childList' || m.target.parentNode === g)) run();
    }).observe(g, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] }));
    window.addEventListener('resize', run, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', () => { mountCurrency(); fixPagination(); fillYear(); mergeBlogPosts(); watchLoneCards(); });

  /* ---------- Boot ---------- */
  document.addEventListener('alpine:initialized', () => {
    loadDemo();
  });

  // Keep the cart fresh when returning via back/forward cache
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && window.Alpine) window.Alpine.store('mw').refresh();
  });

  // Public helpers (also documented as CartManager in the Qumra docs)
  window.mwAdd = (id, qty, variantId, opts) => window.Alpine && window.Alpine.store('mw').add(id, qty, variantId, opts);
  window.mwBusy = (key) => !!(window.Alpine && window.Alpine.store('mw').isBusy(key));
  window.CartManager = {
    add: (id, qty, variantId) => window.mwAdd(id, qty || 1, variantId),
    buy: (id, qty, variantId) => window.mwAdd(id, qty || 1, variantId, { buy: true }),
    update: (itemId, qty) => window.Alpine.store('mw').change({ _id: itemId, quantity: 0 }, qty),
    increment: (itemId, cur) => window.Alpine.store('mw').change({ _id: itemId, quantity: cur || 0 }, (cur || 0) + 1),
    decrement: (itemId, cur) => window.Alpine.store('mw').change({ _id: itemId, quantity: cur || 1 }, (cur || 1) - 1),
    remove: (itemId) => window.Alpine.store('mw').remove({ _id: itemId })
  };
})();
