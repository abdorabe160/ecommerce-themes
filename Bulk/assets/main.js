/* ==========================================================
   STORE AJAX MANAGERS (docs/store-ajax)
   لو المنصة أو ملف تاني عرّفهم قبل كده بنستخدم الموجود
   ========================================================== */

// سيرفر قمرة بيربط السلة بكوكي الزائر qdid. بيتعمل لما المتجر يتفتح كصفحة عادية،
// بس جوه المحرر (iframe على دومين تاني) أو مع حماية المتصفح ممكن مايوصلش
const BLK_VISITOR_COOKIE = 'qdid';

function blkHasVisitorCookie() {
  return new RegExp(`(?:^|;\\s*)${BLK_VISITOR_COOKIE}=`).test(document.cookie);
}

// بيعمل كوكي زائر لو مش موجود. بيرجع true لو عمله دلوقتي
function blkEnsureVisitorCookie() {
  if (blkHasVisitorCookie()) return false;
  const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const age = 60 * 60 * 24 * 365;
  // جوه iframe المحرر الكوكي لازم يبقى SameSite=None + Partitioned، وبره Lax كفاية
  if (window.location.protocol === 'https:') {
    document.cookie = `${BLK_VISITOR_COOKIE}=${id}; path=/; max-age=${age}; SameSite=None; Secure; Partitioned`;
  }
  if (!blkHasVisitorCookie()) {
    document.cookie = `${BLK_VISITOR_COOKIE}=${id}; path=/; max-age=${age}; SameSite=Lax`;
  }
  return blkHasVisitorCookie();
}

// طلبات القراءة (GET) بس: لو السيرفر أو البروكسي رجّع خطأ مؤقت (502/503/504/429) أو النت قطع لحظة،
// بنعيد الطلب مرتين بعد 0.4 ثانية و 1.2 ثانية بدل ما الصفحة تفضل بالمنتجات التجريبية.
// مابنستخدمهاش مع POST (الإضافة للسلة) عشان المنتج مايتضافش مرتين
const BLK_RETRY_STATUSES = [429, 502, 503, 504];

async function blkFetchRetry(url, options, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!BLK_RETRY_STATUSES.includes(res.status) || attempt >= retries) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise(resolve => setTimeout(resolve, 400 * Math.pow(3, attempt)));
  }
}

async function blkPost(url, body, retried) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  // رد فاضي أو null مايوقّعش الصفحة
  const data = (await res.json().catch(() => null)) || {};
  if (!res.ok || data.success === false) {
    const message = data.message || data.error || (Array.isArray(data.errors) && data.errors[0] && (data.errors[0].message || data.errors[0]));
    const text = typeof message === 'string' && message ? message : `Request failed: ${res.status}`;

    if (/qdid|cookie/i.test(text)) {
      // مرة واحدة: نعمل كوكي زائر ونعيد الطلب
      if (!retried && blkEnsureVisitorCookie()) return blkPost(url, body, true);
      console.warn('[cart] visitor cookie (qdid) is not reaching the server. Open the store directly (not inside the theme editor) or allow cookies for it.');
      const cookieErr = new Error(blkT('cookiesBlocked'));
      cookieErr.blkCookies = true;
      throw cookieErr;
    }
    throw new Error(text);
  }
  return data;
}

// تنسيق السعر في الـ JS مستنتج من فلتر | money على السيرفر لرقم معروف (123456) في #blkMoneySample (layouts/layout.njk)،
// فبيطلع زي ui/blk-price.njk بالظبط: الرمز ومكانه وعدد الخانات والفواصل ووحدة السعر (جنيه ولا قرش). مفيش رمز عملة مكتوب هنا.
// لو العينة مش موجودة أو غريبة: الأسعار بالجنيه + خانتين + فاصلة الآلاف + رمز المتجر بعد الرقم (1,290.00 ج.م) زي الأول
const BLK_MONEY = (function () {
  const fmt = { divisor: 1, decimals: 2, group: ',', point: '.', template: '' };
  let sample = '';
  try {
    const el = document.getElementById('blkMoneySample');
    sample = el ? String(JSON.parse(el.textContent) || '') : '';
  } catch (e) {
    sample = '';
  }
  // الأرقام العربي/الفارسي بتتحول إنجليزي عشان نقدر نحسب (وبترجع عربي في blkMoney لو العينة عربي)
  const arabicDigits = /[٠-٩]/.test(sample);
  sample = sample.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const match = sample.match(/\d(?:[\d.,'\s٫٬]*\d)?/);
  if (!match) return fmt;

  const raw = match[0];
  let sep = -1;
  for (let i = raw.length - 1; i >= 0; i--) if (!/\d/.test(raw[i])) { sep = i; break; }
  const tail = sep > -1 ? raw.length - sep - 1 : 0;
  const decimals = sep > -1 && tail <= 2 ? tail : 0;
  const intPart = decimals ? raw.slice(0, sep) : raw;
  const groupMatch = intPart.match(/\D/);
  const value = parseInt(raw.replace(/\D/g, ''), 10);
  const divisor = value > 0 ? (123456 * Math.pow(10, decimals)) / value : 0;
  // وحدة السعر لازم تطلع 1 أو 10 أو 100 أو 1000، غير كده العينة مش مفهومة فبنفضل على التنسيق القديم
  if ([1, 10, 100, 1000].indexOf(divisor) === -1) return fmt;

  return {
    divisor,
    decimals,
    arabicDigits,
    group: groupMatch ? groupMatch[0] : '',
    point: decimals ? raw[sep] : '.',
    template: sample.slice(0, match.index) + '{amount}' + sample.slice(match.index + raw.length)
  };
})();

// وحدة أسعار المنصة (1 = جنيه، 100 = قرش): فلتر السعر في البحث وبيانات المنتجات التجريبية بيستخدموها
const BLK_PRICE_SCALE = BLK_MONEY.divisor;

// سعر بالجنيه (450) ← بنفس وحدة أسعار المتجر (للمنتجات التجريبية بس)
function blkFromMajor(value) {
  return Math.round((Number(value) || 0) * BLK_PRICE_SCALE * 100) / 100;
}

function blkMoney(amount) {
  const value = (Number(amount) || 0) / BLK_MONEY.divisor;
  const pow = Math.pow(10, BLK_MONEY.decimals);
  const units = Math.round(Math.abs(value) * pow);
  const whole = String(Math.floor(units / pow)).replace(/\B(?=(\d{3})+(?!\d))/g, BLK_MONEY.group);
  const frac = BLK_MONEY.decimals ? BLK_MONEY.point + String(units % pow).padStart(BLK_MONEY.decimals, '0') : '';
  const num = `${value < 0 && units > 0 ? '-' : ''}${whole}${frac}`;
  if (BLK_MONEY.template) {
    const text = BLK_MONEY.template.split('{amount}').join(num);
    return BLK_MONEY.arabicDigits ? text.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]) : text;
  }
  // من غير عينة: الرمز من إعدادات المتجر (body[data-currency-symbol])
  const symbol = (document.body && document.body.getAttribute('data-currency-symbol')) || '';
  return `${num}${symbol ? ` ${symbol}` : ''}`;
}

// صورة بديلة لمنتج من غير صورة — SVG داخلي بدل خدمة خارجية (مفيش طلب شبكة ولا 404)
const BLK_NO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 700'%3E%3Crect width='600' height='700' fill='%23141414'/%3E%3Cg fill='none' stroke='%23555' stroke-width='10' transform='translate(240 290)'%3E%3Crect x='0' y='0' width='120' height='120' rx='12'/%3E%3Ccircle cx='40' cy='40' r='12'/%3E%3Cpath d='m120 80-40-40-80 80'/%3E%3C/g%3E%3C/svg%3E";

// سعر منتج = 0 ← «مجاني» (PRD-19)؛ الإجماليات بتستخدم blkMoney عادي
function blkPrice(amount) {
  return Math.round((Number(amount) || 0) * 100) === 0 ? blkT('free') : blkMoney(amount);
}

// نصوص الـ JS بتيجي من locales/*.json (عربي/إنجليزي/فرنساوي) عن طريق #blkI18n في layouts/layout.njk.
// دي احتياطي بس لو #blkI18n مش موجود أو المفتاح ناقص (الفرنساوي بياخد الإنجليزي). listSep هنا بس لأنه علامة ترقيم بمسافة.
// اللغة من <html lang> (المنصة بتحطها حسب كوكي lang أو /en في اللينك)
const BLK_STRINGS = {
  ar: {
    addToCart: 'أضف إلى السلة',
    chooseOptions: 'اختر الخيارات',
    buyNow: 'اشترِ الآن',
    outOfStock: 'نفد من المخزون',
    free: 'مجاني',
    inStock: 'متوفر',
    lowStock: 'أوشك على النفاد',
    chooseOption: 'اختر :name',
    chooseOptionError: 'اختر :name قبل الإضافة إلى السلة',
    adding: 'جاري الإضافة...',
    added: 'تمت الإضافة',
    addedToast: 'تمت إضافة المنتج إلى السلة',
    addFailed: 'تعذّرت الإضافة إلى السلة، حاول مرة أخرى',
    variantUnavailable: 'الاختيار ده غير متاح، جرّب اختيار تاني',
    maxQty: 'المتاح :count قطع فقط',
    allInCart: 'كل الكمية المتاحة (:count) موجودة في سلتك بالفعل',
    addedPartial: 'اتضاف :count بس، ده كل المتاح',
    qtyAdjusted: 'المتاح :count بس، فعدّلنا الكمية',
    removeUnavailable: 'شيل المنتجات اللي نفدت من السلة الأول',
    clearFilters: 'مسح الفلاتر',
    noResults: 'لا توجد منتجات مطابقة',
    allResults: 'كل النتائج',
    priceSwapped: 'الحد الأدنى كان أكبر من الأقصى، فبدّلناهم',
    cookiesBlocked: 'المتصفح مانع كوكيز المتجر. جرّب من المتجر مباشرة (زرار معاينة) أو اسمح بالكوكيز',
    demoOnly: 'ده منتج تجريبي للمعاينة بس',
    demoNote: 'منتج تجريبي للمعاينة',
    demoDescription: 'ده منتج تجريبي للمعاينة: ضيف منتجاتك من لوحة التحكم وهتظهر مكانه.',
    needsOptionsRedirect: 'المنتج ده محتاج تختار مقاس أو لون، هنوديك لصفحته',
    newArrivals: 'وصل حديثاً',
    reviewsWord: 'تقييم',
    noReviews: 'لسه مفيش تقييمات',
    noReviewsLong: 'لسه مفيش تقييمات للمنتج ده. اشتريه وكن أول واحد يقيّمه!',
    basedOn: 'بناءً على',
    tabDesc: 'الوصف',
    tabSpecs: 'المواصفات',
    tabReviews: 'التقييمات',
    customer: 'عميل',
    save: 'وفّر',
    image: 'صورة',
    images: 'صور المنتج',
    prevImage: 'الصورة السابقة',
    nextImage: 'الصورة التالية',
    fullscreen: 'عرض الصورة بملء الشاشة',
    sizeGuide: 'دليل المقاسات',
    size: 'المقاس',
    noDescription: 'مفيش وصف للمنتج ده لسه.',
    category: 'القسم',
    tags: 'الوسوم',
    status: 'الحالة',
    sku: 'SKU',
    listSep: '، ',
    wait: 'لحظة...',
    quantity: 'الكمية',
    qtyIncrease: 'زيادة الكمية',
    qtyDecrease: 'تقليل الكمية',
    deliveryBetween: 'هيوصلك ما بين',
    deliveryAnd: 'و',
    trustShipping: 'شحن سريع لكل المحافظات',
    trustReturns: 'استبدال واسترجاع خلال 14 يوم',
    trustSecure: 'دفع آمن ومضمون',
    share: 'شارك المنتج:',
    shareWhatsapp: 'مشاركة على واتساب',
    shareFacebook: 'مشاركة على فيسبوك',
    copyLink: 'نسخ رابط المنتج',
    linkCopied: 'اتنسخ رابط المنتج',
    copyFailed: 'مقدرناش ننسخ الرابط',
    articleLinkCopied: 'اتنسخ الرابط',
    productDetails: 'تفاصيل المنتج',
    related: 'منتجات قد تعجبك',
    breadcrumb: 'مسار التنقل',
    home: 'الرئيسية',
    close: 'إغلاق',
    back: 'رجوع',
    productNotFound: 'المنتج ده مش موجود',
    freeShippingReached: '🎉 مبروك! طلبك عليه شحن مجاني',
    freeLeftPrefix: 'فاضلك',
    freeLeftSuffix: 'وتاخد شحن مجاني',
    cartError: 'حصلت مشكلة، حاول مرة تانية',
    hot: 'الأكثر طلباً',
    preview: 'معاينة',
    quickView: 'معاينة سريعة',
    outOf5: 'من 5',
    productsWord: 'منتج',
    filterName_brand: 'الماركة',
    filterName_material: 'الخامة',
    filterName_color: 'اللون',
    filterName_size: 'المقاس',
    filterName_feature: 'المميزات',
    countOne: 'منتج واحد',
    countTwo: 'منتجان',
    countFew: 'منتجات',
    countMany: 'منتج',
    viewProduct: 'عرض المنتج',
    exclusive: 'تشكيلة حصرية',
    shopNow: 'تسوق الآن',
    searchPrompt: 'اكتب اللي بتدور عليه',
    resultsFor: 'نتيجة لـ',
    searchError: 'حصلت مشكلة في البحث، حاول مرة تانية',
    loadFailed: 'مقدرناش نحمّل المنتجات، حاول تاني',
    demoBadge: 'تجريبي',
    demoCartNote: 'المنتجات اللي عليها علامة تجريبي للمعاينة بس: بتظهر في السلة لكن مش بتدخل في الطلب.',
    demoCheckoutBlocked: 'المنتجات التجريبية للمعاينة بس ومش بتتطلب. ضيف منتجاتك الحقيقية من لوحة التحكم.',
    demoLine: 'منتجات تجريبية (مش داخلة في الطلب)',
    remove: 'حذف',
    lowStockCount: 'أوشك على النفاد — متبقٍ :count فقط',
    wishlistAdd: 'أضف للمفضلة',
    wishlistRemove: 'إزالة من المفضلة',
    wishlistAdded: 'اتضاف للمفضلة',
    wishlistRemoved: 'اتشال من المفضلة',
    wishlistError: 'مقدرناش نحدّث المفضلة، حاول تاني',
    clearAll: 'مسح الكل',
    priceLabel: 'السعر',
    removeFilter: 'إزالة الفلتر',
    showingOf: 'عرض :shown من :total منتج',
    currencySwitch: 'تغيير العملة إلى :code'
  },
  en: {
    addToCart: 'Add to cart',
    chooseOptions: 'Choose options',
    buyNow: 'Buy now',
    outOfStock: 'Out of stock',
    free: 'Free',
    inStock: 'In stock',
    lowStock: 'Almost sold out',
    chooseOption: 'Choose :name',
    chooseOptionError: 'Please choose :name before adding to cart',
    adding: 'Adding...',
    added: 'Added',
    addedToast: 'Added to your cart',
    addFailed: "Couldn't add to cart, please try again",
    variantUnavailable: "This option isn't available, try another one",
    maxQty: 'Only :count available',
    allInCart: 'All :count available are already in your cart',
    addedPartial: "Only :count added — that's all that's available",
    qtyAdjusted: 'Only :count available, so we updated the quantity',
    removeUnavailable: 'Remove sold-out items from your cart first',
    clearFilters: 'Clear filters',
    noResults: 'No matching products',
    allResults: 'All results',
    priceSwapped: 'Minimum was higher than maximum, so we swapped them',
    cookiesBlocked: 'Your browser is blocking the store cookies. Open the store directly (Preview button) or allow cookies',
    demoOnly: 'This is a demo product for preview only',
    demoNote: 'Demo product for preview',
    demoDescription: 'This is a demo product for preview — add your products from the dashboard and they will appear here.',
    needsOptionsRedirect: 'This product needs a size or color — taking you to its page',
    newArrivals: 'New arrivals',
    reviewsWord: 'reviews',
    noReviews: 'No reviews yet',
    noReviewsLong: 'No reviews yet. Be the first to review this product!',
    basedOn: 'Based on',
    tabDesc: 'Description',
    tabSpecs: 'Specifications',
    tabReviews: 'Reviews',
    customer: 'Customer',
    save: 'Save',
    image: 'Image',
    images: 'Product images',
    prevImage: 'Previous image',
    nextImage: 'Next image',
    fullscreen: 'View full screen',
    sizeGuide: 'Size guide',
    size: 'Size',
    noDescription: 'No description for this product yet.',
    category: 'Category',
    tags: 'Tags',
    status: 'Status',
    sku: 'SKU',
    listSep: ', ',
    wait: 'One moment...',
    quantity: 'Quantity',
    qtyIncrease: 'Increase quantity',
    qtyDecrease: 'Decrease quantity',
    deliveryBetween: 'Arrives between',
    deliveryAnd: 'and',
    trustShipping: 'Fast nationwide shipping',
    trustReturns: 'Exchanges and returns within 14 days',
    trustSecure: 'Safe and secure payment',
    share: 'Share:',
    shareWhatsapp: 'Share on WhatsApp',
    shareFacebook: 'Share on Facebook',
    copyLink: 'Copy product link',
    linkCopied: 'Product link copied',
    copyFailed: "Couldn't copy the link",
    articleLinkCopied: 'Link copied',
    productDetails: 'Product details',
    related: 'You may also like',
    breadcrumb: 'Breadcrumb',
    home: 'Home',
    close: 'Close',
    back: 'Back',
    productNotFound: 'This product does not exist',
    freeShippingReached: '🎉 Nice! Your order ships free',
    freeLeftPrefix: 'Add',
    freeLeftSuffix: 'more to get free shipping',
    cartError: 'Something went wrong, please try again',
    hot: 'Best seller',
    preview: 'View',
    quickView: 'Quick view',
    outOf5: 'out of 5',
    productsWord: 'products',
    filterName_brand: 'Brand',
    filterName_material: 'Material',
    filterName_color: 'Color',
    filterName_size: 'Size',
    filterName_feature: 'Features',
    countOne: '1 product',
    countTwo: '2 products',
    countFew: 'products',
    countMany: 'products',
    viewProduct: 'View product',
    exclusive: 'Exclusive range',
    shopNow: 'Shop now',
    searchPrompt: "Type what you're looking for",
    resultsFor: 'results for',
    searchError: 'Search failed, please try again',
    loadFailed: "Couldn't load products, please try again",
    demoBadge: 'Demo',
    demoCartNote: "Items marked Demo are for preview only: they show in the cart but aren't part of the order.",
    demoCheckoutBlocked: "Demo products are for preview only and can't be ordered. Add your real products from the dashboard.",
    demoLine: 'Demo items (not in the order)',
    remove: 'Remove',
    lowStockCount: 'Almost sold out — only :count left',
    wishlistAdd: 'Add to wishlist',
    wishlistRemove: 'Remove from wishlist',
    wishlistAdded: 'Added to your wishlist',
    wishlistRemoved: 'Removed from your wishlist',
    wishlistError: "Couldn't update your wishlist, please try again",
    clearAll: 'Clear all',
    priceLabel: 'Price',
    removeFilter: 'Remove filter',
    showingOf: 'Showing :shown of :total products',
    currencySwitch: 'Switch currency to :code'
  }
};

// لغة الصفحة: ar أو fr، وأي لغة تانية بتاخد en
function blkLang() {
  const lang = String(document.documentElement.lang || 'ar').slice(0, 2).toLowerCase();
  return lang === 'ar' || lang === 'fr' ? lang : 'en';
}

// لغة تنسيق التواريخ حسب لغة الصفحة
function blkDateLocale() {
  return { ar: 'ar-EG', fr: 'fr-FR' }[blkLang()] || 'en-US';
}

function blkT(key, params) {
  const el = document.getElementById('blkI18n');
  let text = el && el.dataset[key];
  // المفتاح مش موجود في ملف اللغة: المنصة ممكن ترجّع اسم المفتاح نفسه
  if (!text || /^[a-z_]+\.[a-z0-9_.]+$/.test(text)) text = (BLK_STRINGS[blkLang()] || BLK_STRINGS.en)[key] || BLK_STRINGS.en[key] || BLK_STRINGS.ar[key] || '';
  if (params) Object.keys(params).forEach(k => { text = text.split(`:${k}`).join(params[k]); });
  return text;
}

/* ==========================================================
   تبديل اللغة (زرار [data-blk-lang] في الهيدر)
   المنصة بتعرض الصفحة باللغة اللي في كوكي lang، فبنحطه ونعيد التحميل.
   /en في أول اللينك بيشتغل للصفحة دي بس، فبنشيله والكوكي هي اللي تحدد اللغة في كل الصفحات
   ========================================================== */
function blkSetLangCookie(lang) {
  document.cookie = `lang=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-blk-lang]');
  if (!btn) return;
  e.preventDefault();
  const lang = btn.getAttribute('data-blk-lang');
  if (!/^[a-z]{2}$/.test(lang)) return;
  blkSetLangCookie(lang);
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/^\/(ar|en|fr)(?=\/|$)/, '') || '/';
  window.location.assign(url.toString());
});

// الصفحة اتفتحت بـ /en/... : نثبّت اللغة في الكوكي عشان باقي لينكات المتجر تفضل بنفس اللغة
(function blkSyncLangFromUrl() {
  const m = window.location.pathname.match(/^\/(ar|en|fr)(?=\/|$)/);
  if (!m) return;
  const current = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/);
  if (!current || current[1] !== m[1]) blkSetLangCookie(m[1]);
})();

// إعدادات الثيم من layouts/layout.njk (window.__blk): حد «أوشك على النفاد»، احترام المخزون، فتح السلة بعد الإضافة...
const BLK_CFG = window.__blk || {};

// حالة المخزون: نفس القاعدة في ui/blk-product-card.njk و widgets/product-detail
// 0 أو أقل = نفد · من 1 لحد «رسالة أوشك على النفاد عند» (الافتراضي 3) = أوشك على النفاد · أكتر = متوفر · مش متتبَّع (null) = متوفر
// «احترام مخزون المنتجات» مقفول: كل المنتجات متوفرة
const BLK_LOW_STOCK = Math.max(1, parseInt(BLK_CFG.lowStock, 10) || 3);
const BLK_FOLLOW_STOCK = BLK_CFG.followStock !== false;

function blkStockState(qty) {
  if (!BLK_FOLLOW_STOCK) return 'in';
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return 'in';
  if (qty <= 0) return 'out';
  if (qty <= BLK_LOW_STOCK) return 'low';
  return 'in';
}

// نص الحالة: «أوشك على النفاد — متبقٍ N فقط» بالعدد (PRD-23 / PRD-24)
function blkStockText(state, qty) {
  if (state === 'out') return blkT('outOfStock');
  if (state === 'low') return typeof qty === 'number' && qty > 0 ? blkT('lowStockCount', { count: qty }) : blkT('lowStock');
  return blkT('inStock');
}

// الوسوم على المنصة ممكن تيجي نصوص أو objects ({ name / title … })؛ دايماً بناخد الاسم كنص عشان مايطلعش [object Object]
function blkTagName(t) {
  if (typeof t === 'string') return t;
  if (!t || typeof t !== 'object') return '';
  const v = t.name || t.title || t.label || t.value || t.handle || '';
  return typeof v === 'string' ? v : '';
}

// معاينة البيلدر أو التاجر مفعّل «منتجات تجريبية»: الـ class بيتحط في <head> قبل الرسم (layouts/layout.njk)
function blkDemoAllowed() {
  return document.documentElement.classList.contains('blk-demo-ok');
}

// كمية المنتج الفعلية: مجموع نسخه (variants) المتتبَّعة، ولو كلها خلصت يبقى نفد حتى لو كمية الأب مش صفر.
// من غير بيانات نسخ: كمية المنتج
function blkProductQty(p) {
  if (!p) return null;
  const variants = Array.isArray(p.variants) ? p.variants.filter(v => v && typeof v.quantity === 'number') : [];
  const own = typeof p.quantity === 'number' ? p.quantity : null;
  // بيانات النسخ لو موجودة هي الأصدق: كمية الأب بتيجي 0 في منتجات بمقاسات متاحة
  if (variants.length) return variants.reduce((sum, v) => sum + Math.max(0, v.quantity), 0);
  return own;
}

// مخزون مش معروف: كمية 0 من غير أي بيانات خيارات (القوايم مابتبعتش variants). المنتج البسيط المعروف (variants فاضية) بيفضل «نفد»
function blkStockUnknown(p) {
  if (!p || !BLK_FOLLOW_STOCK || typeof p.quantity !== 'number' || p.quantity > 0) return false;
  const count = Number(p.variantsCount);
  if (p.variantsCount === 0) return false;
  if (Array.isArray(p.variants) && p.variants.some(v => v && typeof v.quantity === 'number')) return false;
  return !(Array.isArray(p.variants) && p.variants.length === 0 && !(count > 0));
}

// عدّ المنتجات: منتج واحد، منتجان، 3 منتجات، 11 منتج (نفس ui/blk-count.njk)
function blkCountHtml(n) {
  const num = Number(n) || 0;
  if (num === 1) return `<strong data-plp-count>${blkEscape(blkT('countOne'))}</strong>`;
  if (num === 2) return `<strong data-plp-count>${blkEscape(blkT('countTwo'))}</strong>`;
  const rest = num % 100;
  return `<strong data-plp-count>${num}</strong> ${blkEscape(rest >= 3 && rest <= 10 ? blkT('countFew') : blkT('countMany'))}`;
}

/* ==========================================================
   حد المخزون عند الإضافة للسلة
   مفيش إضافة أكتر من المتاح: المتاح = المخزون - اللي في السلة بالفعل.
   كل الإضافات (الكارت، صفحة المنتج، اشترِ الآن، الشريط الثابت) بتعدّي من blkAddWithinStock
   ========================================================== */

// كام قطعة من المنتج (أو النسخة) في السلة دلوقتي.
// بنجيب السلة من السيرفر وقت الإضافة عشان الرقم يبقى مظبوط حتى لو السلة اتعدّلت من تابة تانية
async function blkQtyInCart(productId, variantId) {
  let cart = null;
  try { cart = blkNormalizeCart(await blkFetchCart()); } catch (err) { /* هنستخدم آخر نسخة عندنا */ }
  cart = cart || blkCartSnapshot;
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items
    .filter(item => item && String(item.productId) === String(productId)
      // نسخة معيّنة: سطورها بس (وأي سطر مالوش نسخة احتياطي). من غير نسخة: كل سطور المنتج
      && (!variantId || !item.variantId || String(item.variantId) === String(variantId)))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

// بيضيف لحد المتاح بس. stock = null يعني المخزون مش متتبَّع (من غير حد).
// بيرجّع { added, cart, partial, reason: 'out' | 'all-in-cart' | undefined, stock, inCart }
async function blkAddWithinStock(productId, qty, variantId, stock) {
  const wanted = Math.max(1, parseInt(qty, 10) || 1);
  const limited = BLK_FOLLOW_STOCK && typeof stock === 'number' && Number.isFinite(stock);
  let inCart = 0;
  let added = wanted;
  if (limited) {
    inCart = await blkQtyInCart(productId, variantId);
    added = Math.max(0, Math.min(wanted, stock - inCart));
  }
  if (added <= 0) {
    return { added: 0, cart: null, reason: stock > 0 && inCart > 0 ? 'all-in-cart' : 'out', stock, inCart };
  }
  const cart = await window.CartManager.add(productId, added, variantId || undefined);
  return { added, cart, partial: added < wanted, stock, inCart };
}

// الرسالة المناسبة لنتيجة blkAddWithinStock
function blkAddMessage(result) {
  if (result.reason === 'all-in-cart') return blkT('allInCart', { count: result.stock });
  if (result.reason === 'out') return blkT('outOfStock');
  if (result.partial) return blkT('addedPartial', { count: result.added });
  return blkT('addedToast');
}

// data-stock على الزرار/الصفحة: رقم = المخزون، فاضي = مش متتبَّع
function blkStockAttr(el, name = 'data-stock') {
  const raw = el && el.getAttribute(name);
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

window.CartManager = window.CartManager || {
  async add(productId, quantity = 1, variantId) {
    const body = { productId, quantity };
    if (variantId) body.variantId = variantId;
    return this.updateUI(await blkPost('/ajax/cart/add', body));
  },

  async update(itemId, quantity) {
    return this.updateUI(await blkPost('/ajax/cart/change', { itemId, quantity }));
  },

  async remove(itemId) {
    return this.updateUI(await blkPost('/ajax/cart/remove', { itemId }));
  },

  // زيادة/تقليل قطعة (زي docs/store-ajax/cart.md)؛ التقليل من 1 بيشيل العنصر
  async increment(itemId, currentQty) {
    return this.update(itemId, (parseInt(currentQty, 10) || 0) + 1);
  },

  async decrement(itemId, currentQty) {
    const next = (parseInt(currentQty, 10) || 0) - 1;
    return next > 0 ? this.update(itemId, next) : this.remove(itemId);
  },

  async clear() {
    return this.updateUI(await blkPost('/ajax/cart/clear'));
  },

  async refresh() {
    return this.updateUI(await blkFetchCart());
  },

  updateUI(data) {
    const cart = blkApplyCart(data);
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    return cart;
  }
};

// الرد حسب الدوكس فيه totalQuantity و totalPrice على طول، بس بنقبل كمان { cart } أو { data } احتياطي
function blkNormalizeCart(data) {
  if (!data || typeof data !== 'object') return null;
  const cart = [data, data.cart, data.data].find(c => c && typeof c.totalQuantity === 'number');
  return cart || null;
}

let blkCartSnapshot = null;

// بيحدّث عدد القطع وإجمالي السعر في الهيدر وأي مكان تاني، مع نبضة لما الرقم يتغير
function blkApplyCart(data) {
  const cart = blkNormalizeCart(data);
  if (!cart) {
    // رد مش متوقع: نجيب السلة من السيرفر بدل ما نكتب صفر غلط
    blkFetchCart()
      .then(fresh => { if (blkNormalizeCart(fresh)) blkApplyCart(fresh); })
      .catch(() => {});
    return data;
  }

  const changed = !blkCartSnapshot
    || blkCartSnapshot.totalQuantity !== cart.totalQuantity
    || blkCartSnapshot.totalPrice !== cart.totalPrice;
  blkCartSnapshot = cart;
  blkRenderCartBadges(changed);
  return cart;
}

// عدد القطع والإجمالي في الهيدر وأي مكان تاني = السلة الحقيقية بس.
// المنتجات الافتراضية (التجريبية) مابتتجمعش عليها أبداً: بتظهر بس لو السلة الحقيقية فاضية أو الـ API مش متاح
function blkRenderCartBadges(bump) {
  const real = blkCartSnapshot || { totalQuantity: 0, totalPrice: 0 };
  const realQty = Number(real.totalQuantity) || 0;
  const demo = realQty > 0 ? { qty: 0, price: 0 } : blkDemoCartTotals();
  const qty = realQty > 0 ? realQty : demo.qty;
  const price = realQty > 0 ? (Number(real.totalPrice) || 0) : demo.price;
  document.querySelectorAll('[data-cart-count], .blk-count').forEach(el => { el.textContent = qty; });
  document.querySelectorAll('[data-cart-total-price]').forEach(el => { el.textContent = blkMoney(price); });
  document.querySelectorAll('.blk-cart-btn').forEach(btn => {
    btn.classList.toggle('is-empty', !qty);
    if (!bump) return;
    btn.classList.remove('is-bump');
    void btn.offsetWidth; // عشان الأنيميشن يتعاد
    btn.classList.add('is-bump');
  });
}

/* ==========================================================
   سلة المنتجات الافتراضية (التجريبية)
   المنتجات الافتراضية مش موجودة في المتجر، فالمنصة مابتقبلهاش في السلة ولا في الطلب.
   بتتحفظ في المتصفح (localStorage) وبتظهر في السلة جنب المنتجات الحقيقية بعلامة "تجريبي" (برا إجمالي الطلب والدفع)،
   من غير طلب ولا دفع. الشكل: [{ id, title, price, image, url, variant, stock, qty }]
   ========================================================== */
const BLK_DEMO_CART_KEY = 'blkDemoCart';

function blkDemoCartRead() {
  try {
    const list = JSON.parse(localStorage.getItem(BLK_DEMO_CART_KEY) || '[]');
    return Array.isArray(list) ? list.filter(i => i && i.id && Number(i.qty) > 0) : [];
  } catch (err) {
    return []; // التخزين مقفول (Private mode)
  }
}

function blkDemoCartWrite(items) {
  try { localStorage.setItem(BLK_DEMO_CART_KEY, JSON.stringify(items)); } catch (err) { /* التخزين مقفول */ }
  window.dispatchEvent(new CustomEvent('blk:demo-cart', { detail: items }));
  // الهيدر محتاج رقم السلة الحقيقية كمان: لو لسه ماجبناهاش نجيبها الأول
  if (blkCartSnapshot) blkRenderCartBadges(true);
  else blkFetchCart().then(blkApplyCart).catch(() => blkRenderCartBadges(true));
}

function blkDemoCartTotals(items = blkDemoCartRead()) {
  return items.reduce((t, i) => ({ qty: t.qty + Number(i.qty), price: t.price + Number(i.qty) * (Number(i.price) || 0) }), { qty: 0, price: 0 });
}

const blkDemoLineKey = item => `${item.id}|${item.variant || ''}`;

// بيضيف لحد المخزون بس (المخزون على مستوى المنتج: كل المقاسات مع بعض). نفس شكل نتيجة blkAddWithinStock
function blkDemoCartAdd(item, qty) {
  const wanted = Math.max(1, parseInt(qty, 10) || 1);
  const items = blkDemoCartRead();
  const stock = typeof item.stock === 'number' && Number.isFinite(item.stock) ? item.stock : null;
  const inCart = items.filter(i => i.id === item.id).reduce((sum, i) => sum + Number(i.qty), 0);
  const added = stock === null ? wanted : Math.max(0, Math.min(wanted, stock - inCart));
  if (added <= 0) return { added: 0, reason: stock > 0 && inCart > 0 ? 'all-in-cart' : 'out', stock, inCart };
  const line = items.find(i => blkDemoLineKey(i) === blkDemoLineKey(item));
  if (line) line.qty = Number(line.qty) + added;
  else items.push(Object.assign({}, item, { qty: added }));
  blkDemoCartWrite(items);
  return { added, partial: added < wanted, stock, inCart, demo: true };
}

// بيغيّر كمية سطر (0 = حذف) في حدود المخزون، وبيرجّع الكمية اللي اتحطت فعلاً
function blkDemoCartSetQty(key, qty) {
  const items = blkDemoCartRead();
  const line = items.find(i => blkDemoLineKey(i) === key);
  if (!line) return 0;
  let next = Math.max(0, parseInt(qty, 10) || 0);
  if (typeof line.stock === 'number') {
    const others = items.filter(i => i.id === line.id && i !== line).reduce((sum, i) => sum + Number(i.qty), 0);
    next = Math.min(next, Math.max(0, line.stock - others));
  }
  blkDemoCartWrite(next > 0 ? items.map(i => (i === line ? Object.assign(i, { qty: next }) : i)) : items.filter(i => i !== line));
  return next;
}

// بيانات المنتج الافتراضي من الكارت (أو من الكتالوج الافتراضي في pages.js لو موجود)، و null لو مش منتج افتراضي
function blkDemoItemFromCard(card, btn) {
  const link = card.querySelector('a.blk-prod-img-link, .blk-prod-title a');
  const href = (link && link.getAttribute('href')) || '';
  let slug = '';
  try { slug = new URL(href, window.location.origin).searchParams.get('product') || ''; } catch (err) { /* لينك مش صالح */ }
  const id = card.getAttribute('data-id') || '';
  const isDemo = card.hasAttribute('data-dummy') || /^demo-/.test(slug) || /^demo-/.test(id);
  if (!isDemo) return null;
  const catalog = /^demo-/.test(slug) && typeof blkDemoProductBySlug === 'function' ? blkDemoProductBySlug(slug) : null;
  const img = card.querySelector('.blk-img-primary');
  return {
    id: catalog ? catalog._id : (slug || id),
    title: catalog ? catalog.title : ((card.querySelector('.blk-prod-title') || {}).textContent || '').trim(),
    price: catalog ? Number(catalog.pricing.price) || 0 : Number(card.getAttribute('data-price')) || 0,
    image: catalog && catalog.images[0] ? catalog.images[0].fileUrl : (img ? img.getAttribute('src') : ''),
    url: href && href !== '#' ? href : '',
    variant: '',
    stock: catalog && typeof catalog.quantity === 'number' ? catalog.quantity : blkStockAttr(btn)
  };
}

// طلب واحد بس في نفس الوقت حتى لو أكتر من حتة طلبت السلة
let blkCartRequest = null;
function blkFetchCart() {
  if (!blkCartRequest) {
    blkCartRequest = blkFetchRetry('/ajax/cart', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(res => res.json())
      .finally(() => { blkCartRequest = null; });
  }
  return blkCartRequest;
}

// فيه منتجات افتراضية في السلة من زيارة قبل كده: نحدّث رقم الهيدر (حقيقي + افتراضي)
if (blkDemoCartRead().length) blkFetchCart().then(blkApplyCart).catch(() => blkRenderCartBadges(false));
// تابة تانية غيّرت السلة الافتراضية
window.addEventListener('storage', (e) => {
  if (e.key !== BLK_DEMO_CART_KEY) return;
  blkRenderCartBadges(false);
  window.dispatchEvent(new CustomEvent('blk:demo-cart', { detail: blkDemoCartRead() }));
});

// لو العميل رجع بزرار Back المتصفح بيعرض نسخة قديمة من الصفحة، فبنحدّث السلة
window.addEventListener('pageshow', (e) => {
  if (e.persisted) blkFetchCart().then(blkApplyCart).catch(() => {});
});



/* ==========================================================
   BOOTSTRAP
   يشتغل حتى لو السكريبت اتحمّل بعد DOMContentLoaded، ومع إعادة رسم الويدجت في المحرر
   ========================================================== */

const blkInitializers = [];

// كل موديول بيسجّل selector + دالة init، وكل عنصر بيتعمله init مرة واحدة بس
// كل موديول ليه سجل لوحده (WeakSet): نفس العنصر ممكن يتسجّل له أكتر من موديول (الشبكة + الفلاتر)
function blkRegister(selector, init) {
  blkInitializers.push({ selector, init, done: new WeakSet() });
}

function blkInitAll() {
  blkInitializers.forEach(({ selector, init, done }) => {
    document.querySelectorAll(selector).forEach(el => {
      // data-blk-ready على العنصر = اتعمله init برّه (زي صفحة المنتج اللي فوق الشوب)
      if (done.has(el) || (el.hasAttribute('data-blk-ready') && !el.hasAttribute('data-blk-multi'))) return;
      done.add(el);
      el.setAttribute('data-blk-multi', '');
      el.setAttribute('data-blk-ready', '');
      try { init(el); } catch (err) { console.warn('[blk] init failed for', selector, err); }
    });
  });
}

function blkBoot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', blkInitAll);
  } else {
    blkInitAll();
  }

  new MutationObserver(mutations => {
    if (mutations.some(m => m.addedNodes.length)) blkInitAll();
  }).observe(document.documentElement, { childList: true, subtree: true });
}



/* ==========================================================
   PRODUCT CARD ACTIONS (أي .blk-prod-card في أي صفحة)
   ========================================================== */

document.addEventListener('click', (e) => {
  const card = e.target.closest('.blk-prod-card');
  const isDummy = card && card.hasAttribute('data-dummy');
  const productUrl = card && card.getAttribute('data-url');

  // لينكات /shop/<slug> و /shop?product-id= بتتنقل عادي لصفحة الشوب، وهناك صفحة المنتج بتتفتح (pages.js)

  // منتج تجريبي: اللينك # مالوش صفحة
  if (isDummy && e.target.closest('a[href="#"]')) {
    e.preventDefault();
    showQmraToast(blkT('demoOnly'));
    return;
  }

  if (!card) return;

  // Quick View: بيفتح صفحة المنتج
  if (e.target.closest('.blk-btn-quickview')) {
    e.preventDefault();
    // المنتج التجريبي: نفتح صفحته من اللينك اللي في الكارت
    // المعاينة بتروح لصفحة المنتج (لينك الكارت نفسه)
    const cardLink = card.querySelector('a.blk-prod-img-link, .blk-prod-title a');
    const href = (cardLink && cardLink.getAttribute('href')) || productUrl;
    if (href && href !== '#') window.location.href = href;
    else if (isDummy) showQmraToast(blkT('demoOnly'));
    return;
  }

  // Quick Add To Cart
  const addCartBtn = e.target.closest('.blk-btn-addcart');
  if (addCartBtn) {
    e.preventDefault();
    if (addCartBtn.disabled) return;

    // منتج افتراضي: بيتضاف لسلة المنتجات الافتراضية (مش لسلة المنصة) في حدود مخزونه
    const demoItem = blkDemoItemFromCard(card, addCartBtn);
    if (demoItem) {
      const result = blkDemoCartAdd(demoItem, 1);
      showQmraToast(blkAddMessage(result), result.added ? 'success' : 'error');
      const span = addCartBtn.querySelector('span');
      if (result.added && span) {
        const original = span.textContent;
        span.textContent = blkT('added');
        setTimeout(() => { span.textContent = original; }, 1500);
      }
      return;
    }

    // منتج بمقاسات/ألوان: الزرار مكتوب عليه "اختر الخيارات" وبيفتح صفحة المنتج على طول بدل طلب هيفشل
    if (addCartBtn.hasAttribute('data-needs-options') && productUrl) {
      window.location.href = productUrl;
      return;
    }

    const productId = addCartBtn.getAttribute('data-product-id');
    const labelSpan = addCartBtn.querySelector('span');
    const originalText = labelSpan.innerText;

    addCartBtn.disabled = true;
    labelSpan.innerText = blkT('adding');

    const restore = () => {
      setTimeout(() => {
        labelSpan.innerText = originalText;
        addCartBtn.disabled = false;
      }, 2000);
    };

    // منتج بنسخة واحدة: السيرفر ممكن يحتاج الـ variant. ومفيش إضافة أكتر من المتاح (المخزون - اللي في السلة)
    blkAddWithinStock(productId, 1, addCartBtn.getAttribute('data-variant-id') || undefined, blkStockAttr(addCartBtn))
      .then((result) => {
        if (!result.added) {
          labelSpan.innerText = originalText;
          addCartBtn.disabled = false;
          showQmraToast(blkAddMessage(result), 'error');
          return;
        }
        // لو CartManager جاي من المنصة ومش بيحدّث الهيدر بتاعنا، بنحدّثه إحنا
        blkApplyCart(result.cart);
        labelSpan.innerText = blkT('added');
        blkAfterAdd(result);
        restore();
      })
      .catch((err) => {
        console.warn('[cart] add failed:', err);
        labelSpan.innerText = originalText;
        restore();
        // مشكلة كوكيز (المحرر/حماية المتصفح): نقول السبب ومانروحش لصفحة المنتج
        if (err && err.blkCookies) {
          showQmraToast(err.message, 'error');
          return;
        }
        // غالباً المنتج محتاج اختيار مقاس/لون: بنقول السبب ونوديه صفحة المنتج
        if (productUrl) {
          showQmraToast(blkT('needsOptionsRedirect'), 'info');
          setTimeout(() => { window.location.href = productUrl; }, 1200);
          return;
        }
        showQmraToast((err && err.message && !/^Request failed/.test(err.message))
          ? err.message
          : blkT('addFailed'), 'error');
      });
  }
});



/* ==========================================================
   QMRA FEATURED PRODUCTS SLIDER
   ========================================================== */

blkRegister('.blk-featured-section', initFeaturedSection);

function initFeaturedSection(section) {
  const track = section.querySelector('.blk-slider-track');
  const prevBtn = section.querySelector('.blk-prev');
  const nextBtn = section.querySelector('.blk-next');
  const tabsContainer = section.querySelector('.blk-tabs');

  if (!track) return;

  /* 1. Tabs & Filtering Engine */
  if (tabsContainer) {
    const tabs = tabsContainer.querySelectorAll('.blk-tab-btn');
    const indicator = tabsContainer.querySelector('.blk-tab-indicator');

    // offsetLeft محسوب من شمال .blk-tabs في RTL و LTR، فالمؤشر متثبّت على left: 0
    const updateIndicator = (activeTab) => {
      if (!indicator || !activeTab) return;
      indicator.style.width = `${activeTab.offsetWidth}px`;
      indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
    };

    // تاب مالوش كروت مايفضيش السلايدر (القوايم ممكن تيجي من غير قسم): بيتخفي، ولو ماتبقاش غير «الكل» الشريط كله بيتخفي
    const pruneTabs = () => {
      const cats = Array.from(track.querySelectorAll('.blk-prod-card')).map(card => card.getAttribute('data-category') || '');
      let visible = 0;
      tabs.forEach(tab => {
        const filter = tab.getAttribute('data-tab');
        tab.hidden = filter !== 'all' && !cats.includes(filter);
        if (!tab.hidden) visible += 1;
      });
      const wrap = tabsContainer.closest('.blk-tabs-wrapper');
      if (wrap) wrap.hidden = visible < 2;
    };
    if (!track.classList.contains('blk-store-loading')) pruneTabs();
    section.addEventListener('blk:products-loaded', pruneTabs);

    const initialActive = tabsContainer.querySelector('.blk-tab-btn.is-active') || tabs[0];
    if (initialActive) setTimeout(() => updateIndicator(initialActive), 150);

    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
        updateIndicator(e.currentTarget);

        const filterVal = e.currentTarget.getAttribute('data-tab');
        // بنجيب الكروت وقت الضغط عشان منتجات المتجر ممكن تكون اتبدلت بعد التحميل
        track.querySelectorAll('.blk-prod-card').forEach(card => {
          const cardCat = card.getAttribute('data-category') || '';
          card.style.display = (filterVal === 'all' || cardCat === filterVal) ? '' : 'none';
        });

        // نرجّع السلايدر للبداية عشان مايبانش فاضي بعد الفلترة
        track.scrollTo({ left: 0, behavior: 'smooth' });
      });
    });

    window.addEventListener('resize', () => {
      const active = tabsContainer.querySelector('.blk-tab-btn.is-active');
      if (active) updateIndicator(active);
    });
  }

  /* 2. Slider Navigation & Drag Controls */
  const scrollStep = () => {
    const card = Array.from(track.querySelectorAll('.blk-prod-card')).find(c => c.offsetWidth > 0);
    return card ? card.offsetWidth + 24 : 300;
  };

  // التالي بيمشي في اتجاه القراءة: شمال في العربي (RTL) ويمين في الإنجليزي (LTR)
  const dirSign = () => (getComputedStyle(track).direction === 'rtl' ? -1 : 1);

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      track.scrollBy({ left: dirSign() * scrollStep(), behavior: 'smooth' });
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      track.scrollBy({ left: -dirSign() * scrollStep(), behavior: 'smooth' });
    });
  }

  // Mouse Drag Logic
  const DRAG_THRESHOLD = 5;
  let isDown = false, didDrag = false, startX = 0, scrollLeft = 0;

  // نمنع سحب الصور واللينكات الافتراضي من المتصفح
  track.addEventListener('dragstart', (e) => e.preventDefault());

  track.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDown = true;
    didDrag = false;
    startX = e.pageX;
    scrollLeft = track.scrollLeft;
  });

  track.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.pageX - startX;
    if (!didDrag && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!didDrag) {
      didDrag = true;
      track.classList.add('is-dragging');
    }
    e.preventDefault();
    track.scrollLeft = scrollLeft - dx * 1.5;
  });

  const endDrag = () => {
    if (!isDown) return;
    isDown = false;
    track.classList.remove('is-dragging');
  };
  track.addEventListener('mouseleave', endDrag);
  window.addEventListener('mouseup', endDrag);

  // لو حصل سحب، نلغي الكليك اللي بعده عشان مايفتحش صفحة المنتج
  track.addEventListener('click', (e) => {
    if (didDrag) {
      e.preventDefault();
      e.stopPropagation();
      didDrag = false;
    }
  }, true);

  /* 3. Automatic SEO JSON-LD Injector */
  injectQmraSchema(section, track);

  // منتجات المتجر وصلت (pages.js): نرجّع للبداية ونحدّث الـ Schema
  track.addEventListener('blk:products-loaded', () => {
    const first = tabsContainer && tabsContainer.querySelector('.blk-tab-btn');
    if (first && !first.classList.contains('is-active')) first.click();
    track.scrollTo({ left: 0 });
    injectQmraSchema(section, track);
  });
}

function injectQmraSchema(section, track) {
  // المنتجات التجريبية مش بتدخل في الـ Schema
  const cards = track.querySelectorAll('.blk-prod-card:not([data-dummy])');
  if (!cards.length) return;

  // كود عملة المتجر بس، ومن غيره مانكتبش offer بعملة متخمّنة
  const currency = section.getAttribute('data-currency') || document.body.getAttribute('data-currency-code') || '';

  const items = Array.from(cards).map((card, idx) => {
    const title = card.querySelector('.blk-prod-title')?.innerText.trim() || '';
    const price = Number(card.getAttribute('data-price')) / BLK_PRICE_SCALE;
    const url = card.getAttribute('data-url');
    const img1 = card.querySelector('.blk-img-primary')?.src || '';
    const img2 = card.querySelector('.blk-img-secondary')?.src || '';

    const product = {
      "@type": "Product",
      "name": title,
      "image": [img1, img2].filter(Boolean)
    };
    if (url) product.url = new URL(url, window.location.origin).href;
    if (price > 0 && currency) {
      product.offers = {
        "@type": "Offer",
        "priceCurrency": currency,
        "price": price.toFixed(2)
      };
    }

    return { "@type": "ListItem", "position": idx + 1, "item": product };
  });

  const schemaObj = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": section.querySelector('.blk-section-title')?.innerText.trim() || blkT('newArrivals'),
    "itemListElement": items
  };

  // سكريبت واحد لكل سكشن حتى لو اتعمل init أكتر من مرة
  const scriptId = `blk-jsonld-${section.id}`;
  let script = document.getElementById(scriptId);
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = scriptId;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schemaObj);
}



/* ==========================================================
   TOAST
   ========================================================== */

let blkToastTimer;
// GEN-16: نوع الرسالة (success | error | info). الخطأ شكله خطأ: أيقونة + لون أحمر + role=alert، وبيفضل وقت أطول
const BLK_ERROR_KEYS = ['addFailed', 'cookiesBlocked', 'outOfStock', 'variantUnavailable', 'removeUnavailable', 'cartError', 'searchError', 'loadFailed', 'copyFailed', 'productNotFound', 'allInCart', 'wishlistError'];
function blkToastType(msg, type) {
  if (type) return type;
  // رسالة جاية من blkT لمفتاح خطأ معروف
  return BLK_ERROR_KEYS.some(k => blkT(k) === msg) || /^اختر |^Please choose|^Choisissez|المتاح .* فقط|^Only \d+ available/.test(msg) ? 'error' : 'success';
}
function showQmraToast(msg, type) {
  if (!msg) return;
  const kind = blkToastType(String(msg), type);
  let toast = document.getElementById('qmraToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'qmraToast';
    // الكلاس blk-toast في pages.css: على الموبايل بيطلع فوق شريط الشراء الثابت ومابيخرجش بره الشاشة
    toast.className = 'blk-toast';
    toast.innerHTML = '<span class="blk-toast-icon" aria-hidden="true"></span><span class="blk-toast-text"></span>';
    document.body.appendChild(toast);
  }
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  toast.classList.remove('is-error', 'is-success', 'is-info');
  toast.classList.add(`is-${kind}`);
  toast.querySelector('.blk-toast-icon').innerHTML = kind === 'error'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>'
    : kind === 'info'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.5"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  toast.querySelector('.blk-toast-text').textContent = msg;
  toast.classList.add('is-visible');
  clearTimeout(blkToastTimer);
  blkToastTimer = setTimeout(() => { toast.classList.remove('is-visible'); }, kind === 'error' ? 4500 : 2600);
}



/* ==========================================================
   زر العودة للأعلى + زر الواتساب فوق شريط الشراء الثابت
   ========================================================== */
(function blkFabs() {
  const sync = () => {
    const show = window.scrollY > window.innerHeight;
    document.querySelectorAll('[data-blk-top]').forEach(btn => { btn.hidden = !show; });
  };
  window.addEventListener('scroll', sync, { passive: true });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-blk-top]');
    if (!btn) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const main = document.getElementById('main');
    if (main) setTimeout(() => main.focus({ preventScroll: true }), reduce ? 0 : 500);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();



/* ==========================================================
   تبديل العملة (GEN-15): المنصة بتحدد العملة من كوكي currency
   الأزرار بتظهر بس لو فيه عملتين أو أكتر (قايمة التاجر + عملات المنصة)
   ========================================================== */
function blkMountCurrency() {
  const hosts = document.querySelectorAll('[data-currency-host]');
  if (!hosts.length) return;
  const seed = hosts[0].dataset;
  const codes = Array.from(new Set([seed.currencies || '', seed.platform || ''].join(',')
    .split(',').map(c => c.trim().toUpperCase()).filter(c => /^[A-Z]{3}$/.test(c))));
  if (codes.length < 2) return;
  const current = (seed.current || '').toUpperCase();
  const html = codes.map(c => `<button type="button" class="blk-currency-btn${c === current ? ' is-active' : ''}" data-currency-switch="${c}" lang="en" dir="ltr" aria-pressed="${c === current}" aria-label="${blkEscapeAttr(blkT('currencySwitch', { code: c }))}">${c}</button>`).join('');
  hosts.forEach(host => { host.innerHTML = html; host.hidden = false; });
}
function blkEscapeAttr(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-currency-switch]');
  if (!btn) return;
  e.preventDefault();
  const code = String(btn.getAttribute('data-currency-switch') || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || btn.classList.contains('is-active')) return;
  const parts = window.location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
  domains.forEach(d => { document.cookie = `currency=; path=/; max-age=0${d}`; });
  document.cookie = `currency=${code}; path=/; max-age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
  window.location.reload();
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', blkMountCurrency); else blkMountCurrency();



/* ==========================================================
   إتمام الطلب: نفس بروتوكول المنصة (GET /checkout مع x-qumra-checkout) ولو مانفعش بنروح /checkout عادي
   ========================================================== */
async function blkCheckout() {
  try {
    const r = await fetch('/checkout', { method: 'GET', credentials: 'same-origin', headers: { 'x-qumra-checkout': '1', Accept: 'application/json' } });
    const data = await r.json().catch(() => null);
    if (data && data.success && data.url) { window.location.assign(data.url); return; }
  } catch (err) { /* هنروح بالرابط العادي */ }
  window.location.href = '/checkout';
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-blk-checkout]');
  if (!btn || e.defaultPrevented) return;
  if (btn.getAttribute('aria-disabled') === 'true') return;
  e.preventDefault();
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  blkCheckout();
});



/* ==========================================================
   السلة الجانبية (CART-11) — ui/blk-cart-drawer.njk
   بتعرض السلة الحقيقية: الكمية (+/−) في حدود المخزون، الحذف، الإجمالي، وإتمام الطلب
   ========================================================== */
const blkCartDrawer = (() => {
  let lastFocus = null;
  let stockByLine = {};
  const el = () => document.querySelector('[data-blk-cart-drawer]');
  const q = sel => { const d = el(); return d ? d.querySelector(sel) : null; };

  function lineUrl(item) {
    const pd = item.productData || {};
    const slug = pd.slug || pd.handle;
    return slug ? `/products/${encodeURIComponent(slug)}` : `/shop?product-id=${encodeURIComponent(item.productId || '')}`;
  }
  function variantLabel(item) {
    const opts = item.options || (item.variantData && item.variantData.options) || (item.variant && item.variant.options) || [];
    const labels = (Array.isArray(opts) ? opts : []).map(o => (o && typeof o === 'object') ? (o.label || o.value || o.name || '') : (typeof o === 'string' && !/^[0-9a-f]{24}$/i.test(o) ? o : '')).filter(Boolean);
    return labels.join(' · ') || item.variantTitle || (item.variantData && item.variantData.title) || '';
  }

  function render(data) {
    const d = el();
    if (!d) return;
    const cart = blkNormalizeCart(data) || { items: [], totalQuantity: 0, totalPrice: 0 };
    const items = Array.isArray(cart.items) ? cart.items : [];
    const body = q('[data-drawer-body]');
    const empty = q('[data-drawer-empty]');
    const foot = q('[data-drawer-foot]');
    const count = q('[data-drawer-count]');
    if (count) count.textContent = cart.totalQuantity ? `(${cart.totalQuantity})` : '';
    if (empty) empty.hidden = items.length > 0;
    if (foot) foot.hidden = !items.length;
    if (body) {
      body.hidden = !items.length;
      body.innerHTML = items.length ? `<ul class="blk-cart-drawer-list">${items.map(item => {
        const pd = item.productData || {};
        const img = (pd.image && pd.image.fileUrl) || (Array.isArray(pd.images) && pd.images[0] && pd.images[0].fileUrl) || '';
        const title = blkEscapeAttr(pd.title || item.title || '');
        const variant = variantLabel(item);
        const stock = stockByLine[item._id];
        const out = BLK_FOLLOW_STOCK && typeof stock === 'number' && stock <= 0;
        const max = BLK_FOLLOW_STOCK && typeof stock === 'number' && stock > 0 ? ` max="${stock}"` : '';
        return `<li class="blk-cart-drawer-item${out ? ' is-unavailable' : ''}" data-drawer-line="${blkEscapeAttr(item._id)}">
            <a href="${blkEscapeAttr(lineUrl(item))}" class="blk-cart-drawer-thumb">${img ? `<img src="${blkEscapeAttr(img)}" alt="${title}" loading="lazy" width="72" height="84">` : `<img src="${BLK_NO_IMAGE}" alt="${title}" width="72" height="84">`}</a>
            <div class="blk-cart-drawer-info">
              <a href="${blkEscapeAttr(lineUrl(item))}" class="blk-cart-drawer-name">${title}</a>
              ${variant ? `<span class="blk-cart-drawer-variant">${blkEscapeAttr(variant)}</span>` : ''}
              <span class="blk-cart-drawer-price">${blkEscapeAttr(blkPrice(item.price))}</span>
              ${out ? `<span class="blk-cart-drawer-stock" role="alert">${blkEscapeAttr(blkT('outOfStock'))}</span>` : ''}
              <div class="blk-cart-drawer-actions">
                <div class="blk-qty blk-qty-sm">
                  <button type="button" class="blk-qty-btn" data-drawer-step="1" aria-label="${blkEscapeAttr(blkT('qtyIncrease'))}"${out ? ' disabled' : ''}>+</button>
                  <input type="number" class="blk-qty-input" value="${Number(item.quantity) || 1}" min="1"${max} inputmode="numeric" aria-label="${blkEscapeAttr(blkT('quantity'))}" data-drawer-qty${out ? ' disabled' : ''}>
                  <button type="button" class="blk-qty-btn" data-drawer-step="-1" aria-label="${blkEscapeAttr(blkT('qtyDecrease'))}"${out ? ' disabled' : ''}>−</button>
                </div>
                <button type="button" class="blk-cart-remove" data-drawer-remove aria-label="${blkEscapeAttr(blkT('remove'))} ${title}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                </button>
              </div>
            </div>
            <strong class="blk-cart-drawer-line">${blkEscapeAttr(blkPrice(item.totalPrice))}</strong>
          </li>`;
      }).join('')}</ul>` : '';
    }
    const sub = q('[data-drawer-subtotal]');
    if (sub) sub.textContent = blkMoney(cart.totalPrice);
    // شريط الشحن المجاني: بس لو التاجر حاطط الحد في الإعدادات (REG-19 / REG-20)
    const free = Number(BLK_CFG.freeShipping) || 0;
    const ship = q('[data-drawer-ship]');
    if (ship) {
      const threshold = free * BLK_PRICE_SCALE;
      ship.hidden = !(threshold > 0 && items.length);
      if (!ship.hidden) {
        const text = q('[data-drawer-ship-text]');
        const bar = q('[data-drawer-ship-bar]');
        const total = Number(cart.totalPrice) || 0;
        if (bar) bar.style.width = `${Math.min(100, Math.round(total / threshold * 100))}%`;
        if (text) text.innerHTML = total >= threshold ? blkEscapeAttr(blkT('freeShippingReached'))
          : `${blkEscapeAttr(blkT('freeLeftPrefix'))} <strong>${blkEscapeAttr(blkMoney(threshold - total))}</strong> ${blkEscapeAttr(blkT('freeLeftSuffix'))}`;
      }
    }
    // سطر نفد: إتمام الطلب مقفول برسالة لحد ما يتشال (CART-07)
    const blocked = !!(body && body.querySelector('.is-unavailable'));
    const checkout = q('[data-blk-checkout]');
    const block = q('[data-drawer-block]');
    if (checkout) { checkout.setAttribute('aria-disabled', String(blocked)); checkout.classList.toggle('is-disabled', blocked); }
    if (block) { block.hidden = !blocked; block.textContent = blocked ? blkT('removeUnavailable') : ''; }
  }

  // مخزون كل سطر (نفس طريقة صفحة السلة): من غير ما يأخر فتح الدروار
  async function loadStock(data) {
    const cart = blkNormalizeCart(data);
    if (!cart || !Array.isArray(cart.items) || typeof blkFetchProductByHandle !== 'function') return;
    const handles = [...new Set(cart.items.map(i => i.productData && (i.productData.slug || i.productData.handle)).filter(Boolean))];
    const products = {};
    await Promise.all(handles.map(async h => { products[h] = await blkFetchProductByHandle(h); }));
    let changed = false;
    cart.items.forEach(item => {
      const h = item.productData && (item.productData.slug || item.productData.handle);
      const p = products[h];
      if (!p) return;
      const v = item.variantId && Array.isArray(p.variants) ? p.variants.find(x => x && String(x._id) === String(item.variantId)) : null;
      const stock = v && typeof v.quantity === 'number' ? v.quantity : blkProductQty(p);
      if (typeof stock === 'number' && stockByLine[item._id] !== stock) { stockByLine[item._id] = stock; changed = true; }
    });
    if (changed) render(cart);
  }

  async function refresh() {
    try {
      const data = await blkFetchCart();
      blkApplyCart(data);
      render(data);
      loadStock(data);
    } catch (err) {
      render(blkCartSnapshot);
    }
  }

  function open() {
    const d = el();
    if (!d) return false;
    lastFocus = document.activeElement;
    d.hidden = false;
    requestAnimationFrame(() => d.classList.add('is-open'));
    document.documentElement.classList.add('blk-no-scroll');
    const panel = d.querySelector('.blk-cart-drawer-panel');
    if (panel) panel.focus();
    if (blkCartSnapshot) render(blkCartSnapshot);
    refresh();
    return true;
  }
  function close() {
    const d = el();
    if (!d || d.hidden) return;
    d.classList.remove('is-open');
    document.documentElement.classList.remove('blk-no-scroll');
    setTimeout(() => { d.hidden = true; }, 260);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  const change = async (line, qty) => {
    const row = q(`[data-drawer-line="${CSS.escape(line)}"]`);
    if (row) row.classList.add('is-loading');
    try {
      const data = qty > 0 ? await window.CartManager.update(line, qty) : await window.CartManager.remove(line);
      render(data);
    } catch (err) {
      showQmraToast(err && err.message && !/^Request failed/.test(err.message) ? err.message : blkT('cartError'), 'error');
      refresh();
    }
  };

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-blk-cart-open]');
    if (opener && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !document.querySelector('[data-blk-cart-page]')) {
      if (open()) e.preventDefault();
      return;
    }
    if (e.target.closest('[data-blk-cart-close]')) { close(); return; }
    const row = e.target.closest('[data-drawer-line]');
    if (!row) return;
    const line = row.getAttribute('data-drawer-line');
    const input = row.querySelector('[data-drawer-qty]');
    const step = e.target.closest('[data-drawer-step]');
    if (step && input && !input.disabled) {
      const before = parseInt(input.value, 10) || 1;
      const wanted = before + Number(step.getAttribute('data-drawer-step'));
      const max = Number(input.max) || Infinity;
      if (wanted > max) { showQmraToast(blkT('maxQty', { count: max }), 'error'); return; }
      if (wanted < 1) return;
      input.value = wanted;
      change(line, wanted);
      return;
    }
    if (e.target.closest('[data-drawer-remove]')) change(line, 0);
  });
  document.addEventListener('change', (e) => {
    const input = e.target.closest('[data-drawer-qty]');
    if (!input) return;
    const row = input.closest('[data-drawer-line]');
    let val = parseInt(input.value, 10);
    const max = Number(input.max) || Infinity;
    if (!Number.isFinite(val) || val < 1) val = 1;
    if (val > max) { val = max; showQmraToast(blkT('maxQty', { count: max }), 'error'); }
    input.value = val;
    change(row.getAttribute('data-drawer-line'), val);
  });
  document.addEventListener('keydown', (e) => {
    const d = el();
    if (!d || d.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      // التركيز بيفضل جوه الدروار
      const f = Array.from(d.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')).filter(x => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  window.addEventListener('cart:updated', (e) => { const d = el(); if (d && !d.hidden) render(e.detail); });

  return { open, close, refresh };
})();

// بعد إضافة ناجحة: السلة الجانبية لو الإعداد مفعّل، وإلا رسالة
function blkAfterAdd(result) {
  if (BLK_CFG.cartOpenOnAdd !== false && !(result && result.demo) && !document.querySelector('[data-blk-cart-page]') && blkCartDrawer.open()) {
    if (result && result.partial) showQmraToast(blkAddMessage(result), 'info');
    return;
  }
  showQmraToast(blkAddMessage(result), 'success');
}



/* ==========================================================
   المفضلة (showWishlist): قلب على الكارت وصفحة المنتج — /ajax/wishlist/add | remove
   ========================================================== */
const blkWishlist = (() => {
  const ids = new Set((Array.isArray(BLK_CFG.wishlistIds) ? BLK_CFG.wishlistIds : []).map(String));
  const paint = () => {
    document.querySelectorAll('[data-wish-toggle]').forEach(btn => {
      const on = ids.has(String(btn.getAttribute('data-wish-toggle')));
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? blkT('wishlistRemove') : blkT('wishlistAdd'));
    });
    document.querySelectorAll('[data-wish-count]').forEach(el => { el.textContent = ids.size; el.hidden = !ids.size; });
  };
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-wish-toggle]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = String(btn.getAttribute('data-wish-toggle') || '');
    if (!id || btn.classList.contains('is-busy')) return;
    // منتج تجريبي (معاينة): مالوش مفضلة في المنصة
    if (/^demo-/.test(id)) { showQmraToast(blkT('demoOnly'), 'info'); return; }
    const adding = !ids.has(id);
    btn.classList.add('is-busy');
    try {
      await blkPost(adding ? '/ajax/wishlist/add' : '/ajax/wishlist/remove', { productId: id });
      if (adding) ids.add(id); else ids.delete(id);
      paint();
      showQmraToast(blkT(adding ? 'wishlistAdded' : 'wishlistRemoved'), 'success');
    } catch (err) {
      showQmraToast(err && err.blkCookies ? err.message : blkT('wishlistError'), 'error');
    } finally {
      btn.classList.remove('is-busy');
    }
  });
  return { paint };
})();
blkRegister('[data-wish-toggle]', () => blkWishlist.paint());

// pages.js بيسجّل موديولاته بعد الملف ده، فالتشغيل بيحصل في الآخر
blkBoot();
