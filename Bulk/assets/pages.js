/* ==========================================================
   DARK BLOOD - PAGES ENGINE
   بيعتمد على main.js (blkRegister, blkPost, blkMoney, CartManager, showQmraToast)
   ========================================================== */

function blkEscape(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function blkDebounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// كل طلبات /ajax/search/products بتعدي من هنا.
// limit بيطلع خطأ 500 من سيرفر قمرة ("invalid argument to $limit stage": بيقراه نص مش رقم)،
// فمش بنبعته خالص، والعرض بيتقص على العدد المطلوب في الثيم
let blkLimitUnsupported = true;

// رد بحث فيه قايمة منتجات (نفس الأشكال اللي blkPickProducts بيقبلها)
function blkHasProductList(data) {
  if (Array.isArray(data)) return true;
  return !!data && typeof data === 'object' && [data.products, data.results, data.items, data.data, data.data && data.data.products].some(Array.isArray);
}

// بحث المنتجات: SearchManager بتاع المنصة لو موجود (docs/store-ajax/search.md)، وإلا fetch عادي.
// بيرجّع { ok, status, data } بنفس الشكل في الحالتين؛ لو المانجر رجّع حاجة مش متوقعة بنكمّل بالـ fetch
async function blkSearchProductsRequest(query) {
  const sm = window.SearchManager;
  if (sm && typeof sm.search === 'function') {
    try {
      const filters = {};
      query.forEach((v, k) => { if (k !== 'q') filters[k] = v; });
      const data = await sm.search(query.get('q') || '', filters);
      if (blkHasProductList(data)) return { ok: true, status: 200, data };
    } catch (err) { /* نكمّل بالـ fetch */ }
  }
  const res = await blkFetchRetry(`/ajax/search/products?${query}`, { headers: { Accept: 'application/json' } });
  const data = res.ok ? await res.json().catch(() => null) : null;
  return { ok: res.ok, status: res.status, data };
}

async function blkFetchSearch(params) {
  const query = new URLSearchParams(params);
  if (blkLimitUnsupported) query.delete('limit');

  const get = async (q) => {
    const { ok, status, data } = await blkSearchProductsRequest(q);
    return { res: { ok, status }, data };
  };

  let { res, data } = await get(query);
  if (query.has('limit') && (!res.ok || !blkPickProducts(data).length)) {
    query.delete('limit');
    const retry = await get(query);
    if (retry.res.ok && blkPickProducts(retry.data).length) {
      blkLimitUnsupported = true;
      try { sessionStorage.setItem('blkNoLimit', '1'); } catch (err) { /* التخزين مقفول */ }
    }
    ({ res, data } = retry);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return data;
}

function blkClampQty(input) {
  const min = Number(input.min) || 1;
  const max = Number(input.max) || Infinity;
  let val = parseInt(input.value, 10);
  if (!Number.isFinite(val) || val < min) val = min;
  if (val > max) val = max;
  input.value = val;
  return val;
}

// قسم/مجموعة متعطّل عنها البيع مابتظهرش في المتجر (قوائم، كروت، مسار التنقل، بادج المنتج).
// المنصة ممكن تبعت الحالة بأكتر من اسم، فأي علامة تعطيل صريحة بتخفيه.
// نفس الشروط مكتوبة في القوالب (catHidden / colHidden) — أي تعديل هنا يتعمل هناك كمان
const BLK_HIDDEN_STATUSES = ['inactive', 'disabled', 'draft', 'hidden', 'archived', 'unpublished'];

function blkIsCollectionVisible(c) {
  if (!c || typeof c !== 'object') return !!c;
  if ([c.active, c.isActive, c.published, c.isPublished, c.visible, c.isVisible, c.availableForSale, c.enabled, c.salesEnabled].some(v => v === false)) return false;
  if (c.hidden === true || c.isHidden === true || c.deleted === true) return false;
  // REG-01..04: المجموعة اتقفل عنها البيع في المتجر الإلكتروني (salesChannels.shop بيبقى false على كل المتاجر، فمانعتمدش عليه)
  if (c.salesChannels && c.salesChannels.onlineStore === false) return false;
  return !BLK_HIDDEN_STATUSES.includes(String(c.status || '').toLowerCase());
}

// حالة المخزون في صفحة المنتج: النص + النقطة + الشريط + الكمية + أزرار الإضافة + صف المواصفات.
// بيتنادى أول ما الصفحة تفتح (مخزون المنتج) ومع كل اختيار نسخة (مخزون النسخة نفسها). بيرجّع in | low | out
function blkPdpSetStock(root, qty) {
  const state = blkStockState(qty);
  const text = blkStockText(state, qty);

  const stock = root.querySelector('[data-pdp-stock]');
  if (stock) {
    stock.classList.remove('is-in', 'is-low', 'is-out');
    stock.classList.add(`is-${state}`);
    stock.innerHTML = `<span class="blk-stock-dot${state === 'in' ? '' : ` is-${state}`}" aria-hidden="true"></span> <span data-pdp-stock-text>${blkEscape(text)}</span>`;
  }

  const bar = root.querySelector('[data-pdp-stock-bar]');
  if (bar) {
    bar.hidden = state !== 'low';
    if (state === 'low' && bar.firstElementChild) bar.firstElementChild.style.width = `${Math.min(100, Math.round(qty / BLK_LOW_STOCK * 34))}%`;
  }

  // الكمية القصوى = المتاح، والعدّاد معطّل لما ينفد
  const qtyInput = root.querySelector('[data-qty-input]');
  if (qtyInput) {
    if (BLK_FOLLOW_STOCK && typeof qty === 'number' && qty > 0) qtyInput.max = qty;
    else qtyInput.removeAttribute('max');
    qtyInput.disabled = state === 'out';
    if (state !== 'out') blkClampQty(qtyInput);
  }
  root.querySelectorAll('[data-qty-step]').forEach(btn => { btn.disabled = state === 'out'; });

  root.querySelectorAll('[data-pdp-add]').forEach(btn => {
    btn.disabled = state === 'out';
    if (btn.hasAttribute('data-pdp-buynow')) return;
    const label = btn.querySelector('[data-pdp-add-label]') || btn.querySelector('span');
    if (label) label.textContent = state === 'out' ? blkT('outOfStock') : blkT('addToCart');
  });

  const spec = root.querySelector('[data-pdp-spec-stock]');
  if (spec) spec.textContent = text;
  root.setAttribute('data-stock-state', state);
  // الرقم اللي الإضافة للسلة بتتقاس عليه (blkAddWithinStock)
  root.setAttribute('data-stock-qty', typeof qty === 'number' && Number.isFinite(qty) ? qty : '');
  return state;
}



/* ==========================================================
   1. PRODUCT PAGE
   ========================================================== */

blkRegister('.blk-pdp', initProductPage);

// ألوان شائعة بالعربي والإنجليزي عشان الـ swatch يبان لون حقيقي لو المنصة مابعتتش كود اللون
const BLK_COLOR_NAMES = {
  'أسود': '#111111', 'اسود': '#111111', 'black': '#111111',
  'أبيض': '#f5f5f5', 'ابيض': '#f5f5f5', 'white': '#f5f5f5',
  'أحمر': '#c81e1e', 'احمر': '#c81e1e', 'red': '#c81e1e',
  'نبيتي': '#6b0f1a', 'عنابي': '#6b0f1a', 'maroon': '#6b0f1a', 'burgundy': '#6b0f1a',
  'أزرق': '#2563eb', 'ازرق': '#2563eb', 'blue': '#2563eb',
  'كحلي': '#1e2a4a', 'navy': '#1e2a4a',
  'رمادي': '#8a8a8a', 'رصاصي': '#8a8a8a', 'gray': '#8a8a8a', 'grey': '#8a8a8a',
  'أخضر': '#16a34a', 'اخضر': '#16a34a', 'green': '#16a34a',
  'زيتي': '#4b5320', 'olive': '#4b5320',
  'أصفر': '#facc15', 'اصفر': '#facc15', 'yellow': '#facc15',
  'برتقالي': '#f97316', 'orange': '#f97316',
  'بيج': '#d6c3a5', 'beige': '#d6c3a5',
  'بني': '#7a4a2a', 'brown': '#7a4a2a',
  'وردي': '#ec4899', 'بينك': '#ec4899', 'pink': '#ec4899',
  'بنفسجي': '#7c3aed', 'موف': '#7c3aed', 'purple': '#7c3aed'
};

function blkSwatchColor(chip) {
  const given = (chip.getAttribute('data-swatch') || '').trim();
  if (given) return given;
  const label = (chip.getAttribute('data-value-label') || '').trim().toLowerCase();
  if (BLK_COLOR_NAMES[label]) return BLK_COLOR_NAMES[label];
  const hit = Object.keys(BLK_COLOR_NAMES).find(name => label.includes(name));
  return hit ? BLK_COLOR_NAMES[hit] : '';
}

/* ==========================================================
   PRODUCT PAGE PREVIEW (المحرر بيفتح صفحة المنتج من غير product)
   بنجيب أول منتج من متجر التاجر ونحطه مكان المنتج التجريبي.
   لو المتجر فاضي أو حصل خطأ، المنتج التجريبي بيفضل زي ما هو.
   ========================================================== */

// /product/<slug> → slug (المنتج اللي العميل فتحه)
function blkProductHandleFromUrl() {
  const m = window.location.pathname.match(/\/(?:products?|shop)\/([^/?#]+)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (err) { return m[1]; }
}

// المنتج بالـ handle: ProductManager بتاع المنصة لو موجود (docs/store-ajax/product.md)، وإلا fetch عادي. null = مفيش
// لو المانجر رجّع حاجة مش منتج بنكمّل بالـ fetch
async function blkProductRequest(handle) {
  const pm = window.ProductManager;
  if (pm && typeof pm.get === 'function') {
    try {
      const data = await pm.get(handle);
      const product = (data && (data.product || data.data)) || data;
      if (product && product._id) return data;
    } catch (err) { /* نكمّل بالـ fetch */ }
  }
  const res = await blkFetchRetry(`/ajax/product?handle=${encodeURIComponent(handle)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

async function blkFetchProductByHandle(handle) {
  try {
    const data = await blkProductRequest(handle);
    if (!data) return null;
    const product = (data && (data.product || data.data)) || data;
    if (!product || !product._id) return null;
    // لو السيرفر رجّع منتج تاني (مش بيفلتر بالـ handle) مانقبلوش
    const norm = v => { try { return decodeURIComponent(String(v || '')).trim().toLowerCase(); } catch (err) { return String(v || '').trim().toLowerCase(); } };
    const wanted = norm(handle);
    const keys = [product.slug, product.handle, product._id, product.seo && product.seo.slug].filter(Boolean).map(norm);
    if (keys.length && !keys.includes(wanted)) {
      console.warn('[pdp] /ajax/product returned a different product for "' + handle + '"');
      return null;
    }
    return product;
  } catch (err) {
    return null;
  }
}

// المنتج اللي في اللينك لو موجود، وإلا أول منتج في المتجر (معاينة القالب في المحرر)
async function blkLoadPreviewProduct(handle, exactOnly) {
  if (handle) {
    const exact = await blkFetchProductByHandle(handle);
    if (exact) return exact;
  }

  // من غير handle محتاجين أول منتج بس، ومع handle بندوّر في عدد معقول
  const found = await blkFetchSearch({ q: '', limit: String(handle ? 50 : 1) }).catch(() => null);
  if (!found) return null;
  const list = blkPickProducts(found).filter(p => p && p._id);
  // الكارت ممكن يكون حاط الـ _id في اللينك بدل الـ slug
  const match = handle ? list.find(p => [blkProductSlug(p), p.slug, p.handle, p._id].includes(handle)) : null;
  // فيه منتج مختار للمعاينة: لو اللينك مش لمنتج موجود بنسيب المنتج المختار
  if (handle && !match && exactOnly) return null;
  // اللينك مالقاش منتج: غالباً معاينة المحرر (لينكها مش لينك منتج)، فبنعرض أول منتج من المتجر.
  // على المتجر نفسه المنصة بترجّع 404 لمنتج مش موجود قبل ما الصفحة دي تشتغل
  if (handle && !match) console.warn('[pdp] no store product matches "' + handle + '", showing the first store product');
  const first = match || list[0];
  if (!first) return null;

  // نتيجة البحث ممكن تبقى مختصرة: بنجيب المنتج كامل (الخيارات والوصف) لو نقدر
  const full = (first.slug || first.handle) && await blkFetchProductByHandle(first.slug || first.handle);
  return full ? Object.assign({}, first, full) : first;
}

function blkHydrateProduct(root, p) {
  const $ = sel => root.querySelector(sel);
  const $$ = sel => Array.from(root.querySelectorAll(sel));
  const esc = blkEscape;
  const price = p.pricing ? Number(p.pricing.price) || 0 : Number(p.price) || 0;
  const oldPrice = p.pricing ? Number(p.pricing.compareAtPrice) || 0 : 0;
  const hasDiscount = oldPrice > price;
  const images = (p.images || []).map(i => (i && (i.fileUrl || i.url)) || i).filter(i => typeof i === 'string' && i);
  const options = Array.isArray(p.options) ? p.options.filter(o => o && Array.isArray(o.values) && o.values.length) : [];
  // القسم المتعطّل مايظهرش في المسار ولا البادج
  const category = p.category && p.category.title && blkIsCollectionVisible(p.category) ? p.category : null;
  const reviews = Number(p.reviewsCount) || 0;
  const rating = Number(p.averageRating) || 0;
  const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  const url = blkProductUrl(p);

  root.removeAttribute('data-demo-product');
  root.removeAttribute('data-preview-product');
  const variantsEl = root.querySelector('[data-pdp-variants]');
  if (variantsEl) variantsEl.textContent = JSON.stringify(Array.isArray(p.variants) ? p.variants : []);
  root.setAttribute('data-product-id', p._id);
  root.setAttribute('data-options-count', options.length);
  root.setAttribute('data-product-title', p.title || '');
  root.setAttribute('data-product-url', url);
  root.setAttribute('data-product-image', images[0] || '');
  root.setAttribute('data-product-price', price);
  root.setAttribute('data-product-old', hasDiscount ? oldPrice : 0);

  // الاسم
  $$('.blk-pdp-title, .blk-pdp-sticky-title, .blk-pdp-crumb [aria-current="page"]').forEach(el => { el.textContent = p.title || ''; });

  // القسم
  // قسم تجريبي بيفتح بمنتجاته التجريبية (?demo=1)، والحقيقي بالـ id
  const isDemoCat = category && String(category._id || '').startsWith('demo-cat-');
  const catQuery = !category || isDemoCat ? '' : category._id ? `?cid=${encodeURIComponent(category._id)}` : '';
  const catUrl = !category ? '' : isDemoCat ? blkDemoCategoryUrl(category.slug)
    : `/collections/${encodeURIComponent(category.slug || category.handle || category._id || '')}${catQuery}`;
  $$('.blk-pdp-info > .blk-cat-badge, .blk-pdp-crumb a[href*="/collections/"], .blk-pdp-meta a[href*="/collections/"], .blk-pdp-crumb a[href*="category="], .blk-pdp-meta a[href*="category="]').forEach(el => {
    if (!category) {
      (el.closest('.blk-pdp-meta > div') || el).hidden = true;
      // مسار التنقل: نشيل الفاصل اللي بعد القسم كمان
      const sep = el.nextElementSibling;
      if (el.closest('.blk-pdp-crumb') && sep && sep.classList.contains('blk-breadcrumb-sep')) sep.hidden = true;
      return;
    }
    el.textContent = category.title;
    if (el.tagName === 'A') el.setAttribute('href', catUrl);
  });

  // التقييم
  const ratingEl = $('.blk-pdp-rating');
  if (ratingEl) ratingEl.innerHTML = `<span class="blk-stars">${stars(rating)}</span><span>${reviews ? `${rating} (${reviews} ${blkT('reviewsWord')})` : blkT('noReviews')}</span>`;
  const reviewsTab = $('[data-pdp-tab="reviews"]');
  if (reviewsTab) reviewsTab.textContent = `${blkT('tabReviews')} (${reviews})`;
  const summary = $('.blk-pdp-reviews-summary');
  if (summary) {
    summary.innerHTML = `<span class="blk-pdp-reviews-score">${reviews ? rating : '—'}</span><div><span class="blk-stars blk-pdp-reviews-stars">${stars(rating)}</span><p>${reviews ? `${blkT('basedOn')} ${reviews} ${blkT('reviewsWord')}` : blkT('noReviewsLong')}</p></div>`;
  }
  $$('.blk-pdp-reviews').forEach(el => el.remove());
  if (summary && Array.isArray(p.reviews) && p.reviews.length) {
    const list = document.createElement('ul');
    list.className = 'blk-pdp-reviews';
    list.innerHTML = p.reviews.map(r => {
      const name = esc(r.name || r.author || blkT('customer'));
      const n = Math.max(0, Math.min(5, Math.round(Number(r.rating) || 5)));
      return `<li class="blk-pdp-review"><div class="blk-pdp-review-head"><span class="blk-pdp-review-avatar">${name.charAt(0)}</span><strong>${name}</strong><span class="blk-stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span></div><p>${esc(r.comment || r.content || r.text || '')}</p></li>`;
    }).join('');
    summary.after(list);
  }

  // السعر والخصم
  $$('[data-pdp-price]').forEach(el => { el.textContent = blkPrice(price); });
  const oldEl = $('[data-pdp-old]');
  if (oldEl) { oldEl.hidden = !hasDiscount; oldEl.textContent = hasDiscount ? blkMoney(oldPrice) : ''; }
  const saveEl = $('[data-pdp-save]');
  if (saveEl) { saveEl.hidden = !hasDiscount; saveEl.textContent = hasDiscount ? `${blkT('save')} ${blkMoney(oldPrice - price)}` : ''; }
  const badges = $('.blk-pdp-main .blk-prod-badges');
  // المخزون الفعلي (لو كل النسخ خلصت يبقى نفد) بنفس قاعدة الكارت والقالب
  const stockQty = blkProductQty(p);
  const outOfStock = blkStockState(stockQty) === 'out';
  if (badges) {
    badges.innerHTML = (hasDiscount ? `<span class="blk-badge-glass blk-badge-discount">-${Math.floor((oldPrice - price) / oldPrice * 100)}%</span>` : '')
      + (outOfStock ? `<span class="blk-badge-glass blk-badge-out">${blkEscape(blkT('outOfStock'))}</span>` : '');
  }

  // المخزون: متوفر / أوشك على النفاد / نفد + الكمية والأزرار
  blkPdpSetStock(root, stockQty);

  // الصور
  const pics = images.length ? images : [BLK_NO_IMAGE];
  const track = $('[data-pdp-track]');
  if (track) {
    track.innerHTML = pics.map((src, i) => `<div class="blk-pdp-slide" data-pdp-slide="${i}"><img src="${esc(src)}" alt="${esc(p.title)}" class="blk-pdp-main-img" ${i ? 'loading="lazy"' : ''} draggable="false" /></div>`).join('');
  }
  const thumbs = $('.blk-pdp-thumbs');
  if (thumbs) {
    thumbs.hidden = pics.length < 2;
    thumbs.innerHTML = pics.map((src, i) => `<button type="button" class="blk-pdp-thumb${i ? '' : ' is-active'}" data-pdp-thumb="${i}" role="tab" aria-selected="${i ? 'false' : 'true'}" aria-label="${blkEscape(blkT('image'))} ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy" /></button>`).join('');
  }
  $$('[data-pdp-prev], [data-pdp-next], .blk-pdp-counter').forEach(el => { el.hidden = pics.length < 2; });
  const dotsEl = $('.blk-pdp-dots');
  if (dotsEl) { dotsEl.hidden = pics.length < 2; dotsEl.innerHTML = pics.map((_, i) => `<span class="blk-pdp-dot${i ? '' : ' is-active'}"></span>`).join(''); }
  const counter = $('.blk-pdp-counter');
  if (counter) counter.innerHTML = `<span data-pdp-current>1</span> / ${pics.length}`;
  const stickyImg = $('.blk-pdp-sticky-img');
  if (stickyImg) stickyImg.src = pics[0];

  // الخيارات (اللون دواير، والمقاس معاه دليل المقاسات لو موجود)
  const optionsWrap = $('.blk-pdp-options');
  if (optionsWrap) {
    const hasGuide = !!$('[data-pdp-guide]');
    optionsWrap.hidden = !options.length;
    optionsWrap.innerHTML = options.map((o, i) => {
      const name = o.name || '';
      const lower = name.toLowerCase();
      const isColor = name.includes('لون') || lower.includes('color') || lower.includes('colour');
      const isSize = name.includes('مقاس') || lower.includes('size');
      const chips = o.values.map(v => {
        const label = v.label || v.value || v.name || '';
        const swatch = v.color || v.hex || (typeof v.value === 'string' && v.value[0] === '#' ? v.value : '');
        return isColor
          ? `<button type="button" class="blk-pdp-chip blk-pdp-swatch" role="radio" aria-checked="false" data-value-id="${esc(v._id)}" data-value-label="${esc(label)}" title="${esc(label)}" data-swatch="${esc(swatch)}"><span class="blk-pdp-swatch-dot"></span><span class="blk-pdp-swatch-label">${esc(label)}</span></button>`
          : `<button type="button" class="blk-pdp-chip" role="radio" aria-checked="false" data-value-id="${esc(v._id)}" data-value-label="${esc(label)}">${esc(label)}</button>`;
      }).join('');
      return `<div class="blk-pdp-option${isColor ? ' is-color' : ''}" data-pdp-option="${i}">
          <div class="blk-pdp-option-head">
            <span class="blk-pdp-option-name">${esc(name)}</span>
            <span class="blk-pdp-option-value" data-pdp-option-label>${esc(blkT('chooseOption', { name }))}</span>
            ${isSize && hasGuide ? `<button type="button" class="blk-pdp-guide-btn" data-pdp-guide-open>${blkEscape(blkT('sizeGuide'))}</button>` : ''}
          </div>
          <div class="blk-pdp-option-values" role="radiogroup" aria-label="${esc(name)}">${chips}</div>
          <p class="blk-pdp-option-error" data-pdp-option-error role="alert" hidden></p>
        </div>`;
    }).join('');
  }

  // الوصف (HTML من لوحة التحكم بتاعة التاجر)
  const desc = $('[data-pdp-panel="desc"]');
  if (desc) desc.innerHTML = p.description ? `<div class="blk-rich-text">${p.description}</div>` : `<p class="blk-pdp-panel-empty">${blkEscape(blkT('noDescription'))}</p>`;

  // المواصفات
  const specs = $('.blk-pdp-specs tbody');
  if (specs) {
    const rows = [];
    if (category) rows.push([blkT('category'), category.title]);
    options.forEach(o => rows.push([o.name, o.values.map(v => v.label || v.value || '').join(blkT('listSep'))]));
    if (p.sku) rows.push([blkT('sku'), p.sku]);
    specs.innerHTML = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')
      + `<tr><th>${blkEscape(blkT('status'))}</th><td data-pdp-spec-stock>${esc(root.querySelector('[data-pdp-stock-text]')?.textContent || '')}</td></tr>`;
  }

  // SKU والوسوم
  const skuRow = $('[data-pdp-sku-row]');
  if (skuRow) { skuRow.hidden = !p.sku; const sku = skuRow.querySelector('[data-pdp-sku]'); if (sku) sku.textContent = p.sku || ''; }
  const tags = $('.blk-pdp-tags');
  if (tags) {
    const list = (Array.isArray(p.tags) ? p.tags : []).map(blkTagName).filter(t => t && t !== 'hot');
    tags.innerHTML = list.map(t => { const v = t.split(':').pop().trim(); return `<a href="/search?q=${encodeURIComponent(v)}">#${esc(v)}</a>`; }).join('');
    const row = tags.closest('.blk-pdp-meta > div');
    if (row) row.hidden = !list.length;
  }
}

// لو المحرر فتح الصفحة بمنتج تجريبي، بنجيب منتج من المتجر الأول وبعدين نشغّل الصفحة
function initProductPage(root) {
  // المنصة أحياناً مابتبعتش product للصفحة: القالب بيعرض منتج المعاينة أو منتج تجريبي،
  // فبنجيب المنتج اللي في اللينك (/product/<slug>)، ولو مفيش لينك منتج بنجيب أول منتج في المتجر
  const handle = blkProductHandleFromUrl();
  const isDemo = root.hasAttribute('data-demo-product');
  const isPreview = root.hasAttribute('data-preview-product');
  const previewIsThisProduct = isPreview && (!handle || handle === root.getAttribute('data-product-slug') || handle === root.getAttribute('data-product-id'));

  // لينك منتج تجريبي (/product/demo-xx?demo=1): بنعرضه من الكتالوج التجريبي من غير ما نكلّم السيرفر
  const demoProduct = (isDemo || isPreview) && handle && blkDemoProductBySlug(handle);
  if (demoProduct && !root.hasAttribute('data-preview-done')) {
    root.setAttribute('data-preview-done', '');
    blkHydrateProduct(root, demoProduct);
    root.setAttribute('data-demo-product', '');
    initProductPageCore(root);
    return;
  }

  if ((isDemo || (isPreview && !previewIsThisProduct)) && !root.hasAttribute('data-preview-done')) {
    root.setAttribute('data-preview-done', '');
    root.classList.add('is-hydrating');
    blkLoadPreviewProduct(handle, isPreview)
      .then(p => { if (p) blkHydrateProduct(root, p); })
      .catch(err => console.warn('[pdp] loading a store product for preview failed, keeping demo:', err))
      .finally(() => {
        root.classList.remove('is-hydrating');
        initProductPageCore(root);
      });
    return;
  }
  initProductPageCore(root);
}

function initProductPageCore(root) {
  const productId = root.getAttribute('data-product-id');
  // منتج تجريبي (معاينة المحرر): مفيش variants ولا سلة حقيقية
  const isDemo = root.hasAttribute('data-demo-product');
  const optionsCount = Number(root.getAttribute('data-options-count')) || 0;
  const qtyInput = root.querySelector('[data-qty-input]');
  const addBtns = root.querySelectorAll('[data-pdp-add]');
  const selected = new Array(optionsCount).fill(null);
  const selectedLabels = new Array(optionsCount).fill('');
  let variantId = null;

  // نسخ المنتج من القالب (أو من المنتج اللي اتجاب في المحرر)
  const variants = (() => {
    try {
      const el = root.querySelector('[data-pdp-variants]');
      const list = JSON.parse(el ? el.textContent : '[]');
      return Array.isArray(list) ? list.filter(v => v && v._id) : [];
    } catch (err) {
      return [];
    }
  })();

  // قيم كل نسخة (ids وأسماء) عشان نطابقها بالاختيارات
  const variantValues = v => {
    const raw = v.options || v.optionValues || v.values || [];
    return (Array.isArray(raw) ? raw : Object.values(raw)).map(o => (o && typeof o === 'object')
      ? [o._id, o.id, o.valueId, o.value, o.label, o.name].filter(x => x != null).map(String)
      : [String(o)]);
  };
  const variantEntries = variants.map(v => ({ v, vals: variantValues(v), keys: new Set(variantValues(v).flat()) }));
  // النسخ فيها معلومات الخيارات؟ من غيرها مانقدرش نعرف أنهي اختيار نفد قبل ما السيرفر يرد
  const canMapVariants = variantEntries.some(e => e.keys.size);
  const variantInStock = v => blkStockState(typeof v.quantity === 'number' ? v.quantity : null) !== 'out';

  // النسخة اللي قيمها = اللي العميل اختاره (بالـ id أو بالاسم)، لو السيرفر مارجّعهاش
  const matchVariantLocally = () => {
    const hit = variantEntries.find(({ vals }) => vals.length && selected.every((id, i) => vals.some(set => set.includes(String(id)) || set.includes(String(selectedLabels[i])))));
    return hit ? hit.v : undefined;
  };
  let resolving = false;
  // حالة المخزون الحالية (المنتج، وبعد اختيار نسخة: النسخة)
  let stockState = root.getAttribute('data-stock-state') || (root.querySelector('[data-pdp-stock].is-out') ? 'out' : root.querySelector('[data-pdp-stock].is-low') ? 'low' : 'in');

  /* ===== Gallery: سحب + أسهم + thumbnails + زووم ===== */
  const track = root.querySelector('[data-pdp-track]');
  const slides = track ? Array.from(track.querySelectorAll('.blk-pdp-slide')) : [];
  const thumbs = Array.from(root.querySelectorAll('[data-pdp-thumb]'));
  const counter = root.querySelector('[data-pdp-current]');
  let current = 0;

  const dots = Array.from(root.querySelectorAll('.blk-pdp-dot'));
  const setActive = (index) => {
    current = index;
    dots.forEach((d, i) => d.classList.toggle('is-active', i === index));
    thumbs.forEach((t, i) => {
      t.classList.toggle('is-active', i === index);
      t.setAttribute('aria-selected', String(i === index));
    });
    if (counter) counter.textContent = index + 1;
  };

  const goTo = (index, smooth = true) => {
    if (!slides.length) return;
    const i = (index + slides.length) % slides.length;
    // scrollIntoView بيحسب الاتجاه صح في RTL من غير حسابات scrollLeft
    slides[i].scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest', inline: 'start' });
    setActive(i);
  };

  if (track && slides.length > 1 && 'IntersectionObserver' in window) {
    // السلايد الظاهر = اللي أغلب مساحته جوه الـ track
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          setActive(Number(entry.target.getAttribute('data-pdp-slide')));
        }
      });
    }, { root: track, threshold: [0.6] });
    slides.forEach(slide => io.observe(slide));
  }

  thumbs.forEach(thumb => {
    thumb.addEventListener('click', () => goTo(Number(thumb.getAttribute('data-pdp-thumb'))));
  });
  root.querySelector('[data-pdp-prev]')?.addEventListener('click', () => goTo(current - 1));
  root.querySelector('[data-pdp-next]')?.addEventListener('click', () => goTo(current + 1));

  // زووم مع حركة الماوس على الكمبيوتر
  const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (canHover) {
    slides.forEach(slide => {
      const img = slide.querySelector('img');
      slide.addEventListener('mousemove', (e) => {
        const r = slide.getBoundingClientRect();
        img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
        slide.classList.add('is-zoom');
      });
      slide.addEventListener('mouseleave', () => slide.classList.remove('is-zoom'));
    });
  }

  /* ===== Lightbox ===== */
  const lightbox = root.querySelector('[data-pdp-lightbox]');
  if (lightbox && slides.length) {
    const lbImg = lightbox.querySelector('[data-pdp-lb-img]');
    const lbCount = lightbox.querySelector('[data-pdp-lb-count]');
    const sources = slides.map(s => s.querySelector('img').src);
    const isRtl = () => document.documentElement.dir === 'rtl';
    let lbIndex = 0;
    let lastFocus = null;

    // PRD-02: الضغط على الصورة بيكبّرها 2× عند مكان الضغط، والضغط تاني بيرجّعها
    const lbStage = lightbox.querySelector('[data-pdp-lb-stage]') || lbImg;
    const unzoom = () => { lbStage.classList.remove('is-zoomed'); lbImg.style.transformOrigin = ''; };
    const origin = (e) => {
      const r = lbImg.getBoundingClientRect();
      const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
      const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
      lbImg.style.transformOrigin = `${x}% ${y}%`;
    };
    lbImg.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lbStage.classList.contains('is-zoomed')) { unzoom(); return; }
      origin(e);
      lbStage.classList.add('is-zoomed');
    });
    lbImg.addEventListener('mousemove', (e) => { if (lbStage.classList.contains('is-zoomed')) origin(e); });
    const show = (i) => {
      unzoom();
      lbIndex = (i + sources.length) % sources.length;
      lbImg.src = sources[lbIndex];
      if (lbCount) lbCount.textContent = sources.length > 1 ? `${lbIndex + 1} / ${sources.length}` : '';
    };
    const open = (i) => {
      lastFocus = document.activeElement;
      show(i);
      lightbox.hidden = false;
      document.documentElement.classList.add('blk-no-scroll');
      lightbox.querySelector('[data-pdp-lb-close]').focus();
    };
    const close = () => {
      unzoom();
      lightbox.hidden = true;
      document.documentElement.classList.remove('blk-no-scroll');
      goTo(lbIndex, false);
      if (lastFocus) lastFocus.focus();
    };

    root.querySelector('[data-pdp-expand]')?.addEventListener('click', () => open(current));
    slides.forEach((slide, i) => slide.addEventListener('click', () => open(i)));
    lightbox.querySelector('[data-pdp-lb-close]').addEventListener('click', close);
    lightbox.querySelector('[data-pdp-lb-prev]')?.addEventListener('click', () => show(lbIndex - 1));
    lightbox.querySelector('[data-pdp-lb-next]')?.addEventListener('click', () => show(lbIndex + 1));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) close(); });

    document.addEventListener('keydown', (e) => {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(lbIndex + (isRtl() ? 1 : -1));
      if (e.key === 'ArrowRight') show(lbIndex + (isRtl() ? -1 : 1));
    });

    // سحب بالصباع جوه الـ lightbox
    let touchX = null;
    lightbox.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) < 40) return;
      show(lbIndex + ((dx < 0) !== isRtl() ? 1 : -1));
    });
  }

  /* ===== Quantity ===== */
  // الكمية مابتعدّيش المتاح، ولما العميل يوصل للحد بنقوله المتاح كام
  const qtyNote = root.querySelector('[data-pdp-qty-note]');
  let qtyNoteTimer;
  // رسالة جنب زرار الإضافة (الحد الأقصى، أو إن الكمية المتاحة كلها في السلة)
  const showLimitNote = (message) => {
    if (!qtyNote || !message) return;
    qtyNote.textContent = message;
    qtyNote.hidden = false;
    clearTimeout(qtyNoteTimer);
    qtyNoteTimer = setTimeout(() => { qtyNote.hidden = true; }, 3500);
  };
  const showQtyLimit = () => {
    if (!qtyInput || !qtyInput.max) return;
    showLimitNote(blkT('maxQty', { count: qtyInput.max }));
  };
  const setQty = (raw) => {
    if (!qtyInput || qtyInput.disabled) return;
    const wanted = parseInt(raw, 10);
    qtyInput.value = raw;
    const val = blkClampQty(qtyInput);
    if (Number.isFinite(wanted) && wanted > val) showQtyLimit();
  };
  root.querySelectorAll('[data-qty-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!qtyInput) return;
      setQty((parseInt(qtyInput.value, 10) || 1) + Number(btn.getAttribute('data-qty-step')));
    });
  });
  if (qtyInput) qtyInput.addEventListener('change', () => setQty(qtyInput.value));

  /* ===== Options → Variant ===== */
  const optionEls = Array.from(root.querySelectorAll('[data-pdp-option]'));
  const selectedChips = new Array(optionsCount).fill(null);
  const chipKeys = chip => [chip.getAttribute('data-value-id'), chip.getAttribute('data-value-label')].filter(Boolean);
  const entryHas = (entry, chip) => chipKeys(chip).some(k => entry.keys.has(k));

  // الاختيارات اللي مفيش منها نسخة متاحة (مع باقي الاختيارات الحالية) بتتشطب.
  // بتفضل قابلة للضغط عشان العميل يشوف إنها "نفد من المخزون" (والزرار بيتقفل)
  const refreshAvailability = () => {
    if (!canMapVariants) return;
    optionEls.forEach(optionEl => {
      const i = Number(optionEl.getAttribute('data-pdp-option'));
      optionEl.querySelectorAll('.blk-pdp-chip').forEach(chip => {
        const ok = variantEntries.some(entry => entry.keys.size && variantInStock(entry.v) && entryHas(entry, chip)
          && selectedChips.every((sel, j) => j === i || !sel || entryHas(entry, sel)));
        chip.classList.toggle('is-unavailable', !ok);
        const label = chip.getAttribute('data-value-label') || '';
        chip.setAttribute('aria-label', ok ? label : `${label} - ${blkT('outOfStock')}`);
        chip.setAttribute('aria-disabled', String(!ok));
      });
    });
  };

  const setOptionError = (optionEl, on) => {
    const err = optionEl.querySelector('[data-pdp-option-error]');
    optionEl.classList.toggle('is-missing', on);
    if (!err) return;
    const name = optionEl.querySelector('.blk-pdp-option-name')?.textContent.trim() || '';
    err.textContent = on ? blkT('chooseOptionError', { name }) : '';
    err.hidden = !on;
  };

  const updateVariantUI = (variant) => {
    // السعر ممكن ييجي variant.price أو variant.pricing.price، ولو مش موجود بنسيب سعر المنتج
    const vPrice = typeof variant.price === 'number' ? variant.price : (variant.pricing && typeof variant.pricing.price === 'number' ? variant.pricing.price : null);
    const vOld = Number(variant.compareAtPrice != null ? variant.compareAtPrice : (variant.pricing && variant.pricing.compareAtPrice)) || 0;
    if (vPrice !== null) {
      root.querySelectorAll('[data-pdp-price]').forEach(el => { el.textContent = blkPrice(vPrice); });
      const oldEl = root.querySelector('[data-pdp-old]');
      const saveEl = root.querySelector('[data-pdp-save]');
      const hasDiscount = vOld > vPrice;
      if (oldEl) {
        oldEl.hidden = !hasDiscount;
        oldEl.textContent = hasDiscount ? blkMoney(vOld) : '';
      }
      if (saveEl) {
        saveEl.hidden = !hasDiscount;
        saveEl.textContent = hasDiscount ? `${blkT('save')} ${blkMoney(vOld - vPrice)}` : '';
      }
      // نسبة الخصم للنسخة المختارة (بالتقريب لتحت)
      const pctEl = root.querySelector('[data-pdp-discount]');
      if (pctEl) {
        pctEl.hidden = !hasDiscount;
        pctEl.textContent = hasDiscount ? `-${Math.floor((vOld - vPrice) / vOld * 100)}%` : '';
      }
    }

    // صورة النسخة المختارة (لو ليها صورة من صور المنتج) بتظهر في المعرض
    const vImg = variant.image && (variant.image.fileUrl || (typeof variant.image === 'string' ? variant.image : ''));
    if (vImg) {
      const idx = slides.findIndex(s => { const im = s.querySelector('img'); return im && im.getAttribute('src') === vImg; });
      if (idx > -1) goTo(idx);
    }

    // التوفر من مخزون النسخة المختارة نفسها (مش المنتج الأب). لو السيرفر مابعتش كمية بنسيب الحالة زي ما هي
    if (typeof variant.quantity === 'number') stockState = blkPdpSetStock(root, variant.quantity);

    const skuEl = root.querySelector('[data-pdp-sku]');
    if (skuEl && variant.sku) {
      skuEl.textContent = variant.sku;
      skuEl.closest('[data-pdp-sku-row]')?.removeAttribute('hidden');
    }
  };

  const resolveVariant = async () => {
    if (selected.some(v => !v) || isDemo) return;
    // كل الاختيارات اتعملت ومفيش نسخة بالتركيبة دي خالص: غير متاحة
    if (canMapVariants && !matchVariantLocally()) {
      variantId = null;
      stockState = blkPdpSetStock(root, 0);
      showQmraToast(blkT('variantUnavailable'));
      return;
    }
    resolving = true;
    root.classList.add('is-loading');
    try {
      const qty = qtyInput ? blkClampQty(qtyInput) : 1;
      // ProductManager.getVariant بتاع المنصة لو موجود، ولو مارجّعش نسخة بنرجع لـ blkPost (بيتعامل مع الكوكيز والأخطاء)
      let raw = null;
      const pm = window.ProductManager;
      if (pm && typeof pm.getVariant === 'function') {
        raw = await Promise.resolve().then(() => pm.getVariant(productId, selected, qty)).catch(() => null);
        if (!(raw && (raw._id || raw.variant || raw.data)) || raw.success === false) raw = null;
      }
      if (!raw) {
        raw = await blkPost('/ajax/product/resolve-variant-by-options', {
          productId,
          options: selected,
          quantity: qty
        });
      }
      const local = matchVariantLocally();
      const fromServer = (raw && raw._id) ? raw : (raw && (raw.variant || raw.data)) || null;
      // بنكمّل اللي ناقص من رد السيرفر (السعر/الكمية) من بيانات النسخة في الصفحة
      const variant = fromServer ? Object.assign({}, local || {}, fromServer) : local;
      variantId = variant && variant._id ? variant._id : null;
      if (variantId) updateVariantUI(variant);
    } catch (err) {
      console.warn('[pdp] resolve variant failed:', err);
      const local = matchVariantLocally();
      variantId = local ? local._id : null;
      if (local) updateVariantUI(local);
      else showQmraToast(blkT('variantUnavailable'));
    } finally {
      resolving = false;
      root.classList.remove('is-loading');
    }
  };

  optionEls.forEach(optionEl => {
    const index = Number(optionEl.getAttribute('data-pdp-option'));
    const labelEl = optionEl.querySelector('[data-pdp-option-label]');
    const chips = optionEl.querySelectorAll('.blk-pdp-chip');

    // لون الدواير، ولو مالقيناش لون الشيب بيفضل نص عادي
    chips.forEach(chip => {
      if (!chip.classList.contains('blk-pdp-swatch')) return;
      const color = blkSwatchColor(chip);
      if (color) chip.style.setProperty('--sw', color);
      else chip.classList.add('is-text');
    });

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => {
          c.classList.remove('is-active');
          c.setAttribute('aria-checked', 'false');
        });
        chip.classList.add('is-active');
        chip.setAttribute('aria-checked', 'true');
        setOptionError(optionEl, false);
        if (labelEl) labelEl.textContent = chip.getAttribute('data-value-label');

        selected[index] = chip.getAttribute('data-value-id');
        selectedLabels[index] = chip.getAttribute('data-value-label') || '';
        selectedChips[index] = chip;
        variantId = null;
        refreshAvailability();
        resolveVariant();
      });
    });

    // لو الخيار ليه قيمة واحدة بس نختارها على طول
    if (chips.length === 1) chips[0].click();
  });
  refreshAvailability();

  /* ===== Add to cart / Buy now ===== */
  addBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled || resolving) return;
      const buyNow = btn.hasAttribute('data-pdp-buynow');

      // مفيش إضافة من غير كل الاختيارات: رسالة تحت كل خيار ناقص باسمه، والصفحة بتنزل لأول واحد
      const missing = optionEls.filter(el => !selected[Number(el.getAttribute('data-pdp-option'))]);
      if (missing.length) {
        missing.forEach(el => {
          setOptionError(el, false);
          void el.offsetWidth; // عشان الهزة تتعاد
          setOptionError(el, true);
        });
        const first = missing[0];
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const name = first.querySelector('.blk-pdp-option-name')?.textContent.trim() || '';
        showQmraToast(blkT('chooseOptionError', { name }), 'error');
        return;
      }
      if (stockState === 'out') {
        showQmraToast(blkT('outOfStock'), 'error');
        return;
      }

      // منتج افتراضي: بيتضاف لسلة المنتجات الافتراضية (المنصة مابتعرفوش) بالمقاس المختار وفي حدود مخزونه.
      // "اشترِ الآن" بيضيفه ويفتح السلة
      if (isDemo) {
        const variant = optionEls.map(el => {
          const i = Number(el.getAttribute('data-pdp-option'));
          const name = el.querySelector('.blk-pdp-option-name')?.textContent.trim() || '';
          return selectedLabels[i] ? `${name}: ${selectedLabels[i]}` : '';
        }).filter(Boolean).join(' · ');
        const result = blkDemoCartAdd({
          id: productId,
          title: root.getAttribute('data-product-title') || '',
          price: Number(root.getAttribute('data-product-price')) || 0,
          image: root.getAttribute('data-product-image') || '',
          url: root.getAttribute('data-product-url') || '',
          variant,
          stock: blkStockAttr(root, 'data-stock-qty')
        }, qtyInput ? blkClampQty(qtyInput) : 1);
        if (!result.added || result.partial) showLimitNote(blkAddMessage(result));
        showQmraToast(blkAddMessage(result), result.added ? 'success' : 'error');
        if (result.added && buyNow) window.location.href = '/cart';
        return;
      }

      // المنتج ليه نسخ والسيرفر محتاج واحدة: نسخة واحدة، أو مفيش اختيارات ظاهرة، أو مطابقة محلية
      let chosenVariant = variantId;
      if (!chosenVariant && variants.length === 1) chosenVariant = variants[0]._id;
      if (!chosenVariant && variants.length > 1 && optionsCount > 0) {
        const local = matchVariantLocally();
        if (local) chosenVariant = local._id;
      }
      if (!chosenVariant && variants.length > 1 && optionsCount === 0) {
        const available = variants.find(variantInStock);
        if (!available) {
          stockState = blkPdpSetStock(root, 0);
          return;
        }
        chosenVariant = available._id;
      }

      const label = btn.querySelector('[data-pdp-add-label]') || btn.querySelector('span') || btn;
      const original = label.textContent;
      addBtns.forEach(b => { b.disabled = true; });
      label.textContent = buyNow ? blkT('wait') : blkT('adding');

      // المخزون اللي بنقيس عليه: النسخة اللي هتتضاف لو معروف مخزونها، وإلا المخزون الحالي في الصفحة
      const chosen = chosenVariant && variants.find(v => String(v._id) === String(chosenVariant));
      const stock = chosen && typeof chosen.quantity === 'number' ? chosen.quantity : blkStockAttr(root, 'data-stock-qty');

      try {
        const qty = qtyInput ? blkClampQty(qtyInput) : 1;
        // مفيش إضافة أكتر من المتاح: المخزون - اللي في السلة بالفعل
        const result = await blkAddWithinStock(productId, qty, chosenVariant || undefined, stock);
        if (!result.added) {
          label.textContent = original;
          addBtns.forEach(b => { b.disabled = stockState === 'out'; });
          showLimitNote(blkAddMessage(result));
          showQmraToast(blkAddMessage(result), 'error');
          return;
        }
        blkApplyCart(result.cart); // الهيدر يتحدّث حتى لو CartManager جاي من المنصة
        if (buyNow) {
          // PRD-10: «اشترِ الآن» بيروح للشيك أوت على طول بنفس المنتج والنسخة والكمية
          blkCheckout();
          return;
        }
        label.textContent = blkT('added');
        if (result.partial) showLimitNote(blkAddMessage(result));
        blkAfterAdd(result);
      } catch (err) {
        console.warn('[pdp] add failed:', err, { productId, variantId: chosenVariant, variants: variants.length });
        label.textContent = original;
        const reason = err && err.message && !/^Request failed/.test(err.message) ? err.message : '';
        showQmraToast(reason || blkT('addFailed'), 'error');
      }
      setTimeout(() => {
        label.textContent = original;
        // نرجّع الأزرار حسب حالة المخزون الحالية مش مفتوحة على طول
        addBtns.forEach(b => { b.disabled = stockState === 'out'; });
      }, 1800);
    });
  });

  /* ===== Sticky bar: بيظهر لما زرار الشراء الأساسي يخرج من الشاشة ===== */
  const sticky = root.querySelector('[data-pdp-sticky]');
  const mainAdd = root.querySelector('.blk-pdp-add');
  if (sticky && mainAdd && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      const on = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      sticky.classList.toggle('is-visible', on);
      // زر الواتساب والعودة للأعلى والرسايل بيطلعوا فوق الشريط (pages.css: .blk-sticky-buy-on)
      if (!root.closest('.blk-demo-pdp')) document.documentElement.classList.toggle('blk-sticky-buy-on', on);
    }).observe(mainAdd);
  }

  /* ===== Delivery estimate ===== */
  const delivery = root.querySelector('[data-pdp-delivery]');
  const range = (root.getAttribute('data-delivery') || '').split('-').map(Number);
  if (delivery && range.length === 2 && range.every(Number.isFinite)) {
    const fmt = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toLocaleDateString(blkDateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
    };
    const [min, max] = range[0] <= range[1] ? range : [range[1], range[0]];
    delivery.querySelector('[data-pdp-delivery-range]').textContent = `${fmt(min)} ${blkT('deliveryAnd')} ${fmt(max)}`;
    delivery.hidden = false;
  }

  /* ===== Share ===== */
  const url = window.location.href;
  const title = root.getAttribute('data-product-title') || document.title;
  root.querySelectorAll('[data-pdp-share]').forEach(el => {
    const type = el.getAttribute('data-pdp-share');
    if (type === 'whatsapp') el.href = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
    if (type === 'facebook') el.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    if (type === 'copy') {
      el.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          showQmraToast(blkT('linkCopied'), 'success');
        } catch (err) {
          showQmraToast(blkT('copyFailed'), 'error');
        }
      });
    }
    // مشاركة الجهاز نفسه (الموبايل): بتظهر بس لو المتصفح بيدعمها
    if (type === 'native' && navigator.share) {
      el.hidden = false;
      el.addEventListener('click', () => { navigator.share({ title, url }).catch(() => {}); });
    }
  });

  /* ===== Tabs ===== */
  const tabs = Array.from(root.querySelectorAll('[data-pdp-tab]'));
  const indicator = root.querySelector('.blk-pdp-tab-indicator');
  // offsetLeft محسوب من شمال الـ tablist في RTL و LTR، والمؤشر متثبّت على left: 0
  const moveIndicator = (tab) => {
    if (!indicator || !tab) return;
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  };
  const openTab = (name) => {
    tabs.forEach(tab => {
      const on = tab.getAttribute('data-pdp-tab') === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
      if (on) moveIndicator(tab);
    });
    root.querySelectorAll('[data-pdp-panel]').forEach(panel => {
      const on = panel.getAttribute('data-pdp-panel') === name;
      panel.hidden = !on;
      panel.classList.toggle('is-active', on);
    });
  };
  tabs.forEach(tab => tab.addEventListener('click', () => openTab(tab.getAttribute('data-pdp-tab'))));
  // PRD-12: على الموبايل التابات أكورديون (كل قسم بيفتح ويقفل لوحده)
  root.querySelectorAll('[data-pdp-acc]').forEach(head => head.addEventListener('click', () => {
    const panel = root.querySelector(`[data-pdp-panel="${head.getAttribute('data-pdp-acc')}"]`);
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    panel.classList.toggle('is-active', open);
    head.setAttribute('aria-expanded', String(open));
  }));
  requestAnimationFrame(() => moveIndicator(root.querySelector('.blk-pdp-tab.is-active')));
  window.addEventListener('resize', blkDebounce(() => moveIndicator(root.querySelector('.blk-pdp-tab.is-active')), 150));

  root.querySelectorAll('[data-pdp-goto-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openTab(link.getAttribute('data-pdp-goto-tab'));
      root.querySelector('.blk-pdp-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ===== Size guide ===== */
  const guide = root.querySelector('[data-pdp-guide]');
  if (guide) {
    const closeGuide = () => {
      guide.hidden = true;
      document.documentElement.classList.remove('blk-no-scroll');
    };
    root.querySelectorAll('[data-pdp-guide-open]').forEach(btn => btn.addEventListener('click', () => {
      guide.hidden = false;
      document.documentElement.classList.add('blk-no-scroll');
      guide.querySelector('[data-pdp-guide-close]').focus();
    }));
    guide.querySelector('[data-pdp-guide-close]').addEventListener('click', closeGuide);
    guide.addEventListener('click', (e) => { if (e.target === guide) closeGuide(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !guide.hidden) closeGuide(); });
  }

  /* ===== Recently viewed (localStorage) ===== */
  if (root.hasAttribute('data-recent') && !isDemo) blkRecentlyViewed(root, productId);
}

const BLK_RECENT_KEY = 'blkRecentProducts';

function blkRecentlyViewed(root, productId) {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(BLK_RECENT_KEY) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch (err) {
    list = [];
  }

  const others = list.filter(p => p && p.id !== productId).slice(0, 6);
  const wrap = root.querySelector('[data-pdp-recent-wrap]');
  const holder = root.querySelector('[data-pdp-recent-list]');
  if (wrap && holder && others.length) {
    holder.innerHTML = others.map(p => `
      <a href="${blkEscape(p.url)}" class="blk-pdp-recent-card">
        <span class="blk-pdp-recent-img">${p.image ? `<img src="${blkEscape(p.image)}" alt="${blkEscape(p.title)}" loading="lazy">` : ''}</span>
        <span class="blk-pdp-recent-title">${blkEscape(p.title)}</span>
        <span class="blk-pdp-recent-price">${blkPrice(p.price)}${p.old > p.price ? ` <s>${blkMoney(p.old)}</s>` : ''}</span>
      </a>`).join('');
    wrap.hidden = false;
  }

  const current = {
    id: productId,
    title: root.getAttribute('data-product-title') || '',
    url: root.getAttribute('data-product-url') || window.location.pathname,
    image: root.getAttribute('data-product-image') || '',
    price: Number(root.getAttribute('data-product-price')) || 0,
    old: Number(root.getAttribute('data-product-old')) || 0
  };
  try {
    localStorage.setItem(BLK_RECENT_KEY, JSON.stringify([current, ...list.filter(p => p && p.id !== productId)].slice(0, 12)));
  } catch (err) { /* التخزين مقفول (Private mode) */ }
}



/* ==========================================================
   2. CART PAGE
   ========================================================== */

blkRegister('[data-blk-cart-page]', initCartPage);

// H1 واحد في صفحة السلة: نفس العنوان بينتقل للجزء الظاهر (السلة المليانة أو الفاضية)
function blkCartMoveTitle(root, isEmpty) {
  const title = root.querySelector('.blk-cart-title');
  const holder = root.querySelector(isEmpty ? '[data-cart-empty]' : '.blk-cart-head');
  if (!title || !holder) return;
  title.classList.toggle('blk-cart-empty-title', isEmpty);
  holder.prepend(title);
}

function initCartPage(root) {
  // الحد مكتوب بعملة المتجر (جنيه)، والسلة بوحدة أسعار المنصة (BLK_PRICE_SCALE)
  const freeShipping = (Number(root.getAttribute('data-free-shipping')) || 0) * BLK_PRICE_SCALE;

  const render = (cart) => {
    const items = cart.items || [];

    // سطور المنتجات
    root.querySelectorAll('[data-cart-item]').forEach(row => {
      const item = items.find(i => i._id === row.getAttribute('data-cart-item'));
      if (!item) {
        row.classList.add('is-removing');
        setTimeout(() => row.remove(), 300);
        return;
      }
      const total = row.querySelector('[data-cart-line-total]');
      if (total) total.textContent = blkPrice(item.totalPrice);
      const qty = row.querySelector('[data-cart-qty]');
      if (qty) qty.value = item.quantity;
    });

    // الملخص
    const set = (sel, val) => root.querySelectorAll(sel).forEach(el => { el.textContent = val; });
    const subtotal = cart.totalCompareAtPrice > cart.totalPrice ? cart.totalCompareAtPrice : cart.totalPrice;
    set('[data-cart-subtotal]', blkMoney(subtotal));
    set('[data-cart-total]', blkMoney(cart.totalPrice));
    set('[data-cart-savings]', `- ${blkMoney(cart.totalSavings || 0)}`);
    const savingsRow = root.querySelector('[data-cart-savings-row]');
    if (savingsRow) savingsRow.hidden = !(cart.totalSavings > 0);

    // الشحن المجاني
    if (freeShipping > 0) {
      const bar = root.querySelector('[data-ship-bar]');
      const text = root.querySelector('[data-ship-text]');
      const pct = Math.min(100, Math.round((cart.totalPrice / freeShipping) * 100));
      if (bar) bar.style.width = `${pct}%`;
      if (text) {
        text.innerHTML = cart.totalPrice >= freeShipping
          ? blkEscape(blkT('freeShippingReached'))
          : `${blkEscape(blkT('freeLeftPrefix'))} <strong>${blkMoney(freeShipping - cart.totalPrice)}</strong> ${blkEscape(blkT('freeLeftSuffix'))}`;
      }
    }

    // السلة فضيت (والسلة الافتراضية كمان فاضية)
    if (!items.length && !blkDemoCartRead().length) {
      const filled = root.querySelector('[data-cart-filled]');
      const empty = root.querySelector('[data-cart-empty]');
      setTimeout(() => {
        if (filled) filled.hidden = true;
        if (empty) empty.hidden = false;
        blkCartMoveTitle(root, true);
      }, 300);
    }
  };

  /* ===== حد المخزون في السلة ===== */
  // سطر نفد من المخزون بيقفل زرار إتمام الطلب لحد ما يتشال،
  // ولو السلة فيها منتجات افتراضية بس الزرار برضه مقفول (مفيش حاجة تتطلب من المنصة)
  const checkout = root.querySelector('[data-cart-checkout]');
  let checkoutBlockReason = '';
  const syncCheckout = () => {
    const unavailable = !!root.querySelector('[data-cart-item].is-unavailable:not(.is-removing)');
    const onlyDemo = !root.querySelector('[data-cart-item]:not(.is-removing)') && blkDemoCartRead().length > 0;
    checkoutBlockReason = unavailable ? blkT('removeUnavailable') : onlyDemo ? blkT('demoCheckoutBlocked') : '';
    if (!checkout) return;
    checkout.classList.toggle('is-disabled', !!checkoutBlockReason);
    checkout.setAttribute('aria-disabled', String(!!checkoutBlockReason));
  };
  if (checkout) {
    checkout.addEventListener('click', (e) => {
      if (checkout.getAttribute('aria-disabled') !== 'true') return;
      e.preventDefault();
      showQmraToast(checkoutBlockReason || blkT('removeUnavailable'), 'error');
    });
  }

  /* ===== المنتجات الافتراضية في السلة (سلة المتصفح، main.js) ===== */
  const demoWrap = root.querySelector('[data-demo-cart]');
  const demoList = root.querySelector('[data-demo-cart-list]');
  const renderDemo = () => {
    const items = blkDemoCartRead();
    const esc = blkEscape;
    if (demoWrap && demoList) {
      demoWrap.hidden = !items.length;
      const note = demoWrap.querySelector('[data-demo-cart-note]');
      if (note) note.textContent = blkT('demoCartNote');
      demoList.innerHTML = items.map(item => {
        const key = esc(`${item.id}|${item.variant || ''}`);
        const url = item.url ? esc(item.url) : '#';
        const max = typeof item.stock === 'number' ? ` max="${item.stock}"` : '';
        return `
          <li class="blk-cart-item is-demo" data-demo-item="${key}">
            <a href="${url}" class="blk-cart-thumb">${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy">` : '<div class="blk-cat-strip-placeholder"></div>'}</a>
            <div class="blk-cart-item-info">
              <a href="${url}" class="blk-cart-item-title">${esc(item.title)}</a>
              <span class="blk-cart-demo-badge">${esc(blkT('demoBadge'))}</span>
              ${item.variant ? `<span class="blk-cart-item-variant">${esc(item.variant)}</span>` : ''}
              <div class="blk-cart-item-unit"><span>${blkPrice(item.price)}</span></div>
              <div class="blk-cart-item-actions">
                <div class="blk-qty blk-qty-sm">
                  <button type="button" class="blk-qty-btn" data-demo-step="1" aria-label="${esc(blkT('qtyIncrease'))}">+</button>
                  <input type="number" class="blk-qty-input" value="${Number(item.qty)}" min="1"${max} aria-label="${esc(blkT('quantity'))}" data-demo-qty>
                  <button type="button" class="blk-qty-btn" data-demo-step="-1" aria-label="${esc(blkT('qtyDecrease'))}">−</button>
                </div>
                <button type="button" class="blk-cart-remove" data-demo-remove aria-label="${esc(blkT('remove'))}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                  <span>${esc(blkT('remove'))}</span>
                </button>
              </div>
            </div>
            <div class="blk-cart-item-total">${blkPrice(Number(item.price) * Number(item.qty))}</div>
          </li>`;
      }).join('');
    }

    // مجموعهم لوحده في الملخص (مش داخل في إجمالي الطلب)
    const totals = blkDemoCartTotals(items);
    const row = root.querySelector('[data-demo-cart-row]');
    if (row) {
      row.hidden = !items.length;
      const label = row.querySelector('[data-demo-cart-label]');
      const total = row.querySelector('[data-demo-cart-total]');
      if (label) label.textContent = blkT('demoLine');
      if (total) total.textContent = blkMoney(totals.price);
    }

    // السلة فيها منتجات (حقيقية أو افتراضية): تظهر بدل "سلتك فاضية"
    const hasReal = !!root.querySelector('[data-cart-item]:not(.is-removing)');
    const filled = root.querySelector('[data-cart-filled]');
    const empty = root.querySelector('[data-cart-empty]');
    if (filled) filled.hidden = !hasReal && !items.length;
    if (empty) empty.hidden = hasReal || items.length > 0;
    blkCartMoveTitle(root, !hasReal && !items.length);
    syncCheckout();
  };

  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-demo-item]');
    if (!row) return;
    const key = row.getAttribute('data-demo-item');
    const input = row.querySelector('[data-demo-qty]');
    const stepBtn = e.target.closest('[data-demo-step]');
    if (stepBtn) {
      const wanted = (parseInt(input.value, 10) || 1) + Number(stepBtn.getAttribute('data-demo-step'));
      const set = blkDemoCartSetQty(key, Math.max(1, wanted));
      if (wanted > set) showQmraToast(blkT('maxQty', { count: set }), 'error');
      return;
    }
    if (e.target.closest('[data-demo-remove]')) blkDemoCartSetQty(key, 0);
  });

  root.addEventListener('change', (e) => {
    const input = e.target.closest('[data-demo-qty]');
    if (!input) return;
    const row = input.closest('[data-demo-item]');
    const wanted = Math.max(1, parseInt(input.value, 10) || 1);
    const set = blkDemoCartSetQty(row.getAttribute('data-demo-item'), wanted);
    if (wanted > set) showQmraToast(blkT('maxQty', { count: set }));
  });

  // أي تغيير في السلة الافتراضية (من الصفحة دي أو تابة تانية) بيعيد رسمها
  window.addEventListener('blk:demo-cart', renderDemo);
  renderDemo();

  const showRowMsg = (row, text) => {
    const msg = row.querySelector('[data-cart-stock-msg]');
    if (!msg) return;
    msg.textContent = text || '';
    msg.hidden = !text;
  };

  const run = async (row, action) => {
    row.classList.add('is-loading');
    try {
      render(await action());
    } catch (err) {
      // السيرفر رفض (مثلاً الكمية أكبر من المتاح): بنقول السبب ونرجّع الأرقام من السلة الحقيقية
      const reason = err && err.message && !/^Request failed/.test(err.message) ? err.message : '';
      showQmraToast(reason || blkT('cartError'), 'error');
      try {
        const fresh = blkNormalizeCart(await blkFetchCart());
        if (fresh) render(blkApplyCart(fresh));
      } catch (e) { /* هنسيب الأرقام زي ما هي */ }
    } finally {
      row.classList.remove('is-loading');
      setTimeout(syncCheckout, 350); // بعد ما السطر المحذوف يختفي
    }
  };

  // debounce لكل سطر لوحده عشان تعديل سطرين ورا بعض مايضيعش تحديث واحد منهم
  const updaters = new WeakMap();
  const updateQty = (row, qty) => {
    if (!updaters.has(row)) {
      updaters.set(row, blkDebounce(q => run(row, () => window.CartManager.update(row.getAttribute('data-cart-item'), q)), 400));
    }
    updaters.get(row)(qty);
  };

  // المخزون بيبقى الحد الأقصى للكمية. لو السطر فيه أكتر من المتاح (المخزون قل بعد الإضافة) بيرجع للمتاح على طول
  const applyRowStock = (row, stock) => {
    const input = row.querySelector('[data-cart-qty]');
    if (!input) return;
    row.setAttribute('data-stock', stock);
    if (stock <= 0) {
      row.classList.add('is-unavailable');
      input.disabled = true;
      row.querySelectorAll('[data-cart-step]').forEach(btn => { btn.disabled = true; });
      showRowMsg(row, blkT('outOfStock'));
      return;
    }
    input.max = stock;
    if ((parseInt(input.value, 10) || 1) > stock) {
      input.value = stock;
      showRowMsg(row, blkT('qtyAdjusted', { count: stock }));
      run(row, () => window.CartManager.update(row.getAttribute('data-cart-item'), stock));
    }
  };

  // مخزون كل سطر من بيانات المنتج (/ajax/product). لو مانعرفش المخزون السطر بيفضل من غير حد
  (async () => {
    const rows = Array.from(root.querySelectorAll('[data-cart-item]'));
    const handles = [...new Set(rows.map(r => r.getAttribute('data-product-handle')).filter(Boolean))];
    const products = {};
    await Promise.all(handles.map(async h => { products[h] = await blkFetchProductByHandle(h); }));
    rows.forEach(row => {
      const p = products[row.getAttribute('data-product-handle')];
      if (!p || !row.isConnected) return;
      const vid = row.getAttribute('data-variant-id');
      const variant = vid && Array.isArray(p.variants) ? p.variants.find(v => v && String(v._id) === vid) : null;
      const stock = variant && typeof variant.quantity === 'number' ? variant.quantity : blkProductQty(p);
      if (typeof stock === 'number' && Number.isFinite(stock)) applyRowStock(row, stock);
    });
    syncCheckout();
  })();

  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-cart-item]');
    if (!row) return;

    const stepBtn = e.target.closest('[data-cart-step]');
    if (stepBtn) {
      const input = row.querySelector('[data-cart-qty]');
      if (input.disabled) return;
      const before = parseInt(input.value, 10) || 1;
      const wanted = before + Number(stepBtn.getAttribute('data-cart-step'));
      input.value = wanted;
      const val = blkClampQty(input);
      // وصل للمتاح: مفيش زيادة، بنقوله المتاح كام
      if (wanted > val) showQmraToast(blkT('maxQty', { count: val }));
      if (val !== before) {
        showRowMsg(row, '');
        updateQty(row, val);
      }
      return;
    }

    if (e.target.closest('[data-cart-remove]')) {
      run(row, () => window.CartManager.remove(row.getAttribute('data-cart-item')));
    }
  });

  root.addEventListener('change', (e) => {
    const input = e.target.closest('[data-cart-qty]');
    if (!input) return;
    const row = input.closest('[data-cart-item]');
    const wanted = parseInt(input.value, 10);
    const val = blkClampQty(input);
    if (Number.isFinite(wanted) && wanted > val) showQmraToast(blkT('maxQty', { count: val }));
    updateQty(row, val);
  });
}



/* ==========================================================
   3. SEARCH PAGE (/ajax/search/products)
   ========================================================== */

blkRegister('[data-blk-search-page]', initSearchPage);

// المنتجات اللي اترسمت في الصفحة، عشان صفحة المنتج اللي فوق الصفحة تفتح من غير طلب جديد
const BLK_PRODUCT_CACHE = {};

// slug المنتج من أي مكان ممكن يكون فيه في رد الـ API
function blkProductSlug(p) {
  if (!p) return '';
  const fromUrl = typeof p.url === 'string' ? (p.url.match(/\/products?\/([^/?#]+)/) || [])[1] : '';
  return p.slug || p.handle || (p.seo && (p.seo.slug || p.seo.handle)) || p.urlHandle || fromUrl || '';
}

// صفحة المنتج بتاعة المنصة (/products/<slug>) لو معانا slug: عنوان ووصف وصورة مشاركة لكل منتج (PRD-21 / QLT-12).
// من غير slug بنفتح المنتج فوق صفحة الشوب (/shop?product-id=)، وهي موجودة دايماً
const BLK_SHOP_URL = '/shop';

function blkProductUrl(p) {
  const slug = blkProductSlug(p);
  return slug ? `/products/${encodeURIComponent(slug)}` : `${BLK_SHOP_URL}?product-id=${encodeURIComponent(p._id)}`;
}

function blkRenderProductCard(p, opts = {}) {
  if (typeof opts !== 'object' || opts === null) opts = {}; // لما تتنادى من .map بيوصل index
  // المنتج التجريبي بيتفتح كصفحة فوق الصفحة الحالية (المنصة بترجّع 404 لمنتج مش موجود)
  const url = opts.demo ? `${BLK_SHOP_URL}?product=${encodeURIComponent(p.slug)}` : blkProductUrl(p);
  if (!opts.demo && p && p._id) BLK_PRODUCT_CACHE[p._id] = p;
  const price = p.pricing ? Number(p.pricing.price) || 0 : 0;
  const oldPrice = p.pricing ? Number(p.pricing.compareAtPrice) || 0 : 0;
  const images = p.images || [];
  const img1 = images[0] && images[0].fileUrl;
  const img2 = !opts.hideSecondImage && images[1] && images[1].fileUrl;
  // نفس قاعدة ui/blk-product-card.njk: 0 = نفد · 1-3 = أوشك على النفاد، ولو كل النسخ خلصت يبقى نفد
  // مخزون مش معروف (كمية 0 من غير variants): نفس قاعدة الكارت في القالب، و blkCheckProduct بيتأكد بعدين
  const stockUnknown = !opts.demo && blkStockUnknown(p);
  const stockQty = stockUnknown ? null : blkProductQty(p);
  const stock = blkStockState(stockQty);
  const outOfStock = stock === 'out';
  const lowStock = stock === 'low';
  const reviews = Number(p.reviewsCount) || 0;
  const rating = Math.min(5, Math.max(0, Math.round(Number(p.averageRating) || 0)));
  const isHot = Array.isArray(p.tags) && p.tags.some(t => blkTagName(t) === 'hot');
  const needsOptions = (Array.isArray(p.variants) && p.variants.length > 1) || Number(p.variantsCount) > 1 || stockUnknown;
  const title = blkEscape(p.title);
  // القسم المتعطّل مايظهرش على الكارت
  const category = p.category && p.category.title && blkIsCollectionVisible(p.category) ? blkEscape(p.category.title) : '';
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const addLabel = blkEscape(outOfStock ? blkT('outOfStock') : stockUnknown ? blkT('viewProduct') : needsOptions ? blkT('chooseOptions') : blkT('addToCart'));
  const showButtons = BLK_CFG.cardButtons !== false;
  const tags = (Array.isArray(p.tags) ? p.tags : []).map(blkTagName).filter(Boolean).join('|');
  const wish = BLK_CFG.wishlist !== false && p._id
    ? `<button type="button" class="blk-wish-toggle" data-wish-toggle="${blkEscape(p._id)}" aria-pressed="false" aria-label="${blkEscape(blkT('wishlistAdd'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg></button>`
    : '';

  return `
    <div class="blk-prod-card${outOfStock ? ' is-out' : ''}${showButtons ? '' : ' no-buttons'}" data-id="${blkEscape(p._id)}" data-price="${price}" ${opts.demo ? 'data-dummy' : `data-url="${url}"`} data-category="${category}" data-created="${blkEscape(p.createdAt || '')}" data-out="${outOfStock ? 1 : 0}" data-tags="${blkEscape(tags)}"${stockUnknown && blkProductSlug(p) ? ` data-needs-check="${blkEscape(blkProductSlug(p))}"` : ''}>
      <div class="blk-prod-media">
        <div class="blk-prod-badges">
          ${opts.badge ? `<span class="blk-badge-glass blk-badge-new">${blkEscape(opts.badge)}</span>` : ''}
          ${oldPrice > price ? `<span class="blk-badge-glass blk-badge-discount">-${Math.floor((oldPrice - price) / oldPrice * 100)}%</span>` : ''}
          ${outOfStock ? `<span class="blk-badge-glass blk-badge-out">${blkEscape(blkT('outOfStock'))}</span>` : (isHot ? `<span class="blk-badge-glass blk-badge-hot">${blkEscape(blkT('hot'))}</span>` : '')}
        </div>
        ${wish}
        <a href="${url}" class="blk-prod-img-link" tabindex="-1" aria-hidden="true">
          <img src="${blkEscape(img1 || BLK_NO_IMAGE)}" alt="${title}" class="blk-prod-img blk-img-primary" loading="lazy" decoding="async" width="600" height="690" />
          ${img2 ? `<img src="${blkEscape(img2)}" alt="${title} - ${blkEscape(blkT('preview'))}" class="blk-prod-img blk-img-secondary" loading="lazy" decoding="async" width="600" height="690" />` : ''}
        </a>
        ${showButtons ? `<div class="blk-prod-actions">
          ${opts.hideQuickView ? '' : `<button type="button" class="blk-action-btn blk-btn-quickview" title="${blkEscape(blkT('quickView'))}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>${blkEscape(blkT('preview'))}</span>
          </button>`}
          <button type="button" class="blk-action-btn blk-btn-addcart" data-product-id="${blkEscape(p._id)}" data-stock="${typeof stockQty === 'number' ? stockQty : ''}" aria-label="${addLabel}" ${needsOptions ? 'data-needs-options' : ''} ${Array.isArray(p.variants) && p.variants.length === 1 && p.variants[0] && p.variants[0]._id ? `data-variant-id="${blkEscape(p.variants[0]._id)}"` : ''} ${outOfStock ? 'disabled aria-disabled="true"' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            <span>${addLabel}</span>
          </button>
        </div>` : ''}
      </div>
      <div class="blk-prod-details">
        <div class="blk-prod-meta">
          <span class="blk-prod-cat">${category}</span>
          ${!opts.hideRating && reviews > 0 ? `<div class="blk-prod-rating" title="${blkEscape(p.averageRating)} ${blkEscape(blkT('outOf5'))}"><span class="blk-stars">${stars}</span><span class="blk-rating-count">(${reviews})</span></div>` : ''}
        </div>
        <h3 class="blk-prod-title"><a href="${url}">${title}</a></h3>
        ${!opts.hideStock && lowStock ? `<div class="blk-stock-urgency"><div class="blk-stock-bar"><div class="blk-stock-progress" style="width: ${Math.round(stockQty / BLK_LOW_STOCK * 34)}%;"></div></div><span class="blk-stock-text"><strong>${blkEscape(blkStockText('low', stockQty))}</strong></span></div>` : ''}
        <div class="blk-prod-footer">
          <div class="blk-prod-price">
            <span class="blk-price-current">${blkPrice(price)}</span>
            ${oldPrice > price ? `<span class="blk-price-old">${blkMoney(oldPrice)}</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

/* ==========================================================
   كارت مخزونه مش معروف (data-needs-check)
   الكارت بيبدأ بـ «عرض المنتج» (لينك لصفحته). لما يقرب من الشاشة بنسأل /ajax/product مرة واحدة لكل منتج:
   كل مقاساته خلصت = «نفد»، ليه خيارات = «اختر الخيارات»، غير كده «أضف إلى السلة».
   طلبين بالكتير في نفس الوقت (المنصة بترجّع 429 مع الطلبات الكتير). لو الطلب فشل الكارت بيفضل «عرض المنتج»
   ========================================================== */
const blkCheckCache = {};
const blkCheckQueue = [];
let blkCheckRunning = 0;

function blkCheckNext() {
  while (blkCheckRunning < 2 && blkCheckQueue.length) {
    const job = blkCheckQueue.shift();
    blkCheckRunning += 1;
    blkFetchProductByHandle(job.handle).catch(() => null).then(p => {
      job.resolve(p);
      blkCheckRunning -= 1;
      blkCheckNext();
    });
  }
}

function blkCheckProduct(handle) {
  if (!blkCheckCache[handle]) {
    blkCheckCache[handle] = new Promise(resolve => {
      blkCheckQueue.push({ handle, resolve });
      blkCheckNext();
    });
  }
  return blkCheckCache[handle];
}

function blkApplyCardCheck(card, p) {
  if (!p || !card.isConnected) return;
  card.removeAttribute('data-needs-check');
  const btn = card.querySelector('.blk-btn-addcart');
  const label = btn && btn.querySelector('span');
  const qty = blkProductQty(p);
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const setLabel = text => {
    if (label) label.textContent = text;
    if (btn) btn.setAttribute('aria-label', text);
  };
  if (blkStockState(qty) === 'out') {
    card.classList.add('is-out');
    card.setAttribute('data-out', '1');
    const badges = card.querySelector('.blk-prod-badges');
    if (badges && !badges.querySelector('.blk-badge-out')) {
      badges.insertAdjacentHTML('beforeend', `<span class="blk-badge-glass blk-badge-out">${blkEscape(blkT('outOfStock'))}</span>`);
    }
    if (btn) {
      btn.removeAttribute('data-needs-options');
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    }
    setLabel(blkT('outOfStock'));
    return;
  }
  if (!btn) return;
  const needsOptions = variants.length > 1;
  btn.toggleAttribute('data-needs-options', needsOptions);
  btn.setAttribute('data-stock', typeof qty === 'number' ? qty : '');
  if (variants.length === 1 && variants[0] && variants[0]._id) btn.setAttribute('data-variant-id', variants[0]._id);
  setLabel(needsOptions ? blkT('chooseOptions') : blkT('addToCart'));
}

blkRegister('.blk-prod-card[data-needs-check]', (card) => {
  const handle = card.getAttribute('data-needs-check');
  if (!handle) return;
  const run = () => blkCheckProduct(handle).then(p => blkApplyCardCheck(card, p));
  if (!('IntersectionObserver' in window)) { run(); return; }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    run();
  }, { rootMargin: '200px' });
  io.observe(card);
});

/* ==========================================================
   البحث الذكي (SRCH-01..07)
   بحث المنصة حرفي: "ساعه" مابتلاقيش "ساعة"، و"اسود" مابتلاقيش "أسود"، والغلطة الإملائية بتفشّله.
   فبنبحث في كتالوج المتجر كله في المتصفح (بيتجاب مرة ويتخزن للجلسة 10 دقايق) + المنتجات الافتراضية:
   - توحيد الحروف: أ/إ/آ ← ا، ة ← ه، ى/ئ ← ي، ؤ ← و، من غير تشكيل ولا تطويل، والأرقام العربي ← إنجليزي
   - أي ترتيب للكلمات، بداية الكلمة، جزء من الكلمة، ومع/من غير "ال"
   - تصحيح غلطة أو اتنين في الكلمة (حسب طولها)
   - الترتيب حسب الأهمية: الاسم كله ← الكلمات الكاملة ← البدايات ← التصحيح
   كل النتايج بتترسم بـ blkEscape (حماية من XSS)
   ========================================================== */
const BLK_AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function blkSearchNorm(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => String(BLK_AR_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// مسافة التعديل (حذف/إضافة/تبديل/قلب حرفين) مع توقف بدري لو عدّت الحد
function blkEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
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

const BlkSmartSearch = (() => {
  const CACHE_KEY = 'blk-catalog-v1';
  const CACHE_MS = 10 * 60 * 1000;
  const PAGE = 100;
  const MAX_PAGES = 5;
  const bare = w => (w.length > 3 && w.indexOf('ال') === 0 ? w.slice(2) : w);
  let catalogP = null;
  let index = null;

  // كتالوج المتجر (q فاضي = كل المنتجات) — مرة واحدة في الجلسة
  function storeCatalog() {
    if (catalogP) return catalogP;
    catalogP = (async () => {
      try {
        const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (c && Array.isArray(c.items) && Date.now() - c.t < CACHE_MS) return c.items;
      } catch (e) { /* مفيش تخزين */ }
      let items = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await blkSearchProductsRequest(new URLSearchParams({ q: '', limit: PAGE, page }));
        if (!res.ok || !res.data) break;
        const data = res.data;
        const list = blkPickProducts(data).filter(p => p && p._id && p.title);
        items = items.concat(list);
        const pg = data && data.pagination;
        if (!pg || !pg.hasNextPage || list.length < PAGE) break;
      }
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items })); } catch (e) { /* مساحة التخزين مليانة */ }
      return items;
    })().catch(() => { catalogP = null; return []; });
    return catalogP;
  }

  function buildIndex(store) {
    // المنتجات الافتراضية بتتلاقي بالاسم العربي والإنجليزي واسم القسم
    // المنتجات التجريبية بتدخل في البحث في المعاينة بس (أو لو التاجر فعّل «منتجات تجريبية»)
    const demo = (blkDemoAllowed() ? BLK_DEMO_CATALOG : []).map(p => {
      const raw = (BLK_DEMO_CATALOG_NAMES[p._id] || []).concat(BLK_DEMO_CATEGORY_NAMES[p.category.slug] || []);
      return { p, demo: true, extra: raw.join(' ') };
    });
    const all = store.map(p => ({ p, demo: false, extra: [p.category && p.category.title, (Array.isArray(p.tags) ? p.tags : []).map(blkTagName).join(' '), String(p.slug || '').replace(/-/g, ' ')].join(' ') })).concat(demo);
    return all.map((it, i) => {
      const words = Array.from(new Set(blkSearchNorm(`${it.p.title} ${it.extra}`).split(' ').filter(Boolean)));
      return Object.assign(it, { i, title: blkSearchNorm(it.p.title), words });
    });
  }

  // أحسن تطابق لكلمة: 10 كاملة · 8 بداية · 6 جزء من الكلمة · 1-3 بتصحيح
  function matchWord(q, item) {
    const qb = bare(q);
    const allow = qb.length >= 7 ? 2 : qb.length >= 4 ? 1 : 0;
    let best = 0;
    for (const w of item.words) {
      const wb = bare(w);
      let s = 0;
      if (w === q || wb === qb) s = 10;
      else if (w.indexOf(q) === 0 || wb.indexOf(qb) === 0) s = 8;
      else if (q.length >= 2 && w.indexOf(q) > -1) s = 6;
      else if (allow) {
        const d = Math.min(blkEditDistance(qb, wb, allow), wb.length > qb.length ? blkEditDistance(qb, wb.slice(0, qb.length), allow) : allow + 1);
        if (d <= allow) s = 4 - d;
      }
      if (s > best) best = s;
      if (best === 10) break;
    }
    return best;
  }

  async function search(raw) {
    const q = blkSearchNorm(raw);
    if (!q) return [];
    if (!index) index = buildIndex(await storeCatalog());
    const tokens = q.split(' ');
    const need = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.66);
    const out = [];
    index.forEach(it => {
      let total = 0;
      let matched = 0;
      let exact = true;
      tokens.forEach(t => {
        const s = matchWord(t, it);
        if (s > 0) { matched++; total += s; if (s <= 3) exact = false; }
      });
      if (matched < need) return;
      if (it.title.indexOf(q) > -1) total += 15;
      if (it.title.indexOf(q) === 0) total += 5;
      if (matched === tokens.length) total += 6;
      out.push({ it, total, exact });
    });
    out.sort((a, b) => b.total - a.total || a.it.i - b.it.i);
    // فيه نتايج مظبوطة؟ بنشيل اللي اتلاقت بالتصحيح بس (عشان "سماعات" ماتجيبش "ساعات")
    const list = out.some(o => o.exact) ? out.filter(o => o.exact) : out;
    return list.map(o => ({ product: o.it.p, demo: o.it.demo }));
  }

  return { search, norm: blkSearchNorm, warm: () => { storeCatalog(); } };
})();

// الأسماء بالعربي والإنجليزي للمنتجات الافتراضية (البحث بيلاقيها باللغتين)
const BLK_DEMO_CATALOG_NAMES = {};

/* اقتراحات فورية في نافذة البحث (الهيدر): أول 5 نتايج + "كل النتايج" */
function initSearchSuggest() {
  const input = document.querySelector('[data-blk="search-input"]');
  const box = document.querySelector('[data-blk-search-suggest]');
  if (!input || !box || input.dataset.blkSuggest) return;
  input.dataset.blkSuggest = '1';
  let reqId = 0;
  const hide = () => { box.hidden = true; box.innerHTML = ''; };
  const run = blkDebounce(async () => {
    const q = input.value.trim();
    if (blkSearchNorm(q).length < 2) return hide();
    const id = ++reqId;
    const found = await BlkSmartSearch.search(q);
    if (id !== reqId) return;
    if (!found.length) {
      box.innerHTML = `<p class="blk-suggest-empty">${blkEscape(blkT('noResults'))}</p>`;
      box.hidden = false;
      return;
    }
    box.innerHTML = found.slice(0, 5).map(({ product: p, demo }) => {
      const url = demo ? `${BLK_SHOP_URL}?product=${encodeURIComponent(p.slug)}` : blkProductUrl(p);
      const img = p.images && p.images[0] && p.images[0].fileUrl;
      const price = p.pricing ? Number(p.pricing.price) || 0 : 0;
      return `<a class="blk-suggest-item" href="${blkEscape(url)}">
          <img src="${blkEscape(img || BLK_NO_IMAGE)}" alt="" loading="lazy" width="48" height="48">
          <span class="blk-suggest-title">${blkEscape(p.title)}</span>
          <span class="blk-suggest-price">${blkEscape(blkPrice(price))}</span>
        </a>`;
    }).join('') + `<a class="blk-suggest-all" href="/search?q=${encodeURIComponent(q)}">${blkEscape(blkT('allResults'))} (${found.length})</a>`;
    box.hidden = false;
  }, 220);
  input.addEventListener('focus', () => BlkSmartSearch.warm());
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  // SRCH-05: الأسهم بتتنقل بين الاقتراحات و Enter بيفتح المختار
  const moveFocus = (dir) => {
    const links = Array.from(box.querySelectorAll('a'));
    if (!links.length || box.hidden) return;
    const i = links.indexOf(document.activeElement);
    const next = i === -1 ? (dir > 0 ? 0 : links.length - 1) : i + dir;
    if (next < 0) { input.focus(); return; }
    links[Math.min(next, links.length - 1)].focus();
  };
  [input, box].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  }));
}
document.addEventListener('DOMContentLoaded', initSearchSuggest);
if (document.readyState !== 'loading') initSearchSuggest();

function initSearchPage(root) {
  const form = root.querySelector('[data-search-form]');
  const input = root.querySelector('[data-search-input]');
  const sortEl = root.querySelector('[data-search-sort]');
  const minEl = root.querySelector('[data-search-min]');
  const maxEl = root.querySelector('[data-search-max]');
  const results = root.querySelector('[data-search-results]');
  const summary = root.querySelector('[data-search-summary]');
  const loading = root.querySelector('[data-search-loading]');
  const empty = root.querySelector('[data-search-empty]');
  const clearBtns = Array.from(root.querySelectorAll('[data-search-clear]'));
  const popularWrap = root.querySelector('[data-search-popular]');
  if (popularWrap) popularWrap.addEventListener('blk:products-loaded', () => { popularWrap.hidden = empty.hidden; });

  // حالة الفلاتر كلها في اللينك (q, sort, min, max) عشان تتنسخ وترجع زي ما هي بعد التحديث
  const params = new URLSearchParams(window.location.search);
  input.value = params.get('q') || '';
  if (params.get('sort')) sortEl.value = params.get('sort');
  if (params.get('min')) minEl.value = params.get('min');
  if (params.get('max')) maxEl.value = params.get('max');

  const filtersActive = () => !!(sortEl.value || minEl.value !== '' || maxEl.value !== '');
  const syncClear = () => clearBtns.forEach(btn => { btn.hidden = !filtersActive(); });

  // أرقام موجبة بس، ولو الأدنى أكبر من الأقصى بنبدّلهم ونقول للعميل
  const readPrices = () => {
    const read = el => {
      if (el.value === '') return null;
      const n = Number(el.value);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    };
    let min = read(minEl);
    let max = read(maxEl);
    if (min !== null && max !== null && min > max) {
      [min, max] = [max, min];
      showQmraToast(blkT('priceSwapped'));
    }
    minEl.value = min === null ? '' : min;
    maxEl.value = max === null ? '' : max;
    return { min, max };
  };

  // كل تغيير من العميل بيتسجل في التاريخ (زرار الرجوع بيرجّع الحالة اللي قبلها — FLT-07)
  const writeUrl = (q, push) => {
    const url = new URL(window.location);
    const setOrDelete = (key, val) => { if (val !== '' && val != null) url.searchParams.set(key, val); else url.searchParams.delete(key); };
    setOrDelete('q', q);
    setOrDelete('sort', sortEl.value);
    setOrDelete('min', minEl.value);
    setOrDelete('max', maxEl.value);
    if (url.href === window.location.href) return;
    if (push) window.history.pushState({ blkSearch: 1 }, '', url);
    else window.history.replaceState({ blkSearch: 1 }, '', url);
  };

  let requestId = 0;

  const search = async (push = true) => {
    const q = input.value.trim();
    const { min, max } = readPrices();
    syncClear();
    writeUrl(q, push);
    if (!q) {
      requestId++;
      results.innerHTML = '';
      empty.hidden = true;
      const popular = root.querySelector('[data-search-popular]');
      if (popular) popular.hidden = true;
      loading.hidden = true;
      summary.textContent = blkT('searchPrompt');
      return;
    }

    const query = new URLSearchParams({ q });
    if (sortEl.value) query.set('sort', sortEl.value);
    // فلتر السعر بنفس وحدة أسعار المنصة (BLK_PRICE_SCALE في main.js)
    if (min !== null) query.set('minPrice', Math.round(min * BLK_PRICE_SCALE));
    if (max !== null) query.set('maxPrice', Math.round(max * BLK_PRICE_SCALE));

    const id = ++requestId;
    loading.hidden = false;
    results.classList.add('is-loading');

    try {
      // البحث الذكي في الكتالوج + نتايج بحث المنصة (لو الكتالوج ناقص في متجر كبير) من غير تكرار
      const [smart, data] = await Promise.all([
        BlkSmartSearch.search(q),
        blkSearchProductsRequest(new URLSearchParams(query))
          .then(res => (res.ok ? res.data : null)).catch(() => null)
      ]);
      if (id !== requestId) return; // فيه بحث أحدث

      // لو الـ API مابيفلترش بالسعر، بنفلتر هنا عشان النتيجة تطابق الفلتر دايماً
      const priceOf = p => (p && p.pricing ? Number(p.pricing.price) || 0 : 0) / BLK_PRICE_SCALE;
      const seen = new Set(smart.map(r => r.product._id));
      const merged = smart.concat(blkPickProducts(data).filter(p => p && p._id && !seen.has(p._id)).map(p => ({ product: p, demo: false })));
      const inRange = merged.filter(({ product: p }) => (min === null || priceOf(p) >= min) && (max === null || priceOf(p) <= max));
      // الترتيب في المتصفح عشان يشمل المنتجات الافتراضية ونتايج البحث الذكي
      const sorters = {
        'price-asc': (a, b) => priceOf(a.product) - priceOf(b.product),
        'price-desc': (a, b) => priceOf(b.product) - priceOf(a.product),
        'created-desc': (a, b) => String(b.product.createdAt || '').localeCompare(String(a.product.createdAt || '')),
        'rating-desc': (a, b) => (Number(b.product.averageRating) || 0) - (Number(a.product.averageRating) || 0)
      };
      const sorted = sorters[sortEl.value] ? inRange.slice().sort(sorters[sortEl.value]) : inRange;
      const products = sorted.map(r => r.product);
      results.innerHTML = sorted.map(r => blkRenderProductCard(r.product, r.demo ? { demo: true } : {})).join('');
      empty.hidden = products.length > 0;
      // SRCH-03: مفيش نتايج — منتجات رائجة من المتجر تحت الرسالة
      const popular = root.querySelector('[data-search-popular]');
      if (popular) popular.hidden = products.length > 0 || !popular.querySelector('.blk-prod-card');
      summary.innerHTML = `<strong>${products.length}</strong> ${blkEscape(blkT('resultsFor'))} "${blkEscape(q)}"`;
      blkInitAll();
    } catch (err) {
      if (id !== requestId) return;
      console.warn('[search] failed:', err);
      showQmraToast(blkT('searchError'));
    } finally {
      if (id === requestId) {
        loading.hidden = true;
        results.classList.remove('is-loading');
      }
    }
  };

  // مسح الفلاتر: الترتيب والسعر يرجعوا للافتراضي، ويتشالوا من اللينك، والنتايج ترجع كاملة (كلمة البحث بتفضل)
  clearBtns.forEach(btn => btn.addEventListener('click', () => {
    sortEl.value = '';
    minEl.value = '';
    maxEl.value = '';
    search();
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    search();
  });
  // الكتابة بتحدّث اللينك من غير ما تملا التاريخ بكل حرف
  input.addEventListener('input', blkDebounce(() => {
    if (input.value.trim().length >= 2 || !input.value.trim()) search(false);
  }, 450));
  sortEl.addEventListener('change', () => search());
  [minEl, maxEl].forEach(el => el.addEventListener('change', () => search()));

  // الرجوع/التقدم في المتصفح: الحقول بترجع من اللينك والنتايج بتتحدث من غير تسجيل جديد
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(window.location.search);
    input.value = p.get('q') || '';
    sortEl.value = p.get('sort') || '';
    minEl.value = p.get('min') || '';
    maxEl.value = p.get('max') || '';
    search(false);
  });

  search(false);
}



/* ==========================================================
   DEMO CATALOG (للمعاينة لما المتجر مايرجّعش منتجات للقسم)
   نفس شكل منتجات الـ API عشان blkRenderProductCard يرسمها عادي.
   الأسعار بالجنيه. الـ slugs لازم تفضل زي demoCats في widgets/categories-strip و collections-list
   ========================================================== */

const BLK_PX = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=600`;

// أسماء الأقسام الافتراضية [عربي، إنجليزي، فرنساوي]، والمعروض بلغة الصفحة
const BLK_DEMO_CATEGORY_NAMES = {
  men: ['رجالي', 'Men', 'Homme'],
  tshirts: ['تيشيرتات', 'T-shirts', 'T-shirts'],
  shoes: ['أحذية', 'Shoes', 'Chaussures'],
  hoodies: ['هوديز', 'Hoodies', 'Sweats à capuche'],
  pants: ['بناطيل', 'Pants', 'Pantalons'],
  accessories: ['إكسسوارات', 'Accessories', 'Accessoires']
};
// الوصف والتقييمات التجريبية عربي/إنجليزي بس (الفرنساوي بياخد الإنجليزي)
const BLK_DEMO_LANG_INDEX = blkLang() === 'ar' ? 0 : 1;
// الأسماء: الفرنساوي لو الصفحة فرنساوي، وإلا عربي/إنجليزي زي الأول
const blkDemoName = names => (blkLang() === 'fr' && names[2]) || names[BLK_DEMO_LANG_INDEX];
const BLK_DEMO_CATEGORIES = Object.fromEntries(Object.entries(BLK_DEMO_CATEGORY_NAMES).map(([slug, names]) => [slug, blkDemoName(names)]));

// أقسام إضافية: المنتج ممكن يبقى في أكتر من قسم (تيشيرت في "تيشيرتات" و"رجالي" مع بعض)
const BLK_DEMO_EXTRA_CATEGORIES = {
  men: ['t1', 't2', 't3', 't4', 'h1', 'h2', 'h3', 'p1', 'p2', 'p3']
};

// [id, [الاسم بالعربي، بالإنجليزي، بالفرنساوي], category, price, oldPrice, quantity, images[], hot, rating, reviews]
// الأسعار هنا بالجنيه وبتتحول لوحدة أسعار المتجر بـ blkFromMajor (main.js)
const BLK_DEMO_CATALOG = [
  ['t1', ['تيشيرت ضغط برو فيت', 'Pro Fit Compression Tee', 'T-shirt de compression Pro Fit'], 'tshirts', 450, 600, 3, [30451501, 4325446], true, 5, 24],
  ['t2', ['تيشيرت أوفرسايز بلاك', 'Black Oversized Tee', 'T-shirt oversize noir'], 'tshirts', 390, 0, 15, [4325446], false, 4, 9],
  ['t3', ['تيشيرت تمرين سبارتن', 'Spartan Training Tee', "T-shirt d'entraînement Spartan"], 'tshirts', 340, 0, 12, [802926], false, 0, 0],
  ['t4', ['تانك توب مسل فيت', 'Muscle Fit Tank Top', 'Débardeur Muscle Fit'], 'tshirts', 290, 350, 4, [1480530], false, 5, 6],
  ['s1', ['حذاء تمرين هافي دويتي', 'Heavy Duty Training Shoe', "Chaussure d'entraînement Heavy Duty"], 'shoes', 1290, 1550, 12, [9501459, 2385477], true, 4, 11],
  ['s2', ['كوتشي جري إير لايت', 'Air Light Running Sneaker', 'Basket de running Air Light'], 'shoes', 990, 0, 9, [2529148], false, 5, 18],
  ['s3', ['كوتشي هاي توب آيس بلو', 'Ice Blue High-Top Sneaker', 'Basket montante Ice Blue'], 'shoes', 1450, 0, 6, [16918373], false, 0, 0],
  ['s4', ['كوتشي ليذر أسود كلاسيك', 'Classic Black Leather Sneaker', 'Basket classique en cuir noir'], 'shoes', 980, 1150, 3, [1383448], false, 4, 3],
  ['s5', ['كوتشي كورت أبيض في أحمر', 'White & Red Court Sneaker', 'Basket de court blanc et rouge'], 'shoes', 1150, 1300, 20, [2385477], false, 0, 0],
  ['h1', ['هودي أوفرسايز بلود', 'Blood Oversized Hoodie', 'Sweat à capuche oversize Blood'], 'hoodies', 690, 850, 5, [17883716, 5899204], true, 5, 14],
  ['h2', ['هودي ستريت وايت', 'Street White Hoodie', 'Sweat à capuche Street White'], 'hoodies', 720, 850, 9, [16168515], false, 4, 5],
  ['h3', ['هودي نايت شادو', 'Night Shadow Hoodie', 'Sweat à capuche Night Shadow'], 'hoodies', 650, 0, 14, [5899204], false, 0, 0],
  ['p1', ['بنطلون جوجر فليكس', 'Flex Jogger Pants', 'Pantalon de jogging Flex'], 'pants', 550, 0, 8, [11327771, 5602654], false, 5, 8],
  ['p2', ['بنطلون سليم أسود', 'Black Slim Pants', 'Pantalon slim noir'], 'pants', 520, 620, 11, [5602654], false, 0, 0],
  ['p3', ['بنطلون تراك سبرينت', 'Sprint Track Pants', 'Pantalon de survêtement Sprint'], 'pants', 640, 780, 7, [11327771], false, 4, 4],
  ['a1', ['شنطة ظهر ضد الماية', 'Waterproof Backpack', 'Sac à dos imperméable'], 'accessories', 380, 480, 2, [12738154], false, 5, 7],
  ['a2', ['جوانتي ملاكمة برو', 'Pro Boxing Gloves', 'Gants de boxe Pro'], 'accessories', 220, 0, 20, [4790424], false, 4, 12],
  ['a3', ['جوانتي رفع أثقال', 'Weightlifting Gloves', 'Gants de musculation'], 'accessories', 180, 0, 25, [669578], false, 0, 0]
].map(([id, titles, cat, price, old, quantity, imgs, hot, rating, reviews], i) => {
  const demoCat = slug => ({ _id: `demo-cat-${slug}`, slug, title: BLK_DEMO_CATEGORIES[slug] });
  BLK_DEMO_CATALOG_NAMES[`demo-${id}`] = titles; // للبحث بكل اللغات
  const extra = Object.keys(BLK_DEMO_EXTRA_CATEGORIES).filter(slug => BLK_DEMO_EXTRA_CATEGORIES[slug].includes(id));
  return {
    _id: `demo-${id}`,
    title: blkDemoName(titles),
    slug: `demo-${id}`,
    pricing: { price: blkFromMajor(price), compareAtPrice: blkFromMajor(old) },
    quantity,
    tags: hot ? ['hot'] : [],
    averageRating: rating,
    reviewsCount: reviews,
    createdAt: new Date(Date.UTC(2026, 8, 30 - i)).toISOString(),
    category: demoCat(cat),
    // كل أقسام المنتج (نفس شكل collections في رد المنصة)
    collections: [cat, ...extra].map(demoCat),
    images: imgs.map(n => ({ fileUrl: BLK_PX(n) }))
  };
});

// صفحة القسم الافتراضي (نفس الشكل في القوالب والهيدر). مش /collections/<slug> لأن المنصة بترجّع 500 لقسم مش موجود في المتجر
function blkDemoCategoryUrl(slug) {
  return `/shop?category=${encodeURIComponent(slug)}&demo=1`;
}

// slug القسم التجريبي من الـ slug أو الاسم (عربي أو إنجليزي)، و'' لو مش قسم تجريبي
function blkDemoCategoryKey(slug) {
  const raw = String(slug || '').trim();
  if (BLK_DEMO_CATEGORY_NAMES[raw.toLowerCase()]) return raw.toLowerCase();
  return Object.keys(BLK_DEMO_CATEGORY_NAMES).find(k => BLK_DEMO_CATEGORY_NAMES[k].includes(raw)) || '';
}

// منتج تجريبي كامل لصفحة المنتج: مقاسات حسب القسم ووصف بلغة الصفحة
function blkDemoProductBySlug(slug) {
  const base = BLK_DEMO_CATALOG.find(p => p.slug === slug);
  if (!base) return null;
  const cat = base.category.slug;
  const sizes = cat === 'shoes' ? ['40', '41', '42', '43', '44'] : cat === 'accessories' ? [] : ['S', 'M', 'L', 'XL'];
  const descriptions = {
    tshirts: ['تيشيرت تمرين بخامة بتسحب العرق وبتنشف بسرعة، وقَصّة بتتحرك معاك في كل تمرين.', 'A training tee in sweat-wicking, quick-dry fabric with a cut that moves with you in every workout.'],
    shoes: ['كوتشي بنعل ثابت ومريح، معمول للرفعات التقيلة والكارديو في نفس الوقت.', 'A stable, comfortable sole built for heavy lifts and cardio alike.'],
    hoodies: ['هودي قطن تقيل بقَصّة أوفرسايز، دافي في الإحماء وشيك بره الجيم.', 'A heavyweight cotton hoodie with an oversized cut — warm for warm-ups and sharp outside the gym.'],
    pants: ['بنطلون مرن بيتمد مع حركتك، بجيوب عملية وخامة مابتكرمشش.', 'Stretchy pants that move with you, with practical pockets and wrinkle-free fabric.'],
    accessories: ['إكسسوار عملي معمول يستحمل التمرين اليومي.', 'A practical accessory built to handle daily training.'],
  };
  const reviews = [
    [['أحمد محمود', 'Ahmed Mahmoud'], 5, ['الخامة ممتازة والمقاس مظبوط، لبسته في التمرين ومضايقنيش خالص.', "Great fabric and a perfect fit — wore it to train and it didn't bother me at all."]],
    [['كريم عادل', 'Karim Adel'], 5, ['وصل في يومين والتغليف محترم. هطلب تاني أكيد.', 'Arrived in two days, nicely packaged. Definitely ordering again.']],
    [['يوسف طارق', 'Youssef Tarek'], 4, ['حلو جداً وسعره مناسب، كنت أتمنى ألوان أكتر.', 'Really nice and fairly priced — I wish there were more colors.']]
  ];
  const L = BLK_DEMO_LANG_INDEX;
  return Object.assign({}, base, {
    sku: `BLK-${base._id.replace('demo-', '').toUpperCase()}`,
    description: `<p>${descriptions[cat] ? descriptions[cat][L] : ''}</p><p>${blkT('demoDescription')}</p>`,
    options: sizes.length ? [{ name: blkT('size'), values: sizes.map(v => ({ _id: `${base._id}-${v}`, label: v })) }] : [],
    variants: [],
    reviews: base.reviewsCount
      ? reviews.slice(0, Math.min(3, base.reviewsCount)).map(([names, rating, comments]) => ({ name: names[L], rating, comment: comments[L] }))
      : []
  });
}

// منتجات قسم تجريبي (أو كلها لو مفيش قسم). null = القسم ده مش من الأقسام التجريبية
function blkDemoProducts(slug, sort) {
  const cat = blkDemoCategoryKey(slug);
  if (slug && !cat) return null;

  // المنتج بيظهر في قسمه الأساسي وفي أي قسم إضافي (زي "رجالي" و"بناطيل")
  const list = BLK_DEMO_CATALOG.filter(p => !cat || p.collections.some(c => c.slug === cat));
  const price = p => p.pricing.price;
  const sorters = {
    'price-asc': (a, b) => price(a) - price(b),
    'price-desc': (a, b) => price(b) - price(a),
    'created-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
    'rating-desc': (a, b) => b.averageRating - a.averageRating
  };
  return sorters[sort] ? list.slice().sort(sorters[sort]) : list;
}



/* ==========================================================
   DEMO PRODUCT PAGE (صفحة منتج للمنتجات التجريبية)
   المنصة بترجّع 404 لأي منتج مش موجود، فالمنتج التجريبي بيتفتح كصفحة كاملة
   في صفحة الشوب (/shop?product=demo-t1) بنفس تصميم وتفاعل صفحة المنتج
   ========================================================== */

// هيكل صفحة المنتج بنفس الـ hooks اللي blkHydrateProduct و initProductPageCore بيستخدموها
function blkPdpSkeleton() {
  const arrow = d => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="${d}"/></svg>`;
  return `
    <div class="blk-container">
      <nav class="blk-breadcrumb blk-pdp-crumb" aria-label="${blkEscape(blkT('breadcrumb'))}">
        <a href="/">${blkEscape(blkT('home'))}</a><span class="blk-breadcrumb-sep">/</span>
        <a href="/collections/demo">${blkEscape(blkT('category'))}</a><span class="blk-breadcrumb-sep">/</span>
        <span aria-current="page"></span>
      </nav>
      <div class="blk-pdp-grid">
        <div class="blk-pdp-gallery">
          <div class="blk-pdp-main" data-pdp-stage>
            <div class="blk-prod-badges"></div>
            <div class="blk-pdp-track" data-pdp-track></div>
            <button type="button" class="blk-pdp-arrow blk-pdp-arrow--prev" data-pdp-prev aria-label="${blkEscape(blkT('prevImage'))}">${arrow('M9 18l6-6-6-6')}</button>
            <button type="button" class="blk-pdp-arrow blk-pdp-arrow--next" data-pdp-next aria-label="${blkEscape(blkT('nextImage'))}">${arrow('M15 18l-6-6 6-6')}</button>
            <span class="blk-pdp-counter" aria-live="polite"></span>
            <button type="button" class="blk-pdp-expand" data-pdp-expand aria-label="${blkEscape(blkT('fullscreen'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
          </div>
          <div class="blk-pdp-dots" aria-hidden="true"></div>
          <div class="blk-pdp-thumbs" role="tablist" aria-label="${blkEscape(blkT('images'))}"></div>
        </div>
        <div class="blk-pdp-info">
          <a href="/collections/demo" class="blk-cat-badge"></a>
          <h2 class="blk-pdp-title"></h2>
          <a href="#" class="blk-pdp-rating" data-pdp-goto-tab="desc"></a>
          <div class="blk-pdp-price">
            <span class="blk-pdp-price-current" data-pdp-price></span>
            <span class="blk-pdp-price-old" data-pdp-old hidden></span>
            <span class="blk-pdp-save" data-pdp-save hidden></span>
          </div>
          <div class="blk-pdp-stock-wrap">
            <div class="blk-pdp-stock" data-pdp-stock role="status" aria-live="polite"></div>
            <div class="blk-pdp-stock-bar" data-pdp-stock-bar hidden><span></span></div>
          </div>
          <div class="blk-pdp-options"></div>
          <div class="blk-pdp-buy">
            <div class="blk-qty" data-pdp-qty>
              <button type="button" class="blk-qty-btn" data-qty-step="1" aria-label="${blkEscape(blkT('qtyIncrease'))}">+</button>
              <input type="number" class="blk-qty-input" value="1" min="1" aria-label="${blkEscape(blkT('quantity'))}" data-qty-input />
              <button type="button" class="blk-qty-btn" data-qty-step="-1" aria-label="${blkEscape(blkT('qtyDecrease'))}">−</button>
            </div>
            <button type="button" class="blk-btn blk-btn-primary blk-btn-shine blk-pdp-add" data-pdp-add>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              <span data-pdp-add-label>${blkEscape(blkT('addToCart'))}</span>
            </button>
          </div>
          <p class="blk-pdp-qty-note" data-pdp-qty-note hidden></p>
          <button type="button" class="blk-btn blk-btn-outline blk-pdp-buynow" data-pdp-add data-pdp-buynow><span>${blkEscape(blkT('buyNow'))}</span></button>
          <p class="blk-pdp-delivery" data-pdp-delivery hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <span>${blkEscape(blkT('deliveryBetween'))} <strong data-pdp-delivery-range></strong></span>
          </p>
          <ul class="blk-pdp-trust">
            <li><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg><span>${blkEscape(blkT('trustShipping'))}</span></li>
            <li><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg><span>${blkEscape(blkT('trustReturns'))}</span></li>
            <li><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>${blkEscape(blkT('trustSecure'))}</span></li>
          </ul>
          <dl class="blk-pdp-meta">
            <div data-pdp-sku-row hidden><dt>${blkEscape(blkT('sku'))}</dt><dd data-pdp-sku></dd></div>
            <div><dt>${blkEscape(blkT('category'))}</dt><dd><a href="/collections/demo"></a></dd></div>
            <div hidden><dt>${blkEscape(blkT('tags'))}</dt><dd class="blk-pdp-tags"></dd></div>
          </dl>
          <div class="blk-pdp-share">
            <span>${blkEscape(blkT('share'))}</span>
            <button type="button" data-pdp-share="native" hidden aria-label="${blkEscape(blkT('share'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg></button>
            <a href="#" data-pdp-share="whatsapp" target="_blank" rel="noopener noreferrer" aria-label="${blkEscape(blkT('shareWhatsapp'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7a11.4 11.4 0 0 1-4.4-3.9 5 5 0 0 1-1-2.7 2.9 2.9 0 0 1 .9-2.2 1 1 0 0 1 .7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6a8 8 0 0 0 1.5 1.8 7.2 7.2 0 0 0 2.1 1.3c.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9.6.3a2.4 2.4 0 0 1-.2 1.3z"/></svg></a>
            <a href="#" data-pdp-share="facebook" target="_blank" rel="noopener noreferrer" aria-label="${blkEscape(blkT('shareFacebook'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg></a>
            <button type="button" data-pdp-share="copy" aria-label="${blkEscape(blkT('copyLink'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg></button>
          </div>
        </div>
      </div>
      <div class="blk-pdp-tabs">
        <div class="blk-pdp-tablist" role="tablist" aria-label="${blkEscape(blkT('productDetails'))}">
          <button type="button" class="blk-pdp-tab is-active" role="tab" aria-selected="true" data-pdp-tab="desc">${blkEscape(blkT('tabDesc'))}</button>
          <button type="button" class="blk-pdp-tab" role="tab" aria-selected="false" data-pdp-tab="specs">${blkEscape(blkT('tabSpecs'))}</button>
          <button type="button" class="blk-pdp-tab" role="tab" aria-selected="false" data-pdp-tab="reviews">${blkEscape(blkT('tabReviews'))}</button>
          <span class="blk-pdp-tab-indicator" aria-hidden="true"></span>
        </div>
        <button type="button" class="blk-pdp-acc-head" data-pdp-acc="desc" aria-expanded="true">${blkEscape(blkT('tabDesc'))}</button>
        <div class="blk-pdp-panel is-active" role="tabpanel" data-pdp-panel="desc"></div>
        <button type="button" class="blk-pdp-acc-head" data-pdp-acc="specs" aria-expanded="false">${blkEscape(blkT('tabSpecs'))}</button>
        <div class="blk-pdp-panel" role="tabpanel" data-pdp-panel="specs" hidden><table class="blk-pdp-specs"><tbody></tbody></table></div>
        <button type="button" class="blk-pdp-acc-head" data-pdp-acc="reviews" aria-expanded="false">${blkEscape(blkT('tabReviews'))}</button>
        <div class="blk-pdp-panel" role="tabpanel" data-pdp-panel="reviews" hidden><div class="blk-pdp-reviews-summary"></div></div>
      </div>
      <div class="blk-pdp-related" data-pdp-related hidden>
        <h2 class="blk-section-title">${blkEscape(blkT('related'))}</h2>
        <div class="blk-prod-grid" data-pdp-related-grid style="--grid-cols: 4;"></div>
      </div>
    </div>
    <div class="blk-pdp-lightbox" data-pdp-lightbox hidden role="dialog" aria-modal="true" aria-label="${blkEscape(blkT('images'))}">
      <button type="button" class="blk-pdp-lb-close" data-pdp-lb-close aria-label="${blkEscape(blkT('close'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg></button>
      <button type="button" class="blk-pdp-lb-nav blk-pdp-lb-prev" data-pdp-lb-prev aria-label="${blkEscape(blkT('prevImage'))}">${arrow('M9 18l6-6-6-6')}</button>
      <button type="button" class="blk-pdp-lb-nav blk-pdp-lb-next" data-pdp-lb-next aria-label="${blkEscape(blkT('nextImage'))}">${arrow('M15 18l-6-6 6-6')}</button>
      <div class="blk-pdp-lb-stage" data-pdp-lb-stage><img class="blk-pdp-lb-img" data-pdp-lb-img alt="" /></div>
      <span class="blk-pdp-lb-count" data-pdp-lb-count></span>
    </div>
    <script type="application/json" data-pdp-variants>[]</script>`;
}

let blkDemoOverlayReturnFocus = null;

function blkCloseDemoProduct(fromHistory) {
  const overlay = document.querySelector('.blk-demo-pdp');
  if (!overlay) return;
  overlay.remove();
  document.documentElement.classList.remove('blk-no-scroll');
  if (!fromHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete('demo-product');
    url.searchParams.delete('product-id');
    url.searchParams.delete('product');
    if (/^\/shop\/[^/]+/.test(url.pathname)) url.pathname = BLK_SHOP_URL;
    window.history.replaceState({}, '', url);
  }
  if (blkDemoOverlayReturnFocus) blkDemoOverlayReturnFocus.focus();
}

// بيفتح صفحة المنتج التجريبي. false لو الـ slug مش من الكتالوج التجريبي
function blkOpenDemoProduct(slug, pushHistory) {
  const product = blkDemoProductBySlug(slug);
  if (!product) return false;
  return blkOpenProductOverlay(product, { demo: true, param: 'demo-product', value: slug, push: pushHistory });
}

// منتج من المتجر من غير slug: من الكاش (الكارت) أو من البحث، وبعدين المنتج كامل لو نقدر
async function blkOpenStoreProduct(id, pushHistory) {
  let product = BLK_PRODUCT_CACHE[id];
  if (!product) {
    const data = await blkFetchSearch({ q: '' }).catch(() => null);
    product = blkPickProducts(data).find(p => p && p._id === id);
  }
  if (!product) {
    showQmraToast(blkT('productNotFound'));
    return false;
  }
  const slug = blkProductSlug(product);
  if (slug && !product.options) {
    const full = await blkFetchProductByHandle(slug);
    if (full) product = Object.assign({}, product, full);
  }
  return blkOpenProductOverlay(product, { demo: false, param: 'product-id', value: id, push: pushHistory });
}

// /shop/<slug> → slug
function blkShopSlugFromPath() {
  const m = window.location.pathname.match(/^\/shop\/([^/?#]+)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (err) { return m[1]; }
}

// /shop/<slug> (أو /shop?product=<slug>): المنتج كامل بالـ slug، وإلا ندوّر عليه في البحث
async function blkOpenStoreProductBySlug(slug, pushHistory) {
  if (blkDemoProductBySlug(slug)) return blkOpenDemoProduct(slug, pushHistory);
  let product = await blkFetchProductByHandle(slug);
  if (!product) {
    const data = await blkFetchSearch({ q: '' }).catch(() => null);
    product = blkPickProducts(data).find(p => p && blkProductSlug(p) === slug) || null;
  }
  if (!product) {
    showQmraToast(blkT('productNotFound'));
    return false;
  }
  return blkOpenProductOverlay(product, { demo: false, param: 'product', value: slug, push: pushHistory });
}

// منتجات قد تعجبك: التجريبي من نفس القسم التجريبي، ومنتجات المتجر من المتجر (من غير المنتج نفسه)
async function blkRenderRelatedInOverlay(root, product, demo) {
  const wrap = root.querySelector('[data-pdp-related]');
  const grid = root.querySelector('[data-pdp-related-grid]');
  if (!wrap || !grid) return;
  let list = [];
  if (demo) {
    const cat = product.category && product.category.slug;
    const others = BLK_DEMO_CATALOG.filter(p => p._id !== product._id);
    list = others.filter(p => p.category.slug === cat).concat(others.filter(p => p.category.slug !== cat));
  } else {
    const data = await blkFetchSearch({ q: '' }).catch(() => null);
    list = blkPickProducts(data).filter(p => p && p._id && p._id !== product._id);
  }
  list = list.slice(0, 4);
  if (!list.length) return;
  grid.innerHTML = list.map(p => blkRenderProductCard(p, { demo })).join('');
  wrap.hidden = false;
  blkInitAll();
}

function blkOpenProductOverlay(product, { demo, param, value, push }) {
  blkCloseDemoProduct(true);
  blkDemoOverlayReturnFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'blk-demo-pdp';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', product.title);
  overlay.innerHTML = `
    <div class="blk-demo-pdp-bar">
      <button type="button" class="blk-demo-pdp-back" data-demo-pdp-close>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        ${blkEscape(blkT('back'))}
      </button>
      ${demo ? `<span class="blk-demo-pdp-note">${blkEscape(blkT('demoNote'))}</span>` : ''}
    </div>
    <section class="blk-section blk-pdp" data-blk-ready data-product-id="" data-delivery="2-5">${blkPdpSkeleton()}</section>`;
  document.body.appendChild(overlay);
  document.documentElement.classList.add('blk-no-scroll');

  const root = overlay.querySelector('.blk-pdp');
  blkHydrateProduct(root, product);
  if (demo) root.setAttribute('data-demo-product', '');
  initProductPageCore(root);
  blkRenderRelatedInOverlay(root, product, demo);

  overlay.querySelector('[data-demo-pdp-close]').addEventListener('click', () => {
    let fromStore = false;
    try { fromStore = !push && !!document.referrer && new URL(document.referrer).origin === window.location.origin; } catch (err) { /* referrer مش لينك */ }
    if (fromStore && window.history.length > 1) window.history.back();
    else if (fromStore) window.location.href = document.referrer;
    else blkCloseDemoProduct(false);
  });
  overlay.querySelector('[data-demo-pdp-close]').focus();

  if (push) {
    const url = new URL(window.location.href);
    url.searchParams.set(param, value);
    window.history.pushState({ [param]: value }, '', url);
  }
  return true;
}

document.addEventListener('keydown', (e) => {
  // Esc بيقفل الصفحة بس لو مفيش lightbox أو دليل مقاسات مفتوح فوقها
  if (e.key !== 'Escape') return;
  const overlay = document.querySelector('.blk-demo-pdp');
  if (!overlay) return;
  const inner = overlay.querySelector('[data-pdp-lightbox]:not([hidden]), [data-pdp-guide]:not([hidden])');
  if (!inner) blkCloseDemoProduct(false);
});

// زرار Back في المتصفح
window.addEventListener('popstate', () => {
  const slug = blkUrlParam('demo-product');
  const id = blkUrlParam('product-id');
  const productSlug = blkShopSlugFromPath() || blkUrlParam('product');
  if (slug) blkOpenDemoProduct(slug, false);
  else if (productSlug) blkOpenStoreProductBySlug(productSlug, false);
  else if (id) blkOpenStoreProduct(id, false);
  else blkCloseDemoProduct(true);
});

// صفحة الشوب اتفتحت بلينك منتج (/shop?product-id=... أو ?demo-product=...)
blkRegister('body', () => {
  const slug = blkUrlParam('demo-product');
  const id = blkUrlParam('product-id');
  const productSlug = blkShopSlugFromPath() || blkUrlParam('product');
  if (slug) blkOpenDemoProduct(slug, false);
  else if (productSlug) blkOpenStoreProductBySlug(productSlug, false);
  else if (id) blkOpenStoreProduct(id, false);
});


/* ==========================================================
   STORE CATEGORIES (بدل كروت الأقسام التجريبية)
   لو كروت الأقسام طلعت تجريبية (?demo=1)، بنجيب أقسام المتجر من /ajax/search/suggest
   ولو المتجر مفيهوش أقسام بنسيب التجريبي
   ========================================================== */

// رد قمرة: { resources: { collections } }، وبنقبل الأشكال التانية احتياطي
function blkPickCollections(data) {
  if (!data || typeof data !== 'object') return [];
  const lists = [
    data.collections,
    data.results && data.results.collections,
    data.resources && data.resources.collections, // شكل رد قمرة الفعلي
    data.resources && data.resources.results && data.resources.results.collections,
    data.data && data.data.collections,
    Array.isArray(data.results) ? data.results.filter(r => r && (r.type === 'collection' || r.resourceType === 'collection')) : null
  ];
  const list = lists.find(l => Array.isArray(l) && l.length) || [];
  return list.filter(c => c && c.title && (c.slug || c.handle || c._id));
}

// الأقسام اللي تتعرض للعميل بس (المتعطّل عنها البيع بيتشال)
function blkVisibleCollections(data) {
  // home-page: مجموعة نظام من المنصة («Home Page»)، مش قسم للعميل
  return blkPickCollections(data).filter(c => blkIsCollectionVisible(c) && c.title && (c.slug || c.handle || c._id) && (c.slug || c.handle) !== 'home-page');
}

// بحث الأقسام بـ q فاضي بيرجّع 400، والبحث بحرف بيرجّع الأقسام اللي فيها الحرف ده،
// فبنبحث بكام حرف شائع ونجمع الأقسام من غير تكرار (طلب واحد لكل الصفحة)
let blkStoreCollectionsRequest = null;
function blkFetchStoreCollections() {
  if (!blkStoreCollectionsRequest) {
    // حروف العلة بتغطي أسماء الأقسام الإنجليزي (handle)، والألف والياء العربي
    const letters = ['a', 'e', 'i', 'o', 'u', 'ا', 'ي'];
    blkStoreCollectionsRequest = Promise.all(letters.map(q => {
      const params = new URLSearchParams({ q, 'resources[type]': 'collection', 'resources[limit]': '20' });
      return blkFetchRetry(`/ajax/search/suggest?${params}`, { headers: { Accept: 'application/json' } })
        .then(res => (res.ok ? res.json() : null))
        .then(blkVisibleCollections)
        .catch(() => []);
    })).then(lists => {
      const byId = {};
      lists.flat().forEach(c => { if (c && c._id && !byId[c._id]) byId[c._id] = c; });
      return Object.values(byId);
    });
  }
  return blkStoreCollectionsRequest;
}

blkRegister('.blk-cats-strip-grid', initStoreCategories);

async function initStoreCategories(grid) {
  // الأقسام اللي التاجر اختارها بتفضل زي ما هي. الافتراضية (data-demo-cat) بتتبدّل بأقسام المتجر لو موجودة
  if (!grid.hasAttribute('data-store-collections')) return;
  // الكروت التجريبية: data-demo-cat، واللينكات القديمة اللي فيها demo=1
  const demoCards = grid.querySelectorAll('a.blk-cat-strip-card[data-demo-cat], a.blk-cat-strip-card[href*="demo=1"]');
  if (!demoCards.length) { grid.classList.remove('blk-store-loading'); return; }
  const max = demoCards.length;
  const glow = demoCards[0].classList.contains('blk-has-glow');

  let cols = [];
  try {
    cols = await blkFetchStoreCollections();
  } catch (err) {
    console.warn('[categories] loading store collections failed:', err);
  }
  if (!cols.length) {
    // المتجر مفيهوش أقسام: التجريبي في المعاينة بس، وللعميل رسالة مهذّبة (صفحة الأقسام) أو السكشن بيختفي (الرئيسية)
    if (blkDemoAllowed()) { grid.classList.remove('blk-store-loading'); return; }
    const section = grid.closest('section');
    const empty = section && section.querySelector('[data-blk-cats-empty]');
    grid.remove();
    if (empty) empty.hidden = false;
    else if (section) section.hidden = true;
    return;
  }
  grid.classList.remove('blk-store-loading');

  grid.innerHTML = cols.slice(0, max).map((c, i) => {
    const slug = c.slug || c.handle || c._id;
    const href = `/collections/${encodeURIComponent(slug)}${c._id ? `?cid=${encodeURIComponent(c._id)}&ct=${encodeURIComponent(c.title)}` : ''}`;
    const img = (c.image && (c.image.fileUrl || (typeof c.image === 'string' ? c.image : ''))) || (c.featuredImage && c.featuredImage.fileUrl) || '';
    // العدد اختياري: المنصة بتحسب المنتجات المؤرشفة كمان
    const count = grid.hasAttribute('data-show-count') ? (Number(c.productsCount || c.productCount || c.products_count) || 0) : 0;
    return `
      <a href="${blkEscape(href)}" class="blk-cat-strip-card${glow ? ' blk-has-glow' : ''} blk-anim-fade-up" style="--anim-delay: ${i * 0.12}s;">
        <div class="blk-cat-strip-img-wrap">
          ${img ? `<img src="${blkEscape(img)}" alt="${blkEscape(c.title)}" loading="lazy" class="blk-cat-strip-img">` : '<div class="blk-cat-strip-placeholder"></div>'}
          <div class="blk-cat-strip-overlay"></div>
        </div>
        <div class="blk-cat-strip-content">
          ${count ? `<span class="blk-cat-badge">${blkCountHtml(count)}</span>` : ''}
          <h3 class="blk-cat-strip-title">${blkEscape(c.title)}</h3>
          <div class="blk-cat-strip-link">
            <span>${blkEscape(blkT('shopNow'))}</span>
            <svg class="blk-arrow-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </div>
        </div>
        <div class="blk-glow-border"></div>
      </a>`;
  }).join('');
}



/* ==========================================================
   STORE PRODUCTS (ويدجتس الهوم لما مايتختارش منتجات)
   أي عنصر عليه data-blk-store-products بيتملى بمنتجات المتجر من /ajax/search/products
   data-limit, data-sort, data-collection-id, data-exclude, data-badge,
   data-item-class (wrapper لكل كارت), data-first-class, data-hide-quickview|rating|stock|second-image
   ========================================================== */

// طلب واحد لكل رابط حتى لو أكتر من ويدجت في الصفحة طلبه
const blkStoreRequests = {};
function blkFetchStoreProducts(params) {
  const url = `/ajax/search/products?${params}`;
  if (!blkStoreRequests[url]) {
    blkStoreRequests[url] = blkFetchSearch(params)
      .then(blkPickProducts)
      .catch(err => {
        delete blkStoreRequests[url];
        throw err;
      });
  }
  return blkStoreRequests[url];
}

blkRegister('[data-blk-store-products]', initStoreProducts);

function blkHideStoreSection(holder) {
  // أقرب غلاف خاص بالمنتجات (منتجات رائجة في البحث / 404) وإلا السكشن كله
  const section = holder.closest('[data-search-popular], [data-404-products], section');
  if (section) { section.hidden = true; section.setAttribute('data-store-empty', ''); }
}

async function initStoreProducts(holder) {
  const limit = Number(holder.getAttribute('data-limit')) || 8;
  const exclude = holder.getAttribute('data-exclude');
  const itemClass = holder.getAttribute('data-item-class');
  const firstClass = holder.getAttribute('data-first-class');
  const opts = {
    badge: holder.getAttribute('data-badge') || '',
    hideQuickView: holder.hasAttribute('data-hide-quickview'),
    hideRating: holder.hasAttribute('data-hide-rating'),
    hideStock: holder.hasAttribute('data-hide-stock'),
    hideSecondImage: holder.hasAttribute('data-hide-second-image')
  };

  // بنطلب على قد اللي هيتعرض بس (+1 لو هنشيل المنتج الحالي)
  const byCollection = holder.getAttribute('data-collection-id');
  // مع فلتر قسم مانبعتش limit (ممكن السيرفر يتجاهل الفلتر معاه)، والعرض بيتقص تحت
  const params = new URLSearchParams({ q: '' });
  if (!byCollection) params.set('limit', String(limit + (exclude ? 1 : 0)));
  if (holder.getAttribute('data-sort')) params.set('sort', holder.getAttribute('data-sort'));
  if (byCollection) params.set(blkCollectionParam, byCollection);

  try {
    let products = (await blkFetchStoreProducts(params)).filter(p => p && p._id && p._id !== exclude);

    // صفحة المنتج: منتجات نفس القسم الأول (لو الـ API رجّع أقسام مختلطة)
    const preferred = holder.getAttribute('data-prefer-category');
    if (preferred) {
      const same = p => p.category && p.category.title === preferred;
      products = products.filter(same).concat(products.filter(p => !same(p)));
    }
    products = products.slice(0, limit);

    if (products.length < (Number(holder.getAttribute('data-min-count')) || 1)) {
      // صفحة المنتج: مفيش منتجات تانية، نخفي السكشن بدل التجريبي.
      // غير كده المتجر فاضي: التجريبي بيفضل في المعاينة بس، وللعميل السكشن بيختفي (HOME-11 / EDGE-01)
      if (holder.hasAttribute('data-hide-if-empty') || !blkDemoAllowed()) blkHideStoreSection(holder);
      return;
    }

    holder.innerHTML = products.map((p, i) => {
      const card = blkRenderProductCard(p, opts);
      if (!itemClass) return card;
      const cls = i === 0 && firstClass ? `${itemClass} ${firstClass}` : itemClass;
      const category = p.category && p.category.title ? blkEscape(p.category.title) : '';
      return `<div class="${cls}" data-category="${category}" style="--i: ${i};">${card}</div>`;
    }).join('');

    holder.dispatchEvent(new CustomEvent('blk:products-loaded', { bubbles: true, detail: { products } }));
    blkInitAll();
  } catch (err) {
    console.warn('[store-products] loading failed:', err);
    if (holder.hasAttribute('data-hide-if-empty') || !blkDemoAllowed()) blkHideStoreSection(holder);
  } finally {
    holder.classList.remove('blk-store-loading');
  }
}



/* ==========================================================
   4. PRODUCT GRID TOOLBAR (ترتيب + شكل العرض)
   ========================================================== */

blkRegister('.blk-plp', initProductGrid);

function initProductGrid(root) {
  let grid = root.querySelector('[data-plp-grid]');
  const sortSel = root.querySelector('[data-plp-sort]');

  root.querySelectorAll('[data-plp-cols]').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('[data-plp-cols]').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      if (grid) grid.style.setProperty('--grid-cols', btn.getAttribute('data-plp-cols'));
    });
  });

  // صفحة بيانات المنصة (context.shop / context.products): الترتيب بيتبعت للسيرفر (?sort=) بقيم المنصة (FLT-09 / FLT-10)
  const cfg = (() => { try { return JSON.parse(root.getAttribute('data-plp-filters') || '{}'); } catch (err) { return {}; } })();
  const srcAttr = grid ? grid.getAttribute('data-plp-source') : 'server';
  const legacyRefetch = srcAttr === 'collection' && !!(grid.getAttribute('data-collection-id') || blkUrlParam('cid') || blkCollectionSlugFromUrl());
  if (cfg.isServer && srcAttr !== 'global' && !legacyRefetch) {
    if (sortSel) {
      const current = blkUrlParam('sort');
      if (current && Array.from(sortSel.options).some(o => o.value === current)) sortSel.value = current;
      sortSel.addEventListener('change', () => {
        const url = new URL(window.location.href);
        if (sortSel.value && sortSel.value !== 'default') url.searchParams.set('sort', sortSel.value); else url.searchParams.delete('sort');
        url.searchParams.delete('page');
        window.location.href = url.pathname + url.search;
      });
    }
    // المتجر/المجموعة فاضية في معاينة البيلدر: منتجات تجريبية بدل الصفحة الفاضية (للعميل: رسالة المجموعة الفاضية)
    const filtered = Array.from(new URLSearchParams(window.location.search).keys()).some(k => /^filters\[/.test(k));
    if (!grid && blkDemoAllowed() && !filtered && !root.querySelector('[data-collection-id]')) {
      const list = blkDemoProducts('', blkUrlParam('sort')) || [];
      const results = root.querySelector('.blk-plp-results');
      if (list.length && results) {
        grid = document.createElement('div');
        grid.className = 'blk-prod-grid';
        grid.setAttribute('data-plp-grid', '');
        grid.setAttribute('data-plp-source', 'demo');
        grid.innerHTML = list.map(p => blkRenderProductCard(p, { demo: true })).join('');
        results.prepend(grid);
        const empty = root.querySelector('[data-plp-empty]');
        if (empty) empty.hidden = true;
        blkSetPlpCount(root, list.length);
        blkInitAll();
        root.dispatchEvent(new CustomEvent('blk:plp-rendered', { bubbles: true }));
      }
    }
    return;
  }
  if (!grid) return;

  // المحرر أحياناً بيفتح صفحة القسم من غير متغير collection، فالقالب بيعرض كل المتجر.
  // لو اللينك /collections/<قسم> بنجيب منتجات القسم ده بس بدل الكل
  const urlSlug = blkCollectionSlugFromUrl();
  const source = grid.getAttribute('data-plp-source');
  const isCategoryPage = (source === 'global' && (urlSlug || blkUrlParam('cid')))
    // المعاينة بتبعت collection.products وفيها كل منتجات المتجر، فبنعيد نجيبها بفلتر القسم
    || (source === 'collection' && (grid.getAttribute('data-collection-id') || blkUrlParam('cid') || urlSlug));
  if (!grid.hasAttribute('data-plp-remote') && isCategoryPage) {
    grid.setAttribute('data-plp-remote', '');
    grid.classList.add('is-loading');
    const pagination = root.querySelector('[data-plp-pagination]');
    if (pagination) pagination.hidden = true;
  }

  if (grid.hasAttribute('data-plp-remote')) {
    initRemoteProductGrid(root, grid);
    return;
  }

  const originalOrder = Array.from(grid.children);
  const sortEl = root.querySelector('[data-plp-sort]');

  if (sortEl) {
    sortEl.addEventListener('change', () => {
      blkSetSortParam(sortEl.value === 'default' ? '' : sortEl.value);
      const cards = Array.from(grid.children);
      const price = el => Number(el.getAttribute('data-price')) || 0;
      const created = el => Date.parse(el.getAttribute('data-created')) || 0;

      const sorters = {
        'price-asc': (a, b) => price(a) - price(b),
        'price-desc': (a, b) => price(b) - price(a),
        'created-desc': (a, b) => created(b) - created(a)
      };

      const sorted = sorters[sortEl.value] ? cards.sort(sorters[sortEl.value]) : originalOrder;
      grid.classList.add('is-sorting');
      setTimeout(() => {
        sorted.forEach(card => grid.appendChild(card));
        grid.classList.remove('is-sorting');
      }, 200);
    });
    // ترتيب محفوظ في اللينك: يتطبق أول ما الصفحة تفتح
    const saved = blkUrlParam('sort');
    if (saved && Array.from(sortEl.options).some(o => o.value === saved)) {
      sortEl.value = saved;
      sortEl.dispatchEvent(new Event('change'));
    }
  }
}

// الترتيب في اللينك (?sort=)، والصفحة بترجع للأولى
function blkSetSortParam(value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set('sort', value); else url.searchParams.delete('sort');
  url.searchParams.delete('page');
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
}

// ترقيم الصفحات: اللينكات (?page=N) بتحتفظ بباقي الباراميترات (القسم والترتيب والبحث)
function blkFixPaginationLinks() {
  document.querySelectorAll('.blk-pagination a[href^="?page="]').forEach(a => {
    const n = new URLSearchParams(a.getAttribute('href').slice(1)).get('page');
    const url = new URL(window.location.href);
    url.searchParams.set('page', n);
    a.setAttribute('href', url.pathname + url.search);
  });
}
document.addEventListener('DOMContentLoaded', blkFixPaginationLinks);
if (document.readyState !== 'loading') blkFixPaginationLinks();

// الرد ممكن يبقى { products } أو { results } أو { data } أو array على طول
function blkPickProducts(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const list = [data.products, data.results, data.items, data.data, data.data && data.data.products]
    .find(Array.isArray);
  return list || [];
}

// بيرجع function بتفلتر المنتجات على القسم الحالي (id أو slug أو الاسم).
// القسم جاي من data-collection-* في القالب، أو من اللينك /collections/<slug> لو المتغير مش متاح (زي المحرر).
// لو المنتجات مفيهاش أي معلومة عن قسمها بنسيبها زي ما الـ API رجّعها.
function blkCollectionMatcher(grid) {
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const slug = grid.getAttribute('data-collection-slug') || blkCollectionSlugFromUrl();
  const wanted = [grid.getAttribute('data-collection-id') || blkUrlParam('cid'), slug, grid.getAttribute('data-collection-title') || blkUrlParam('ct')]
    .map(norm).filter(Boolean);

  const keysOf = (p) => {
    const keys = [];
    const add = (c) => {
      if (!c) return;
      if (typeof c === 'string') keys.push(c);
      else {
        keys.push(c._id, c.id, c.slug, c.handle, c.title);
        // اسم القسم الحقيقي عشان البانر
        if (c.title && [c._id, c.id, c.slug, c.handle, c.title].map(norm).some(k => wanted.includes(k))) {
          matcher.resolvedTitle = matcher.resolvedTitle || c.title;
        }
      }
    };
    (Array.isArray(p.collections) ? p.collections : []).forEach(add);
    (Array.isArray(p.collectionIds) ? p.collectionIds : []).forEach(add);
    add(p.collection);
    add(p.collectionId);
    add(p.category);
    return keys.map(norm).filter(Boolean);
  };

  const matcher = (list) => {
    if (!wanted.length) return list;
    // المنتج ممكن يكون في أكتر من قسم، فلو السيرفر فلتر بالـ id بنصدّقه
    if (matcher.byId && !matcher.apiIgnoredId) return list;
    const known = list.filter(p => p && keysOf(p).length);
    if (!known.length) return list; // مفيش معلومة نفلتر بيها
    matcher.filtered = true;
    return list.filter(p => p && keysOf(p).some(k => wanted.includes(k)));
  };
  matcher.filtered = false;
  matcher.slug = slug;
  matcher.byId = !!(grid.getAttribute('data-collection-id') || blkUrlParam('cid'));
  matcher.apiIgnoredId = false;
  matcher.resolvedTitle = grid.getAttribute('data-collection-title') || blkUrlParam('ct') || '';
  return matcher;
}

// /collections/<slug> → slug (غير all اللي هي صفحة كل المنتجات)
// صفحات الأقسام الافتراضية بتتفتح على /shop?category=<slug>&demo=1، لأن المنصة بترجّع 500
// لـ /collections/<قسم مش موجود في المتجر>
function blkCollectionSlugFromUrl() {
  const m = window.location.pathname.match(/\/collections\/([^/?#]+)/);
  if (!m) return blkUrlParam('category');
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch (err) { /* اللينك مش encoded صح */ }
  return slug.toLowerCase() === 'all' ? '' : slug;
}

// البانر بيكتب "صفحة" لما مايلاقيش عنوان: في صفحة قسم نكتب اسم القسم من اللينك، وبعدين الاسم الحقيقي
blkRegister('[data-banner-fallback]', (el) => {
  const title = blkUrlParam('ct');
  const slug = blkCollectionSlugFromUrl();
  if (title) el.textContent = title;
  else if (slug) el.textContent = slug.replace(/[-_]+/g, ' ');
});

function blkUrlParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name) || '';
  } catch (err) {
    return '';
  }
}

document.addEventListener('blk:collection-title', (e) => {
  const title = e.detail && e.detail.title;
  if (!title) return;
  document.querySelectorAll('[data-banner-fallback]').forEach(el => { el.textContent = title; });
  // صفحة قسم على /shop?category=: العنوان اسم القسم بدل "المتجر"
  if (blkUrlParam('category')) document.querySelectorAll('[data-banner-title]').forEach(el => { el.textContent = title; });
});

// عدد المنتجات في كل طلب (و"عرض المزيد" بيجيب الصفحة اللي بعدها)
const BLK_PLP_PAGE_SIZE = 12;

// id القسم من اسمه (slug) عن طريق بحث الأقسام، للينكات اللي مفيهاش ?cid=
async function blkResolveCollectionId(slug) {
  try {
    const params = new URLSearchParams({ q: slug.replace(/[-_]+/g, ' '), 'resources[type]': 'collection', 'resources[limit]': '10' });
    const res = await blkFetchRetry(`/ajax/search/suggest?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const norm = v => String(v || '').trim().toLowerCase();
    const list = blkPickCollections(await res.json());
    const found = list.find(c => [c.slug, c.handle, c._id].map(norm).includes(norm(slug))) || null;
    // قسم متعطّل: بنرجّعه متعلّم عشان الصفحة تقول إنه مش متاح بدل ما تعرض منتجاته
    return found && !blkIsCollectionVisible(found) ? Object.assign({}, found, { blkHidden: true }) : found;
  } catch (err) {
    return null;
  }
}

// اسم فلتر القسم: الدوكس بتقول collectionId، ولو السيرفر تجاهله بنجرب الباقيين ونفتكر اللي اشتغل
const BLK_COLLECTION_PARAMS = ['collectionId', 'collection_id', 'collections', 'categoryId', 'category'];
let blkCollectionParam = 'collectionId';
try { blkCollectionParam = sessionStorage.getItem('blkCollectionParam') || 'collectionId'; } catch (err) { /* التخزين مقفول */ }

function blkSetPlpCount(root, n) {
  const el = root.querySelector('[data-plp-count-text]');
  if (el) el.innerHTML = blkCountHtml(n);
}

// صفحة كل المنتجات: مفيش collection.products، فبنجيب منتجات المتجر من الـ search API
function initRemoteProductGrid(root, grid) {
  const sortEl = root.querySelector('[data-plp-sort]');
  const toolbar = root.querySelector('[data-plp-toolbar]');
  const moreWrap = root.querySelector('[data-plp-more-wrap]');
  const moreBtn = root.querySelector('[data-plp-more]');
  const empty = root.querySelector('[data-plp-empty]');
  let collectionId = grid.getAttribute('data-collection-id') || blkUrlParam('cid');
  const inCollection = blkCollectionMatcher(grid);
  const cardOpts = { hideQuickView: grid.hasAttribute('data-hide-quickview') };
  const seen = new Set();
  let page = 1;
  // الترتيب من اللينك (?sort=) لو موجود، عشان يفضل بعد التحديث ومع اللينك المنسوخ (FLT-06)
  let sort = blkUrlParam('sort') || grid.getAttribute('data-sort') || '';
  if (sortEl && blkUrlParam('sort')) sortEl.value = blkUrlParam('sort');
  let requestId = 0;

  // المنتجات التجريبية بتظهر بس من كروت الأقسام التجريبية (?demo=1)، أو في صفحة كل المنتجات لو المتجر فاضي.
  // أي قسم حقيقي بيعرض منتجاته حتى لو اسمه زي قسم تجريبي (زي "بناطيل")
  const isDemoLink = blkUrlParam('demo') === '1';
  // قسم تجريبي من غير demo=1 (لينكات الهيدر/الأقسام الافتراضية): لو مفيش قسم حقيقي بالاسم ده والمتجر مارجّعش منتجات بنعرض التجريبي
  // للعميل: المنتجات التجريبية مابتظهرش خالص (HOME-11 / EDGE-01) — في معاينة البيلدر أو لو التاجر فعّل «منتجات تجريبية» بس
  const demoAllowed = () => blkDemoAllowed() && (isDemoLink || (!inCollection.slug && !collectionId) || (!collectionId && !!blkDemoCategoryKey(inCollection.slug)));

  const showDemo = () => {
    const list = blkDemoProducts(inCollection.slug, sort);
    if (!list || !list.length) return false;
    grid.innerHTML = list.map(p => blkRenderProductCard(p, Object.assign({ demo: true }, cardOpts))).join('');
    blkInitAll();
    blkSetPlpCount(root, list.length);
    if (moreWrap) moreWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (toolbar) toolbar.hidden = false;
    grid.hidden = false;
    // اسم القسم نفسه (مش قسم أول منتج: صفحة "رجالي" أول منتج فيها من "تيشيرتات")
    const title = inCollection.slug && BLK_DEMO_CATEGORIES[blkDemoCategoryKey(inCollection.slug)];
    if (title) document.dispatchEvent(new CustomEvent('blk:collection-title', { detail: { title } }));
    root.dispatchEvent(new CustomEvent('blk:plp-rendered', { bubbles: true }));
    return true;
  };

  const load = async (append) => {
    const id = ++requestId;
    // طلب القسم من غير limit: ممكن السيرفر يتجاهل فلتر القسم لما يلاقي limit ويرجّع كل المنتجات
    const params = new URLSearchParams({ q: '' });
    if (!collectionId) params.set('limit', String(BLK_PLP_PAGE_SIZE));
    if (sort) params.set('sort', sort);
    if (collectionId) params.set(blkCollectionParam, collectionId);
    if (inCollection.slug) params.set('collection', inCollection.slug);
    if (page > 1) params.set('page', page);

    grid.setAttribute('aria-busy', 'true');
    if (append && moreBtn) moreBtn.disabled = true;
    else grid.classList.add('is-loading');

    try {
      if (!append && isDemoLink && blkDemoAllowed() && showDemo()) return;

      // لينك من غير id (منيو الهيدر مثلاً): بنجيب id القسم من بحث الأقسام بالاسم
      if (!collectionId && inCollection.slug && !isDemoLink) {
        const found = await blkResolveCollectionId(inCollection.slug);
        if (id !== requestId) return;
        if (found && found.blkHidden) {
          // المجموعة متعطّل عنها البيع: مانعرضش منتجاتها
          grid.innerHTML = '';
          grid.hidden = true;
          if (toolbar) toolbar.hidden = true;
          if (moreWrap) moreWrap.hidden = true;
          const unavailable = root.querySelector('[data-plp-unavailable]');
          if (unavailable) unavailable.hidden = false;
          else if (empty) empty.hidden = false;
          return;
        }
        if (found) {
          collectionId = found._id;
          inCollection.byId = true;
          if (found.title && !inCollection.resolvedTitle) inCollection.resolvedTitle = found.title;
          params.set(blkCollectionParam, collectionId);
          params.delete('limit');
        }
      }

      let data = await blkFetchSearch(params);
      if (id !== requestId) return; // فيه طلب أحدث (غيّر الترتيب مثلاً)

      if (!append) seen.clear();

      if (!append && inCollection.byId) {
        const plain = new URLSearchParams({ q: '' });
        if (sort) plain.set('sort', sort);
        const allData = await blkFetchSearch(plain).catch(() => null);
        if (id !== requestId) return;
        const ids = list => blkPickProducts(list).map(p => p && p._id).join(',');
        const ignored = d => !!allData && ids(d) === ids(allData) && ids(d) !== '';

        // نفس النتيجة بالظبط = السيرفر تجاهل الفلتر. نجرب الأسماء التانية الشائعة لفلتر القسم
        if (ignored(data)) {
          for (const key of BLK_COLLECTION_PARAMS.filter(k => k !== blkCollectionParam)) {
            const alt = new URLSearchParams({ q: '' });
            if (sort) alt.set('sort', sort);
            alt.set(key, collectionId);
            const altData = await blkFetchSearch(alt).catch(() => null);
            if (id !== requestId) return;
            if (altData && !ignored(altData)) {
              blkCollectionParam = key;
              try { sessionStorage.setItem('blkCollectionParam', key); } catch (err) { /* التخزين مقفول */ }
              data = altData;
              break;
            }
          }
        }
        inCollection.apiIgnoredId = ignored(data);
        if (inCollection.apiIgnoredId) console.warn('[plp] the store API ignores every collection filter we tried; filtering in the browser');
      }
      // بنشيل المكرر لو الـ API مش بيدعم page ورجّع نفس المنتجات
      // لو الـ API رجّع منتجات من أقسام تانية (مطبّقش collectionId) بنفلترها هنا
      const fresh = inCollection(blkPickProducts(data)).filter(p => p && p._id && !seen.has(p._id));

      // صفحة كل المنتجات والمتجر فاضي: نعرض التجريبي بدل صفحة فاضية
      if (!append && !fresh.length && demoAllowed() && showDemo()) return;

      fresh.forEach(p => seen.add(p._id));

      const html = fresh.map(p => blkRenderProductCard(p, cardOpts)).join('');
      if (append) grid.insertAdjacentHTML('beforeend', html);
      else grid.innerHTML = html;
      blkInitAll();

      const meta = (data && (data.pagination || data.meta)) || data || {};
      const total = Number(meta.total || meta.totalCount || meta.totalProducts || meta.count) || 0;
      const shown = grid.children.length;
      const hasMore = fresh.length > 0 && (
        meta.hasNextPage === true ||
        (Number(meta.totalPages || meta.pages) > page) ||
        (total > shown)
      );

      // لو فلترنا بنفسنا، رقم الـ API مش رقم القسم
      blkSetPlpCount(root, inCollection.filtered ? shown : (total || shown));
      if (inCollection.resolvedTitle) {
        document.dispatchEvent(new CustomEvent('blk:collection-title', { detail: { title: inCollection.resolvedTitle } }));
      }
      if (moreWrap) moreWrap.hidden = !hasMore;
      if (empty) empty.hidden = shown > 0;
      if (toolbar) toolbar.hidden = shown === 0;
      grid.hidden = shown === 0;
      root.dispatchEvent(new CustomEvent('blk:plp-rendered', { bubbles: true }));
    } catch (err) {
      if (id !== requestId) return;
      console.warn('[plp] loading store products failed:', err);
      if (!append && demoAllowed() && showDemo()) return;
      if (!append) {
        grid.innerHTML = '';
        grid.hidden = true;
        if (toolbar) toolbar.hidden = true;
        if (empty) empty.hidden = false;
      }
      showQmraToast(blkT('loadFailed'));
    } finally {
      if (id === requestId) {
        grid.removeAttribute('aria-busy');
        grid.classList.remove('is-loading');
        if (moreBtn) moreBtn.disabled = false;
      }
    }
  };

  if (sortEl) {
    sortEl.addEventListener('change', () => {
      sort = sortEl.value === 'default' ? '' : sortEl.value;
      blkSetSortParam(sort);
      page = 1;
      load(false);
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      page += 1;
      load(true);
    });
  }

  load(false);
}



/* ==========================================================
   4.5 الفلاتر (FLT-01..12)
   - server: فلاتر لوحة التحكم — كل تغيير بيتبعت للسيرفر في اللينك (filters[name][]= و filters[price][min|max])
     فالنتايج مفلترة على كل صفحات المجموعة مش الصفحة الحالية بس
   - client: مفيش فلاتر من لوحة التحكم — وسوم المنتجات (key:value) + المتوفر بس + السعر على الكروت الموجودة
   على الموبايل/التابلت (≤1023) الفلاتر درج: «عرض النتائج» بيطبّق، و«إلغاء»/✕/الخلفية/Esc بيرجّعوا الحالة اللي اتفتح بيها
   ========================================================== */
blkRegister('[data-plp-filters]', initPlpFilters);

function initPlpFilters(root) {
  const panel = root.querySelector('[data-filter-panel]');
  if (!panel) return;
  let cfg = {};
  try { cfg = JSON.parse(root.getAttribute('data-plp-filters') || '{}'); } catch (err) { cfg = {}; }
  const server = cfg.mode === 'server';
  const $ = sel => root.querySelector(sel);
  const scrim = $('[data-filter-scrim]');
  const openBtn = $('[data-filter-open]');
  const badge = $('[data-filter-badge]');
  const chipsEl = $('[data-filter-chips]');
  const noMatch = $('[data-plp-no-match]');
  const emptyEl = $('[data-plp-empty]');
  const countText = $('[data-plp-count-text]');
  const minEl = panel.querySelector('[data-price-min]');
  const maxEl = panel.querySelector('[data-price-max]');
  const note = panel.querySelector('[data-price-note]');
  const stockEl = panel.querySelector('[data-filter-stock]');
  const autoHost = panel.querySelector('[data-facet-auto]');
  const isDrawer = () => window.matchMedia('(max-width: 1023px)').matches;
  const latin = v => String(v == null ? '' : v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').trim();
  const sp = new URLSearchParams(window.location.search);
  let keys = server ? (cfg.serverKeys || []).map(String) : [];
  const labels = {};
  const state = {
    sel: {},
    stock: !server && sp.get('filters[stock]') === 'in',
    min: latin(sp.get('filters[price][min]') || ''),
    max: latin(sp.get('filters[price][max]') || '')
  };
  const readSel = k => sp.getAll(`filters[${k}][]`).map(v => String(v).trim()).filter(Boolean);
  keys.forEach(k => { state.sel[k] = readSel(k); });
  let open = false;
  let snap = null;

  const cards = () => Array.from(root.querySelectorAll('[data-plp-grid] .blk-prod-card'));
  const cardTags = el => (el.getAttribute('data-tags') || '').split('|').filter(Boolean);

  // client: الوسوم key:value من الكروت (القيم الموجودة فعلًا بس — FLT-01)
  const scan = () => {
    if (server || !autoHost) return;
    const acc = {};
    cards().forEach(el => cardTags(el).forEach(tag => {
      const i = tag.indexOf(':');
      if (i < 1) return;
      const k = tag.slice(0, i).trim().toLowerCase();
      const v = tag.slice(i + 1).trim();
      if (!k || !v) return;
      acc[k] = acc[k] || new Map();
      acc[k].set(v, (acc[k].get(v) || 0) + 1);
    }));
    keys = Object.keys(acc);
    keys.forEach(k => { if (!state.sel[k]) state.sel[k] = readSel(k); });
    autoHost.innerHTML = keys.map(k => {
      const nameKey = `filterName_${k}`;
      const label = blkT(nameKey) || (k.charAt(0).toUpperCase() + k.slice(1));
      labels[k] = label;
      const opts = Array.from(acc[k]).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), blkLang()));
      return `<fieldset class="blk-facet" data-facet="${blkEscape(k)}"><legend>${blkEscape(label)}</legend><div class="blk-facet-list">${opts.map(([v, n]) =>
        `<label class="blk-facet-opt"><input type="checkbox" value="${blkEscape(v)}" data-facet-input="${blkEscape(k)}"><span class="blk-facet-name">${blkEscape(v)}</span><small class="blk-facet-count">${n}</small></label>`).join('')}</div></fieldset>`;
    }).join('');
  };
  if (server) panel.querySelectorAll('[data-facet]').forEach(f => { labels[f.getAttribute('data-facet')] = (f.querySelector('legend') || {}).textContent || f.getAttribute('data-facet'); });

  const paintControls = () => {
    panel.querySelectorAll('[data-facet-input]').forEach(input => {
      input.checked = (state.sel[input.getAttribute('data-facet-input')] || []).includes(input.value);
    });
    if (stockEl) stockEl.checked = state.stock;
    if (minEl) minEl.value = state.min;
    if (maxEl) maxEl.value = state.max;
  };

  const activeCount = () => keys.reduce((n, k) => n + ((state.sel[k] || []).length ? 1 : 0), 0)
    + (state.stock ? 1 : 0) + (state.min !== '' || state.max !== '' ? 1 : 0);

  const minor = v => (v === '' ? null : Number(v) * BLK_PRICE_SCALE);
  const matches = el => {
    const tags = cardTags(el).map(t => t.toLowerCase());
    for (const k of keys) {
      const want = state.sel[k] || [];
      if (want.length && !want.some(v => tags.includes(`${k}:${String(v).toLowerCase()}`))) return false;
    }
    if (state.stock && el.getAttribute('data-out') === '1') return false;
    const price = Number(el.getAttribute('data-price'));
    if (Number.isFinite(price)) {
      const lo = minor(state.min);
      const hi = minor(state.max);
      if (lo !== null && price < lo) return false;
      if (hi !== null && price > hi) return false;
    }
    return true;
  };

  const renderChips = () => {
    if (!chipsEl) return;
    const chips = [];
    keys.forEach(k => (state.sel[k] || []).forEach(v => chips.push({ k, v, text: `${labels[k] || k}: ${v}` })));
    if (state.stock) chips.push({ k: '__stock', v: '', text: cfg.stockLabel || blkT('inStock') });
    if (state.min !== '' || state.max !== '') chips.push({ k: '__price', v: '', text: `${blkT('priceLabel')}: ${state.min || 0} – ${state.max || '∞'}` });
    chipsEl.hidden = !chips.length;
    chipsEl.innerHTML = chips.map(c => `<button type="button" class="blk-filter-chip" data-chip-key="${blkEscape(c.k)}" data-chip-value="${blkEscape(c.v)}" aria-label="${blkEscape(blkT('removeFilter'))}: ${blkEscape(c.text)}"><span>${blkEscape(c.text)}</span><span aria-hidden="true">✕</span></button>`).join('')
      + (chips.length ? `<button type="button" class="blk-filter-chip is-clear" data-filter-clear>${blkEscape(blkT('clearAll'))}</button>` : '');
  };

  const syncUi = () => {
    const n = activeCount();
    if (badge) { badge.hidden = !n; badge.textContent = n; }
    panel.querySelectorAll('[data-filter-clear]').forEach(b => { b.hidden = !n; });
    renderChips();
  };

  const apply = () => {
    const list = cards();
    let shown = list.length;
    if (!server) {
      shown = 0;
      list.forEach(el => { const ok = matches(el); el.hidden = !ok; if (ok) shown++; });
    }
    const grid = root.querySelector('[data-plp-grid]');
    const total = server ? Math.max(Number(cfg.totalItems) || 0, list.length) : list.length;
    const active = activeCount() > 0;
    // FLT-08: مفيش نتايج بالفلاتر دي (مش مجموعة فاضية)
    const none = active && shown === 0;
    if (noMatch) noMatch.hidden = !none;
    if (grid) grid.hidden = shown === 0;
    if (emptyEl && (none || list.length)) emptyEl.hidden = true;
    else if (emptyEl && server && !list.length && !active) emptyEl.hidden = false;
    const pagination = root.querySelector('[data-plp-pagination]');
    if (pagination) pagination.hidden = none || (!server && active);
    if (countText && (list.length || active)) {
      countText.innerHTML = !server && active && shown !== total
        ? blkEscape(blkT('showingOf', { shown, total }))
        : blkCountHtml(server ? total : shown);
    }
    syncUi();
  };

  const filterUrl = () => {
    const u = new URL(window.location.href);
    Array.from(u.searchParams.keys()).filter(k => /^filters\[/.test(k)).forEach(k => u.searchParams.delete(k));
    u.searchParams.delete('page');
    keys.forEach(k => (state.sel[k] || []).forEach(v => u.searchParams.append(`filters[${k}][]`, v)));
    if (state.min !== '') u.searchParams.set('filters[price][min]', state.min);
    if (state.max !== '') u.searchParams.set('filters[price][max]', state.max);
    if (state.stock && !server) u.searchParams.set('filters[stock]', 'in');
    return u;
  };
  const navigate = () => {
    const u = filterUrl();
    if (u.search === window.location.search) return;
    root.classList.add('is-navigating');
    window.location.href = u.pathname + u.search;
  };
  // client: الحالة في اللينك (FLT-06) — كل تغيير بيتسجل في التاريخ عشان زرار الرجوع (FLT-07)
  const syncUrl = (push) => {
    const u = filterUrl();
    if (u.search === window.location.search) return;
    try { window.history[push ? 'pushState' : 'replaceState']({ blkFilters: 1 }, '', u.pathname + u.search + u.hash); } catch (err) { /* file:// */ }
  };
  const commit = () => {
    if (server) { if (!open) navigate(); else syncUi(); return; }
    apply();
    if (!open) syncUrl(true);
  };

  // FLT-04: السالب بيتشال، والحروف بتتشال، ولو الأدنى أكبر من الأقصى بيتبدّلوا برسالة واضحة
  const readPrice = () => {
    const clean = v => { const t = latin(v); if (t === '') return ''; const n = Number(t); return Number.isFinite(n) && n >= 0 ? String(n) : ''; };
    state.min = clean(minEl ? minEl.value : '');
    state.max = clean(maxEl ? maxEl.value : '');
    let msg = '';
    if (state.min !== '' && state.max !== '' && Number(state.min) > Number(state.max)) {
      [state.min, state.max] = [state.max, state.min];
      msg = cfg.priceSwapped || blkT('priceSwapped');
    }
    if (note) { note.textContent = msg; note.hidden = !msg; }
    if (minEl) minEl.value = state.min;
    if (maxEl) maxEl.value = state.max;
  };

  const clearAll = () => {
    keys.forEach(k => { state.sel[k] = []; });
    state.stock = false;
    state.min = '';
    state.max = '';
    if (note) { note.hidden = true; note.textContent = ''; }
    paintControls();
    if (server) { open = false; closePanel(true); navigate(); return; }
    apply();
    syncUrl(true);
  };

  const openPanel = () => {
    snap = JSON.stringify(state);
    open = true;
    panel.classList.add('is-open');
    if (scrim) scrim.hidden = false;
    document.documentElement.classList.add('blk-no-scroll');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    const first = panel.querySelector('.blk-filter-close');
    if (first) setTimeout(() => first.focus(), 30);
  };
  function closePanel(silent) {
    open = false;
    panel.classList.remove('is-open');
    if (scrim) scrim.hidden = true;
    document.documentElement.classList.remove('blk-no-scroll');
    if (openBtn) { openBtn.setAttribute('aria-expanded', 'false'); if (!silent) openBtn.focus(); }
  }
  const cancel = () => {
    if (snap) {
      const prev = JSON.parse(snap);
      state.sel = prev.sel; state.stock = prev.stock; state.min = prev.min; state.max = prev.max;
      paintControls();
      if (!server) apply();
    }
    snap = null;
    if (note) { note.hidden = true; note.textContent = ''; }
    closePanel();
    syncUi();
  };
  const applyDrawer = () => {
    readPrice();
    snap = null;
    closePanel();
    if (server) navigate();
    else { apply(); syncUrl(true); }
  };

  root.addEventListener('change', (e) => {
    const input = e.target;
    if (!panel.contains(input)) return;
    if (input.matches('[data-facet-input]')) {
      const k = input.getAttribute('data-facet-input');
      const cur = state.sel[k] || [];
      state.sel[k] = input.checked ? cur.concat(input.value) : cur.filter(v => v !== input.value);
      commit();
    } else if (input.matches('[data-filter-stock]')) {
      state.stock = input.checked;
      commit();
    } else if (input.matches('[data-price-min], [data-price-max]')) {
      readPrice();
      commit();
    }
  });
  // Enter في خانة السعر = تطبيق
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-price-min], [data-price-max]')) { e.preventDefault(); e.target.blur(); readPrice(); commit(); }
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-filter-open]')) { openPanel(); return; }
    if (e.target.closest('[data-filter-apply]')) { applyDrawer(); return; }
    if (e.target.closest('[data-filter-cancel]') || e.target.closest('[data-filter-scrim]')) { cancel(); return; }
    if (e.target.closest('[data-filter-clear]')) { clearAll(); return; }
    const chip = e.target.closest('[data-chip-key]');
    if (chip) {
      const k = chip.getAttribute('data-chip-key');
      const v = chip.getAttribute('data-chip-value');
      if (k === '__stock') state.stock = false;
      else if (k === '__price') { state.min = ''; state.max = ''; }
      else state.sel[k] = (state.sel[k] || []).filter(x => x !== v);
      paintControls();
      commit();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) cancel(); });
  // الشاشة اتكبرت لحجم الكمبيوتر والدرج مفتوح: الفلاتر بقت جنب النتايج
  window.addEventListener('resize', blkDebounce(() => { if (open && !isDrawer()) { snap = null; closePanel(true); if (server) navigate(); } }, 200));
  // FLT-07: زرار الرجوع بيرجّع الحالة اللي قبلها (client)
  window.addEventListener('popstate', () => {
    if (server) return;
    const p = new URLSearchParams(window.location.search);
    keys.forEach(k => { state.sel[k] = p.getAll(`filters[${k}][]`); });
    state.stock = false; // فلتر «المتوفر فقط» اتشال: القوايم مابتبعتش مخزون المقاسات، فالفلتر كان بيكذب
    state.min = latin(p.get('filters[price][min]') || '');
    state.max = latin(p.get('filters[price][max]') || '');
    paintControls();
    apply();
  });
  // المنتجات اتجابت بالـ JS (صفحة من غير بيانات المنصة): الوسوم بتتبني من جديد
  root.addEventListener('blk:plp-rendered', () => { scan(); paintControls(); apply(); });

  scan();
  paintControls();
  apply();
}



/* ==========================================================
   4.6 نموذج التواصل (CNT-06): تحقق برسالة تحت كل حقل، والتركيز بيروح لأول حقل غلط
   ========================================================== */
blkRegister('[data-blk-contact]', (form) => {
  const rules = {
    name: v => v.trim().length >= 2,
    email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
    message: v => v.trim().length >= 10
  };
  const check = (input) => {
    const ok = (rules[input.getAttribute('data-contact-field')] || (() => true))(input.value || '');
    const err = input.parentElement.querySelector('.blk-field-error');
    if (err) err.hidden = ok;
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  };
  form.querySelectorAll('[data-contact-field]').forEach(input => {
    input.addEventListener('blur', () => { if (input.value) check(input); });
    input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') check(input); });
  });
  form.addEventListener('submit', (e) => {
    const bad = Array.from(form.querySelectorAll('[data-contact-field]')).filter(i => !check(i));
    if (bad.length) {
      e.preventDefault();
      bad[0].focus();
      return;
    }
    // مفيش رسالة نجاح هنا: إحنا مش عارفين النتيجة (البريد بيتبعت من برنامج العميل، والرابط بيأكد في تبويب جديد)
  });
});



/* ==========================================================
   5. ARTICLES (تاريخ عربي + مشاركة)
   ========================================================== */

blkRegister('[data-blk-date]', (el) => {
  const date = new Date(el.getAttribute('datetime'));
  if (!Number.isNaN(date.getTime())) {
    el.textContent = date.toLocaleDateString(blkDateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
  }
});

// /blogs: المنصة بتبعت التصنيفات بس، فبنجيب كروت كل تصنيف من صفحته ونعرضها كلها بالأحدث.
// طلب ورا طلب (429 مع الطلبات الكتير). أي تصنيف فشل بيتساب، ولينكات الفلتر بتفضل شغالة
blkRegister('[data-blog-merge]', async (grid) => {
  const section = grid.closest('.blk-blog');
  const nav = section.querySelector('.blk-blog-cats');
  const links = nav ? Array.from(nav.querySelectorAll('[data-blog-cat]')) : [];
  const loading = section.querySelector('[data-blog-loading]');
  const empty = section.querySelector('[data-blog-empty]');
  const found = new Map();
  for (const link of links.slice(0, 12)) {
    try {
      const res = await blkFetchRetry(link.getAttribute('href'), { headers: { Accept: 'text/html' } });
      if (!res.ok) continue;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      doc.querySelectorAll('.blk-blog-card').forEach((card) => {
        const a = card.querySelector('a[href]');
        if (a && !found.has(a.getAttribute('href'))) found.set(a.getAttribute('href'), card);
      });
    } catch (err) {
      console.warn('[blog] loading category failed:', err);
    }
  }
  const dateOf = (card) => {
    const t = card.querySelector('time[datetime]');
    return (t && Date.parse(t.getAttribute('datetime'))) || 0;
  };
  const cards = Array.from(found.values()).sort((a, b) => dateOf(b) - dateOf(a));
  if (loading) loading.hidden = true;
  if (!cards.length) {
    grid.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  cards.forEach((card, i) => {
    card.classList.toggle('is-featured', i === 0 && !grid.hasAttribute('data-no-feature'));
    grid.appendChild(document.importNode(card, true));
  });
  if (nav && links.length < 2) nav.hidden = true;
});

// السنة في الفوتر: اللي التاجر كتبها، وإلا السنة الحالية (فلتر date في المنصة مابيفهمش "now")
blkRegister('[data-blk-year]', (el) => {
  if (!el.textContent.trim()) el.textContent = new Date().getFullYear();
});

// «اكتشف العروض» بيودّي لبانر العروض (#offers): لو البانر مش في الصفحة مايبقاش لينك ميت
blkRegister('a[href="#offers"]', (a) => {
  if (!document.getElementById('offers')) a.hidden = true;
});

blkRegister('.blk-article-share', (root) => {
  const url = encodeURIComponent(window.location.href);
  const title = encodeURIComponent(document.title);

  root.querySelectorAll('[data-share]').forEach(btn => {
    const type = btn.getAttribute('data-share');
    if (type === 'facebook') btn.href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    if (type === 'whatsapp') btn.href = `https://wa.me/?text=${title}%20${url}`;
    if (type === 'copy') {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          showQmraToast(blkT('articleLinkCopied'));
        } catch (err) {
          showQmraToast(blkT('copyFailed'));
        }
      });
    }
  });
});



/* ==========================================================
   6. صفحة 404 (widgets/not-found)
   ========================================================== */

blkRegister('[data-blk-404]', (root) => {
  // زرار الرجوع: لو الصفحة اللي قبلها من المتجر نفسه نرجع لها،
  // ولو العميل جاي من بره (جوجل أو لينك قديم) اللينك بيوديه الرئيسية بدل ما يخرّجه من المتجر
  const back = root.querySelector('[data-404-back]');
  if (back) {
    back.addEventListener('click', (e) => {
      let fromStore = false;
      try { fromStore = !!document.referrer && new URL(document.referrer).origin === window.location.origin; } catch (err) { /* referrer مش لينك */ }
      if (fromStore && window.history.length > 1) {
        e.preventDefault();
        window.history.back();
      }
    });
  }

  // المنتجات المقترحة بتظهر بس لما منتجات المتجر توصل (ولو المتجر فاضي بتفضل مخفية)
  const products = root.querySelector('[data-404-products]');
  if (products) {
    const holder = products.querySelector('[data-blk-store-products]');
    if (holder && holder.children.length) products.hidden = false;
    products.addEventListener('blk:products-loaded', () => { products.hidden = false; });
  }
});

// لو الصفحة خلصت تحميل قبل الملف ده
blkInitAll();
