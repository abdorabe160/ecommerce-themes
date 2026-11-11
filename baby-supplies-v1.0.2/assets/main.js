
/* TAQA Theme - Main JavaScript */
(function () {
    'use strict';
    // ===== Config =====
    const config = window.__QUMRA_CONFIG__ || {};
    const QumraConfig = {
        api: {
            cart: {
                get: '/ajax/cart',
                add: '/ajax/cart/add',
                change: '/ajax/cart/change',
                remove: '/ajax/cart/remove',
                clear: '/ajax/cart/clear'
            },
            search: {
                products: '/ajax/search/products',
                suggest: '/ajax/search/suggest'
            },
            product: {
                get: '/ajax/product',
                variant: '/ajax/product/resolve-variant-by-options'
            }
        },
        defaults: {
            currency: config.currency || 'EGP',
            currencySymbol: config.currencySymbol || 'ج.م',
            language: config.language || 'ar',
            exchangeRate: config.exchangeRate || 1
        },
        selectors: {
            cart: {
                count: '[data-cart-count]',
                itemsCount: '[data-cart-items-count]',
                total: '[data-cart-total]',
                container: '[data-cart-container]'
            }
        },
        messages: {
            addedToCart: (config.messages && config.messages.addedToCart) || 'Added to cart',
            addError: (config.messages && config.messages.addError) || 'Error, please try again',
            outOfStock: (config.messages && config.messages.outOfStock) || 'This product is out of stock'
        }
    };

    // ===== EventBus =====
    const EventBus = {
        _listeners: {},
        on(event, callback) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(callback);
            return () => {
                this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
            };
        },
        emit(event, data) {
            (this._listeners[event] || []).forEach(cb => cb(data));
            window.dispatchEvent(new CustomEvent(event, { detail: data }));
        }
    };

    // ===== ApiClient =====
    const ApiClient = {
        async _parse(res) {
            // Parse JSON body if present, even on error responses, so the
            // server's reason (e.g. out of stock) isn't lost.
            let data = null;
            try { data = await res.json(); } catch (e) { /* non-JSON body */ }
            if (!res.ok) {
                const err = new Error((data && data.message) || ('Request failed: ' + res.status));
                err.status = res.status;
                err.data = data;
                throw err;
            }
            return data;
        },
        async get(url, params) {
            const query = params ? '?' + new URLSearchParams(params).toString() : '';
            const res = await fetch(url + query);
            return this._parse(res);
        },
        async post(url, body) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            return this._parse(res);
        }
    };

    // ===== Utils =====
    /* Mirrors the server-side `| money` filter so an AJAX-rendered price and a
       server-rendered one are byte-identical.

       layout.njk feeds us `moneyFormatSample: '{{ 1234567 | money }}'`. Because
       the INPUT is known, the sample reveals the whole format:

         "1,234,567ج.م"  → scale 1,   0 decimals, comma, no space, symbol last
         "12,345.67 ر.س" → scale 100, 2 decimals, comma, space,  symbol last
         "$12,345.67"    → scale 100, 2 decimals, comma, no space, symbol FIRST

       Assumes en-US grouping (`,` thousands, `.` decimal), same as the filter.

       ⚠️  Do not hardcode 2 decimals here. The Egyptian store renders
       `{{ 1000 | money }}` as "1,000ج.م" — no decimals at all — so a hardcoded
       toFixed(2) printed "1,000.00ج.م" in every carousel and cart row while the
       server printed "1,000ج.م" on the same page. */
    const _moneyFormat = (function () {
        var fallback = { useComma: true, space: ' ', decimals: 2, scale: 1, symbolFirst: false };
        var sample = (config.moneyFormatSample || '').trim();
        var symbol = config.currencySymbol || '';
        if (!sample || !symbol) return fallback;

        var idx = sample.indexOf(symbol);
        if (idx === -1) return fallback;

        var symbolFirst = idx === 0;
        var numPart = symbolFirst ? sample.slice(idx + symbol.length) : sample.slice(0, idx);
        var space = /^\s|\s$/.test(numPart) ? ' ' : '';
        numPart = numPart.trim();

        /* Only 1–2 digits after the LAST dot count as a fraction — otherwise the
           dot is a thousands separator ("1.000") and there are no decimals. */
        var dot = numPart.lastIndexOf('.');
        var frac = dot === -1 ? '' : numPart.slice(dot + 1);
        var decimals = /^[0-9]{1,2}$/.test(frac) ? frac.length : 0;

        var digits = (decimals ? numPart.slice(0, dot) : numPart).replace(/[^0-9]/g, '');
        var value = Number(digits + (decimals ? '.' + frac : ''));
        /* MONEY_PROBE in, 12,345.67 out → the filter works in minor units, so we
           must divide too. Must match the number layout.njk pipes through `money`.

           MEASURED, not chosen from two options. The old line was

             scale = Math.abs(PROBE / value - 100) < 1 ? 100 : 1

           which silently answered 1 for anything that was not ~100 — and the
           thing that is not ~100 is a market with an exchange rate. If `| money`
           converts as well as scales, the ratio becomes 100/rate, and falling
           back to 1 renders every AJAX price at 26x to 1250x the server's:

             rate 3.75 → server 46,296.26, JS 1,234,567    (26x)
             rate 0.08 → server    987.65, JS 1,234,567  (1250x)

           Both transforms are linear, so ONE measured ratio absorbs both and the
           JS cannot disagree with the server whatever the market does.

           The two snaps keep the common markets byte-identical to before —
           float noise must not turn 100 into 99.9999 and shift a decimal. Only
           the third branch is new, and it replaces a silent 100x error.

           ⚠️  This is also why `exchangeRate` from __QUMRA_CONFIG__ is NEVER
           multiplied in anywhere: whatever conversion the server applies is
           already inside this ratio. Multiplying by it as well would convert
           twice. Do not "fix" formatMoney by reaching for that value. */
        var MONEY_PROBE = 1234567;
        var ratio = value > 0 ? MONEY_PROBE / value : 1;
        var scale = Math.abs(ratio - 100) < 1 ? 100
            : Math.abs(ratio - 1) < 0.01 ? 1
                : ratio;

        return {
            useComma: numPart.indexOf(',') !== -1,
            space: space,
            decimals: decimals,
            scale: scale,
            symbolFirst: symbolFirst
        };
    })();

    const Utils = {
        /* «منتج واحد، منتجان، 3 منتجات، 11 منتج». Twin of ui/count.njk. */
        count(n) {
            var c = (config.card && config.card.counts) || {};
            n = Number(n) || 0;
            var s = n === 1 ? c.one : (n === 2 ? c.two : (n >= 3 && n <= 10 ? c.few : c.many));
            return String(s || n).split('{n}').join(n);
        },

        formatMoney(amount) {
            if (amount == null) return '';
            var num = Number(amount) / _moneyFormat.scale;
            if (!isFinite(num)) return '';
            var d = _moneyFormat.decimals;
            var formatted = _moneyFormat.useComma
                ? num.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
                : num.toFixed(d);
            var symbol = QumraConfig.defaults.currencySymbol;
            return _moneyFormat.symbolFirst
                ? symbol + _moneyFormat.space + formatted
                : formatted + _moneyFormat.space + symbol;
        },

        /* FLOOR, not round. 500 against 800 is 37.5% off; rounding advertises
           38% for a cut that is not 38%, and overstating a discount is the one
           direction that is wrong in more than taste — some jurisdictions
           regulate the claim. Flooring never promises more than the shopper
           gets. Every discount figure in the theme comes through here or the
           two mirrors of it in HayatVariants, and all three now agree. */
        /* A PRICE of zero is "Free"; a TOTAL of zero is not necessarily.
           This is deliberately NOT folded into formatMoney(), which also
           renders cart totals, savings rows and shipping lines — a savings row
           reading "−Free" or a discount of "Free" is nonsense, and one shared
           function cannot tell which caller it is serving. Callers that show a
           product's price use this; everything else keeps formatMoney(). */
        formatPrice(amount) {
            var n = Number(amount);
            if (n === 0) {
                var t = (window.__QUMRA_CONFIG__ && window.__QUMRA_CONFIG__.card) || {};
                return t.free || Utils.formatMoney(0);
            }
            return Utils.formatMoney(amount);
        },

        calcDiscount(price, compareAtPrice) {
            if (!compareAtPrice || compareAtPrice <= price) return 0;
            return Math.floor(((compareAtPrice - price) / compareAtPrice) * 100);
        },

        debounce(fn, delay) {
            let timer;
            return function (...args) {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },

        throttle(fn, limit) {
            let inThrottle;
            return function (...args) {
                if (!inThrottle) {
                    fn.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => (inThrottle = false), limit);
                }
            };
        }
    };

    /* =========================================================================
       HayatCard — the ONE JavaScript product-card renderer
       -------------------------------------------------------------------------
       ⚠️  THIS CARD HAS A TWIN: ui/product-card.njk renders the same markup
       server-side. If you change the structure here, change it there too.
       All styling lives in assets/style.css → "PRODUCT CARD", so the two can
       never drift visually — only the markup order has to stay in sync.

       Reading order: brand → name → specs → rating → price → stock → action

       Every widget that renders products from JSON must call
       HayatCard.build(product, opts) instead of writing its own template.
       ====================================================================== */
    const HayatCard = {
        _t: (config.card || {}),
        _defaults: (config.cardDefaults || {}),

        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        /* Keep in sync with the ratio block in ui/product-card.njk. */
        ratioValue(ratio) {
            switch (ratio) {
                case '1x1':
                case 'square': return '1 / 1';
                case '4x5': return '4 / 5';
                case '2x3':
                case 'portrait': return '2 / 3';
                default: return '3 / 4';
            }
        },

        build(p, opts) {
            if (!p) return '';
            var o = Object.assign({}, this._defaults, opts || {});
            var t = this._t;

            var price = (p.pricing && p.pricing.price) || 0;
            var was = (p.pricing && p.pricing.compareAtPrice) || 0;
            var onSale = !!(was && was > price);

            /* "New" and "selling fast" — both from REAL fields, never invented.
               Mirrors the resolution block in ui/product-card.njk: there is no
               `createdAt` in the list payload, so "new" is a merchant tag named
               by a theme setting; "selling fast" is genuine low stock, and an
               untracked product has no count to be low. */
            var tags = (p.tags || []).map(function (t) { /* live tags are objects */ if (t && typeof t === 'object') t = t.name || t.displayName || t.title || t.label || t.value || ''; return String(t).trim().toLowerCase(); });
            function tagged(name, fallback) {
                var want = String(name || fallback).toLowerCase();
                return o.showNewBadge !== false && !!want && tags.indexOf(want) !== -1;
            }
            var isNew = tagged(o.newTag, 'new');
            var isPopular = tagged(o.popularTag, 'popular');
            var isHot = tagged(o.hotTag, 'hot');

            var lowAt = Number(o.lowStock || 0);
            var isLowStock = lowAt > 0 && p.trackQuantity && !p.allowBackorder &&
                p.quantity > 0 && p.quantity <= lowAt;
            /* Rarely true — the list payload carries no variant field. The real
               guard is in productCard.addToCart(); this only saves a request on
               the pages that do hand us a full product. */
            var hasVariants = !!((p.variantsCount && p.variantsCount > 0) ||
                (p.variants && p.variants.length) ||
                (p.options && p.options.length));
            /* A product with options keeps its stock on the variants, so the parent's
               0 means "unknown", not sold out. Mirrors ui/product-card.njk. */
            var inStock = !!(p.allowBackorder || !p.trackQuantity || hasVariants || p.quantity > 0);

            var imgs = p.images || [];
            var img = imgs[0] && imgs[0].fileUrl;
            var imgAlt = (o.showSecondImage && imgs[1] && imgs[1].fileUrl) || '';

            var title = this.esc(p.title);
            var slug = p.slug || p.handle || p._id;
            /* Escaped ONCE, here. Every use below lands in an HTML attribute,
               and ui/product-card.njk escapes the same value through Nunjucks
               autoescape — leaving it raw here made the two twins disagree on
               any slug carrying `"`, `<` or `&`, and let it break out of the
               attribute entirely.
               ⚠️  Known limit, shared with the SSR twin: a slug containing an
               APOSTROPHE still breaks the `x-data` expression below, because
               the browser decodes `&#39;` before Alpine parses it. Closing that
               needs data attributes on both sides — see the note in
               widgets/shop-page/widget.njk. Platform slugs are hyphenated and
               do not carry one. */
            var url = this.esc('/products/' + slug);
            var pid = this.esc(p._id);

            var atc = o.atcStyle || 'tray';
            var modeCls = atc === 'always' ? 'hy-pcard--always' : (atc === 'tray' ? 'hy-pcard--tray' : '');
            /* 'compact' → info below the image, bag icon on it. Same markup as
               'overlay'; only this class differs. Mirrors ui/product-card.njk. */
            if (o.variant === 'compact') modeCls = 'hy-pcard--compact';
            /* 'catalog' → info below too, plus a collection eyebrow and option
               swatches. Mirrors ui/product-card.njk. */
            var isCatalog = o.variant === 'catalog';
            if (isCatalog) modeCls += ' hy-pcard--catalog';
            /* 'price' (default) or 'name' — which line leads. See 15.9. */
            if (o.infoOrder === 'name') modeCls += ' hy-pcard--name-first';

            /* `var(--hy-card-ratio, …)` — the SSR twin in ui/product-card.njk
               writes the identical declaration. An ancestor that owns the whole
               grid (the shop page) sets `--hy-card-ratio` once and both paths
               obey it; everywhere else the card's own ratio is the fallback. */
            var h = '<article class="hy-pcard ' + modeCls + '" style="--pcard-ratio: var(--hy-card-ratio, ' +
                this.ratioValue(o.imageRatio) + ');" x-data="productCard(\'' + pid + '\', \'' + url + '\')">';

            /* The frame is the positioning context for every overlay, and it
               has to be the IMAGE rather than the card — once `info` drops
               below the photograph the card grows taller and a card-anchored
               overlay lands under the price. Mirrors ui/product-card.njk. */
            h += '<div class="hy-pcard-frame">';

            /* ---------- media ---------- */
            h += '<a href="' + url + '" class="hy-pcard-media" aria-label="' + title + '">';
            if (img) {
                h += '<img src="' + this.esc(img) + '" alt="' + title + '" loading="lazy" ' +
                    'class="hy-pcard-img hy-pcard-img--primary' + (imgAlt ? '' : ' hy-pcard-img--only') + '"/>';
                if (imgAlt) {
                    h += '<img src="' + this.esc(imgAlt) + '" alt="" loading="lazy" class="hy-pcard-img hy-pcard-img--alt"/>';
                }
            } else {
                h += '<span class="hy-pcard-noimg"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" ' +
                    'stroke="currentColor" stroke-width="1.1" aria-hidden="true">' +
                    '<rect x="3" y="3" width="18" height="18"/><circle cx="8.75" cy="9" r="1.5"/>' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="m4 17 5-4.5 4.5 4 3-2.5L21 18"/></svg></span>';
            }
            h += '</a>';

            /* ---------- badges ----------
               A STACK, not one badge — sale first, then whichever tags apply.
               Mirrors ui/product-card.njk exactly: the two renderers must not
               disagree about what a card says. */
            var badgeVert = (o.badgeStyle === 'horizontal' ? '' : ' hy-pcard-badge--vertical');
            if (o.showBadge !== false) {
                var self = this;
                function pill(tone, text) {
                    return '<span class="hy-pcard-badge hy-pcard-badge--' + tone + badgeVert + '">' +
                        self.esc(text) + '</span>';
                }
                h += '<div class="hy-pcard-badges">';
                if (onSale) {
                    /* Same figure and same zero-fallback as the template — a
                       0.4% cut is a real sale and "−0%" reads as broken. */
                    var pct = Utils.calcDiscount(price, was);
                    h += pill('sale', pct > 0 ? '\u2212' + pct + '%' : t.onSale);
                }
                if (isNew) h += pill('new', t.isNew);
                if (isPopular) h += pill('popular', t.isPopular);
                if (isHot) h += pill('hot', t.isHot);
                h += '</div>';
            }

            /* ---------- quick view ---------- */
            if (o.showQuickView) {
                h += '<button type="button" class="hy-pcard-eye" aria-label="' + this.esc(t.quickView) +
                    '" @click.prevent="$dispatch(\'quick-view\', { slug: \'' + this.esc(slug) + '\' })">' +
                    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
                    '<circle cx="12" cy="12" r="2.6"/></svg></button>';
            }

            /* ---------- add to cart ---------- */
            if (inStock && atc !== 'hidden') {
                h += '<div class="hy-pcard-atc">';
                var bag = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
                    '<path stroke-linejoin="round" d="M4.5 7.5h15l-1.1 12a1.5 1.5 0 0 1-1.5 1.35H7.1a1.5 1.5 0 0 1-1.5-1.35L4.5 7.5Z"/>' +
                    '<path stroke-linecap="round" d="M8.75 10V6.75a3.25 3.25 0 0 1 6.5 0V10"/></svg>';
                var check = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="M4 12.5 9.5 18 20 6.5"/></svg>';
                var face = function (icon, label) {
                    return '<span class="hy-pcard-atc-face">' + icon +
                        '<span class="hy-pcard-atc-label">' + label + '</span></span>';
                };
                h += hasVariants
                    ? '<a href="' + url + '" class="hy-btn hy-btn--sm hy-btn--light">' +
                    face(bag, this.esc(t.chooseOptions)) + '</a>'
                    : '<button type="button" class="hy-btn hy-btn--sm hy-btn--light" @click.prevent="addToCart()" ' +
                    ':disabled="cartLoading || cartSuccess" aria-label="' + this.esc(t.addToCart) + '">' +
                    /* x-cloak as well as x-show — see the note in the njk twin. */
                    '<span x-show="cartLoading" x-cloak class="hy-spinner" style="width:14px;height:14px;"></span>' +
                    '<span x-show="cartSuccess && !cartLoading" x-cloak class="hy-pcard-atc-face">' + check +
                    '<span class="hy-pcard-atc-label">' + this.esc(t.added) + '</span></span>' +
                    '<span x-show="!cartLoading && !cartSuccess" class="hy-pcard-atc-face">' + bag +
                    '<span class="hy-pcard-atc-label">' + this.esc(t.addToCart) + '</span></span></button>';
                h += '</div>';
            }

            /* Four copies so the CSS marquee has a second half to scroll into —
               it translates the track by exactly 50% of its width. */
            if (isLowStock) {
                var rush = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg><span>' + this.esc(t.sellingFast) + '</span>';
                h += '<div class="hy-pcard-rush" aria-hidden="true"><div class="hy-pcard-rush-track">' +
                    rush + rush + rush + rush + '</div></div>';
            }

            if (!inStock) {
                h += '<div class="hy-pcard-soldout"><span>' + this.esc(t.outOfStock) + '</span></div>';
            }

            h += '</div>';   /* /frame */

            /* ---------- info ---------- */
            h += '<div class="hy-pcard-info">';

            /* Catalog eyebrow. collections[0] can be an id STRING rather than an
               object depending on the payload, and `.title` on a string is
               undefined — so that case renders nothing instead of a raw hash.
               Mirrors ui/product-card.njk. */
            if (isCatalog && o.showEyebrow !== false) {
                var col = (p.collections && p.collections[0]) || null;
                var colTitle = col && col.title;
                if (colTitle) h += '<span class="hy-pcard-eyebrow">' + this.esc(colTitle) + '</span>';
            }

            h += '<div class="hy-pcard-prices">';
            h += '<span class="hy-price' + (onSale ? ' hy-price--sale' : '') + '">' + Utils.formatPrice(price) + '</span>';
            if (onSale) h += '<span class="hy-price-was">' + Utils.formatMoney(was) + '</span>';
            h += '</div><a href="' + url + '" class="hy-pcard-name hy-clamp-2">' + title + '</a>';

            /* Catalog swatches. Qumra option values carry an IMAGE, never a hex
               code. Values from ALL options go into one row and the ones with no
               image are skipped — the cap and the "nothing rendered" case are
               both CSS (15.9.1), exactly as in the njk twin. */
            if (isCatalog && o.showSwatches !== false && p.options && p.options.length) {
                var sw = '';
                p.options.forEach(function (opt) {
                    (opt.values || []).forEach(function (v) {
                        if (v.image && v.image.fileUrl) {
                            sw += '<span class="hy-pcard-swatch" title="' + HayatCard.esc(v.label) + '">' +
                                '<img src="' + HayatCard.esc(v.image.fileUrl) + '" alt="" loading="lazy"/></span>';
                        }
                    });
                });
                if (sw) h += '<div class="hy-pcard-swatches" aria-hidden="true">' + sw + '</div>';
            }

            h += '</div>';

            h += '</article>';
            return h;
        },

        /* Render a list of products into a container and boot Alpine on them. */
        mount(container, products, opts) {
            if (!container) return;
            var self = this;
            container.innerHTML = (products || []).map(function (p) { return self.build(p, opts); }).join('');
            if (window.Alpine) {
                container.querySelectorAll('[x-data]').forEach(function (el) { Alpine.initTree(el); });
            }
        }
    };

    /* =========================================================================
       HayatCartItem — the ONE JavaScript cart-line renderer
       -------------------------------------------------------------------------
       ⚠️  THIS LINE HAS A TWIN: the `row` macro in ui/cart.njk renders the same
       markup server-side (drawer + cart page). Change one, change the other.
       Styling lives in assets/style.css → "15.25 CART".

       Only used when CartManager appends a row to an ALREADY-RENDERED drawer,
       so it must emit the same data-* hooks _refreshDrawer() looks for, and the
       same Alpine bindings cartInteraction provides: quantities · updating ·
       removingId · confirmRemoveId · activeItems · lineNote · atCap().
       ====================================================================== */
    const HayatCartItem = {
        _t: (config.cart || {}),

        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        build(item, opts) {
            if (!item) return '';
            var o = opts || {};
            var compact = o.compact !== false;      /* the drawer is the default caller */
            var id = item._id;
            var pd = item.productData || {};
            var t = this._t;
            var title = this.esc(pd.title);
            /* Escaped for the same reason as HayatCard above — this id also
               goes into `data-cart-item` and into every Alpine call on the row. */
            var url = this.esc('/products/' + (pd.slug || pd.handle || ''));
            var img = (pd.image && pd.image.fileUrl) || '';
            var hasCompare = !!(item.compareAtPrice && item.compareAtPrice > item.price);
            var onClick = o.onClick || '$store.modal.close()';
            var q = "'" + this.esc(id) + "'";

            var h = '<div class="hy-citem' + (compact ? ' hy-citem--compact' : '') + '" ' +
                'data-cart-item="' + this.esc(id) + '" ' +
                'x-show="activeItems.includes(' + q + ')" ' +
                'x-transition:enter="transition ease-out duration-200" ' +
                'x-transition:enter-start="opacity-0 translate-y-2" ' +
                'x-transition:enter-end="opacity-100 translate-y-0" ' +
                'x-transition:leave="transition ease-in duration-150" ' +
                'x-transition:leave-start="opacity-100" ' +
                'x-transition:leave-end="opacity-0" ' +
                ':class="removingId === ' + q + ' && \'is-removing\'">';

            /* ---- media ---- */
            h += '<a href="' + url + '" class="hy-citem-media" @click="' + onClick + '">';
            h += img
                ? '<img src="' + this.esc(img) + '" alt="' + title + '" loading="lazy"/>'
                : '<span class="hy-citem-noimg">' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
                '<rect x="3" y="3" width="18" height="18"/><circle cx="8.75" cy="9" r="1.5"/>' +
                '<path stroke-linecap="round" stroke-linejoin="round" d="m4 17 5-4.5 4.5 4 3-2.5L21 18"/></svg></span>';
            h += '</a>';

            /* ---- body ---- */
            h += '<div class="hy-citem-body">';
            h += '<div class="hy-citem-head">' +
                '<a href="' + url + '" class="hy-citem-name" @click="' + onClick + '">' + title + '</a>' +
                '<button type="button" @click="removeItem(' + q + ')" class="hy-citem-remove" ' +
                'aria-label="' + this.esc(t.remove) + '">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
                '<path stroke-linecap="round" d="M6 18 18 6M6 6l12 12"/></svg></button></div>';

            /* ---- which size and colour this line actually is ---- */
            var opts_ = (item.variantData && item.variantData.options) || [];
            if (opts_.length) {
                h += '<div class="hy-citem-opts">';
                opts_.forEach((op) => {
                    var name = (op.option && op.option.name) || '';
                    var isColor = op.option && op.option.type === 'color';
                    h += '<span class="hy-citem-opt">' + this.esc(name) + ': ' +
                        (isColor ? '<i class="hy-citem-dot" style="background: ' + this.esc(op.value || '#CBD3DE') + ';"></i>' : '') +
                        '<b>' + this.esc(op.label) + '</b></span>';
                });
                h += '</div>';
            }

            /* ---- why this line will not go up (mirrors ui/cart.njk) ---- */
            h += '<p class="hy-citem-note" x-show="lineNote[' + q + ']" x-cloak ' +
                'x-text="lineNote[' + q + ']"></p>';

            /* ---- qty + money ---- */
            h += '<div class="hy-citem-foot">' +
                '<div class="hy-qty hy-qty--sm">' +
                '<button type="button" @click="decrement(' + q + ')" aria-label="−">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" d="M5 12h14"/></svg></button>' +
                '<span>' +
                '<span x-show="updating !== ' + q + '" x-text="quantities[' + q + ']">' + item.quantity + '</span>' +
                '<span x-show="updating === ' + q + '" x-cloak class="hy-spinner" style="width:13px;height:13px;"></span>' +
                '</span>' +
                '<button type="button" @click="increment(' + q + ')" :disabled="atCap(' + q + ')" aria-label="+">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg></button>' +
                '</div>' +
                '<div class="hy-citem-money' + (hasCompare ? ' is-sale' : '') + '">' +
                /* unit price × qty — mirrors the same block in ui/cart.njk */
                '<span class="hy-citem-unit" title="' + this.esc(t.unitPrice) + '">' +
                '<bdi>' + Utils.formatMoney(item.price) + '</bdi>' +
                '<span aria-hidden="true">×</span>' +
                '<bdi x-text="quantities[' + q + ']">' + item.quantity + '</bdi>' +
                '</span>' +
                '<span class="hy-citem-total" data-item-total="' + this.esc(id) + '" ' +
                ':class="updating === ' + q + ' && \'is-pending\'">' +
                Utils.formatMoney(item.totalPrice) + '</span>' +
                '<span class="hy-citem-was" data-item-compare="' + this.esc(id) + '"' +
                (hasCompare ? '>' + Utils.formatMoney(item.totalCompareAtPrice) : ' style="display:none;">') +
                '</span>' +
                '</div></div>';

            /* ---- remove confirmation (cart page only) ---- */
            h += '<div class="hy-citem-confirm" x-show="confirmRemoveId === ' + q + '" x-cloak>' +
                '<span>' + this.esc(t.removeConfirm || t.remove) + '</span>' +
                '<div class="hy-citem-confirm-acts">' +
                '<button type="button" @click="removeItem(' + q + ')" class="hy-btn hy-btn--solid hy-btn--xs">' +
                this.esc(t.deleteLabel || t.remove) + '</button>' +
                '<button type="button" @click="confirmRemoveId = null" class="hy-btn hy-btn--outline hy-btn--xs">' +
                this.esc(t.cancel || '') + '</button></div></div>';

            h += '</div></div>';
            return h;
        }
    };

    // ===== Toast =====
    const Toast = {
        _show(message, type, duration) {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const el = document.createElement('div');
            el.className = 'toast toast-' + type;
            el.textContent = message;
            container.appendChild(el);
            setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(-10px)';
                el.style.transition = 'all 0.4s ease';
                setTimeout(() => el.remove(), 400);
            }, duration || 3000);
        },
        success(msg, duration) { this._show(msg, 'success', duration); },
        error(msg, duration) { this._show(msg, 'error', duration); },
        warning(msg, duration) { this._show(msg, 'warning', duration); },
        info(msg, duration) { this._show(msg, 'info', duration); }
    };

    // ===== Helper: Update DOM selectors =====
    function updateSelectors(selectors, values) {
        Object.entries(selectors).forEach(([key, selector]) => {
            if (typeof selector === 'string' && values[key] !== undefined) {
                document.querySelectorAll(selector).forEach(el => {
                    el.textContent = values[key];
                });
            }
        });
    }

    // ===== CartManager =====
    const CartManager = {
        async get() {
            return ApiClient.get(QumraConfig.api.cart.get);
        },

        async add(productId, quantity, options) {
            const body = { productId, quantity: quantity || 1 };
            if (Array.isArray(options) && options.length) {
                body.options = options;
            } else if (options) {
                body.variantId = options;
            }

            try {
                const data = await ApiClient.post(QumraConfig.api.cart.add, body);

                if (data.success === false) {
                    throw new Error(data.message || 'Failed');
                }

                this._updateUI(data);
                this._refreshDrawer(data);
                EventBus.emit('cart:updated', data);
                EventBus.emit('cart:item-added', { productId, data });

                Toast.success(QumraConfig.messages.addedToCart);

                // Open cart drawer after short delay
                setTimeout(() => { ModalController.open('cart'); }, 300);

                return data;
            } catch (error) {
                Toast.error(this._errorMessage(error));
                throw error;
            }
        },

        /* ===== addMany =====
           A bundle adds several products as ONE action, and `add()` cannot be
           looped for that: it toasts and opens the drawer on every call, so a
           two-item bundle fires two toasts and opens the drawer twice — the
           second one over an animation that has not finished.

           So the POSTs are sequential (the cart is server state; firing them in
           parallel races the same document) and everything the shopper SEES
           happens once, at the end, from the last good response.

           Partial success is reported honestly rather than swallowed: if some
           lines went in and others did not, the cart really does hold the ones
           that did, and saying "added" flat would be a lie.

           `items`: [{ productId, quantity, options }] — `options` takes the
           same shape `add()` accepts, a variantId or an array of value ids. */
        async addMany(items) {
            const list = (items || []).filter(i => i && i.productId);
            if (!list.length) return null;

            let last = null;
            const failed = [];

            for (const item of list) {
                const body = { productId: item.productId, quantity: item.quantity || 1 };
                if (Array.isArray(item.options) && item.options.length) {
                    body.options = item.options;
                } else if (item.options) {
                    body.variantId = item.options;
                }
                try {
                    const data = await ApiClient.post(QumraConfig.api.cart.add, body);
                    if (data.success === false) throw new Error(data.message || 'Failed');
                    last = data;
                } catch (error) {
                    failed.push({ item, error });
                }
            }

            /* Nothing landed — report it the way a single add would and stop. */
            if (!last) {
                Toast.error(this._errorMessage(failed.length ? failed[0].error : new Error('Failed')));
                throw failed.length ? failed[0].error : new Error('Failed');
            }

            this._updateUI(last);
            this._refreshDrawer(last);
            EventBus.emit('cart:updated', last);
            EventBus.emit('cart:item-added', { productId: list[list.length - 1].productId, data: last });

            if (failed.length) {
                Toast.error(this._errorMessage(failed[0].error));
            } else {
                Toast.success(QumraConfig.messages.addedToCart);
            }

            setTimeout(() => { ModalController.open('cart'); }, 300);
            return { data: last, failed };
        },

        /* The shopper is owed the most SPECIFIC true sentence available.
           This used to collapse anything stock-shaped into the generic
           "out of stock", which turns the server's "the requested quantity is
           not available" — a line that still has units left — into a wrong
           statement. Prefer the server's own words; fall back only when it
           gives us nothing but a status code or a bare "Failed".

           `order.product_out_of_stock` and friends are message KEYS, not
           sentences, so those are translated here rather than shown raw. */
        _errorMessage(error) {
            const raw = (error && error.data && error.data.message) || (error && error.message) || '';
            const isKey = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(raw);   /* e.g. order.product_out_of_stock */
            const isPlaceholder = /^(Request failed|Failed)/i.test(raw);
            const isStock = (error && error.status === 409)
                || /stock|inventory|مخزون|الكميه|الكمية|نفد|نفذ/i.test(raw);

            if (raw && !isKey && !isPlaceholder) return raw;
            if (isStock) return QumraConfig.messages.outOfStock || QumraConfig.messages.addError;
            return QumraConfig.messages.addError;
        },

        /* ⚠️  A refused change has to be SEEN and has to be UNDONE.
           The stepper bumps its number optimistically, so a silent
           `if (data.success !== false)` left "5" on screen while the cart still
           held 1 — which is how an out-of-stock line kept accepting `+`.
           Qumra's cart payload carries no stock field at all (item is
           {_id, productId, variantId, quantity, price…, productData:{title,
           handle, image}}), so the server is the ONLY authority on what is
           allowed: the client's job is to ask, then believe the answer. */
        async update(itemId, quantity) {
            try {
                const data = await ApiClient.post(QumraConfig.api.cart.change, { itemId, quantity });
                if (data.success === false) throw new Error(data.message || 'Failed');
                this._updateUI(data);
                this._refreshDrawer(data);
                EventBus.emit('cart:updated', data);
                return data;
            } catch (error) {
                Toast.error(this._errorMessage(error));
                await this._resync();
                throw error;
            }
        },

        /* Re-read the cart and re-broadcast it. `cart:updated` is what resets
           cartInteraction.quantities, so this is the revert. */
        async _resync() {
            try {
                const fresh = await this.get();
                if (!fresh || fresh.success === false) return;
                this._updateUI(fresh);
                this._refreshDrawer(fresh);
                EventBus.emit('cart:updated', fresh);
            } catch (e) {
                /* offline — leave the screen as it is rather than blanking it */
            }
        },

        async remove(itemId) {
            const itemEl = document.querySelector('[data-cart-item="' + itemId + '"]');
            if (itemEl) itemEl.classList.add('removing');
            try {
                const data = await ApiClient.post(QumraConfig.api.cart.remove, { itemId });
                if (data.success === false) throw new Error(data.message || 'Failed');
                this._updateUI(data);
                EventBus.emit('cart:updated', data);
                setTimeout(() => {
                    if (itemEl) itemEl.remove();
                    this._refreshDrawer(data);
                }, 400);
                return data;
            } catch (error) {
                /* the row is already mid-fade — put it back before explaining */
                if (itemEl) itemEl.classList.remove('removing');
                Toast.error(this._errorMessage(error));
                await this._resync();
                throw error;
            }
        },

        async clear() {
            try {
                const data = await ApiClient.post(QumraConfig.api.cart.clear, {});
                if (data.success === false) throw new Error(data.message || 'Failed');
                this._updateUI(data);
                this._refreshDrawer(data);
                EventBus.emit('cart:updated', data);
                return data;
            } catch (error) {
                Toast.error(this._errorMessage(error));
                await this._resync();
                throw error;
            }
        },

        _updateUI(data) {
            updateSelectors(QumraConfig.selectors.cart, {
                count: data.totalQuantity || 0,
                itemsCount: (data.items || []).length,
                total: Utils.formatMoney(data.totalPrice)
            });
            // Update savings globally (cart page + drawer)
            document.querySelectorAll('[data-cart-savings-row]').forEach(function (row) {
                var el = row.querySelector('[data-cart-savings]');
                if (data.totalSavings && data.totalSavings > 0) {
                    if (el) el.textContent = '-' + Utils.formatMoney(data.totalSavings);
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        },

        _refreshDrawer(data) {
            var container = document.querySelector('[data-cart-container]');
            var footer = document.querySelector('[data-cart-footer]');
            var empty = document.querySelector('[data-cart-empty]');
            var countBar = document.querySelector('[data-cart-count-bar]');
            var items = data.items || [];

            if (items.length > 0) {
                var itemIds = items.map(function (i) { return i._id; });

                // Update item totals + compare prices
                items.forEach(function (item) {
                    document.querySelectorAll('[data-item-total="' + item._id + '"]').forEach(function (el) {
                        el.textContent = Utils.formatMoney(item.totalPrice);
                    });
                    document.querySelectorAll('[data-item-compare="' + item._id + '"]').forEach(function (el) {
                        var onSale = !!(item.totalCompareAtPrice && item.compareAtPrice > item.price);
                        if (onSale) {
                            el.textContent = Utils.formatMoney(item.totalCompareAtPrice);
                            el.style.display = '';
                        } else {
                            el.style.display = 'none';
                        }
                        /* `is-sale` is what paints the line total in the sale
                           colour. It has to move with the compare price, or a
                           line that stops being discounted keeps the colour. */
                        var money = el.closest('.hy-citem-money');
                        if (money) money.classList.toggle('is-sale', onSale);
                    });
                });

                // Add new items that don't exist in DOM yet
                if (container) {
                    // [data-cart-list] is the explicit hook; .space-y-4 is the
                    // legacy fallback, and the container itself the last resort —
                    // otherwise a class rename silently stops new rows appearing.
                    var listEl = container.querySelector('[data-cart-list]')
                        || container.querySelector('.space-y-4')
                        || container;
                    if (listEl) {
                        items.forEach(function (item) {
                            if (!container.querySelector('[data-cart-item="' + item._id + '"]')) {
                                var html = CartManager._buildItemHTML(item);
                                var temp = document.createElement('div');
                                temp.innerHTML = html;
                                while (temp.firstChild) {
                                    var node = temp.firstChild;
                                    listEl.appendChild(node);
                                    if (window.Alpine && node.nodeType === 1) {
                                        Alpine.initTree(node);
                                    }
                                }
                            }
                        });
                    }
                }

                // Remove items from DOM that no longer exist in cart
                if (container) {
                    container.querySelectorAll('[data-cart-item]').forEach(function (el) {
                        var id = el.getAttribute('data-cart-item');
                        if (itemIds.indexOf(id) === -1) {
                            el.style.transition = 'all 0.4s ease';
                            el.style.opacity = '0';
                            setTimeout(function () { el.remove(); }, 400);
                        }
                    });
                    container.style.display = '';
                }

                // Update footer total + savings
                if (footer) {
                    footer.style.display = '';
                    var totalEl = footer.querySelector('[data-cart-total]');
                    if (totalEl) totalEl.textContent = Utils.formatMoney(data.totalPrice);

                    var savingsRow = footer.querySelector('[data-cart-savings-row]');
                    var savingsEl = footer.querySelector('[data-cart-savings]');
                    if (savingsRow && savingsEl) {
                        if (data.totalSavings && data.totalSavings > 0) {
                            savingsEl.textContent = '-' + Utils.formatMoney(data.totalSavings);
                            savingsRow.style.display = '';
                        } else {
                            savingsRow.style.display = 'none';
                        }
                    }
                }

                // Update count bar
                if (countBar) {
                    countBar.style.display = '';
                    var countEl = countBar.querySelector('[data-cart-count]');
                    if (countEl) countEl.textContent = data.totalQuantity || 0;
                }

                // Free-shipping progress
                CartManager._refreshShipBar(data.totalPrice || 0);

                // Hide empty state
                if (empty) empty.style.display = 'none';
            } else {
                // No items - show empty state
                if (container) container.style.display = 'none';
                if (footer) footer.style.display = 'none';
                if (countBar) countBar.style.display = 'none';
                if (empty) empty.style.display = '';
                var ship = document.querySelector('[data-cart-ship]');
                if (ship) ship.style.display = 'none';
            }
        },

        /* ---- Free-shipping progress ----
           The merchant types the threshold in whole currency units; the cart's
           totals are in minor ones. `_moneyFormat.scale` is the bridge, and it
           is DETECTED from a rendered probe rather than assumed to be 100 — a
           currency with no decimal places would otherwise be out by 100×.

           ui/cart.njk renders this bar server-side with a hardcoded 100 so the
           first paint is not blank. This runs on load as well as on every cart
           change, so that assumption only has to survive one frame. */
        _refreshShipBar(totalMinor) {
            var bar = document.querySelector('[data-cart-ship]');
            if (!bar) return;

            var target = parseFloat(bar.getAttribute('data-ship-target')) || 0;
            if (target <= 0) { bar.style.display = 'none'; return; }
            bar.style.display = '';

            var targetMinor = target * _moneyFormat.scale;
            var left = targetMinor - totalMinor;
            var pct = targetMinor > 0 ? Math.round((totalMinor / targetMinor) * 100) : 100;
            if (pct > 100) pct = 100;
            if (pct < 0) pct = 0;

            var fill = bar.querySelector('[data-ship-fill]');
            if (fill) fill.style.width = pct + '%';

            var track = bar.querySelector('[role="progressbar"]');
            if (track) track.setAttribute('aria-valuenow', String(pct));

            var msg = bar.querySelector('[data-ship-msg]');
            if (!msg) return;
            var t = (config.cart || {});
            if (left > 0) {
                msg.classList.remove('is-done');
                /* The template placeholder is `{amount}` — the same token
                   locales/*.json uses, so the string can be edited in one place
                   and still work from either renderer. */
                msg.textContent = String(t.freeShipLeft || '')
                    .replace('{amount}', Utils.formatMoney(left));
            } else {
                msg.classList.add('is-done');
                msg.textContent = t.freeShipDone || '';
            }
        },

        /* Delegates to HayatCartItem — the single JS cart-line renderer.
           Do not inline cart markup here again. */
        _buildItemHTML(item) {
            return HayatCartItem.build(item);
        }

    };

    // ===== SearchManager =====
    const SearchManager = {
        async search(query, filters) {
            const params = { q: query, ...filters };
            return ApiClient.get(QumraConfig.api.search.products, params);
        },

        suggest: Utils.debounce(async function (query, callback, limit) {
            if (!query || query.length < 2) return;
            const data = await ApiClient.get(QumraConfig.api.search.suggest, {
                q: query,
                limit: limit || 5
            });
            if (callback) callback(data);
            return data;
        }, 300),

        debounce: Utils.debounce
    };

    // ===== WishlistManager =====
    const WishlistManager = {
        async add(productId) {
            const data = await ApiClient.post('/ajax/wishlist/add', { productId });
            this._emit(data);
            return data;
        },

        async remove(productId) {
            const data = await ApiClient.post('/ajax/wishlist/remove', { productId });
            this._emit(data);
            return data;
        },

        async toggle(productId, isInWishlist) {
            return isInWishlist ? this.remove(productId) : this.add(productId);
        },

        _emit(data) {
            document.querySelectorAll('[data-wishlist-count]').forEach(el => {
                el.textContent = data.count || 0;
            });
            EventBus.emit('wishlist:updated', data);
        }
    };

    // ===== ProductManager =====
    const ProductManager = {
        async get(handle) {
            return ApiClient.get(QumraConfig.api.product.get, { handle });
        },

        async getVariant(productId, selectedOptions, quantity) {
            return ApiClient.post(QumraConfig.api.product.variant, {
                productId,
                options: selectedOptions,
                quantity: quantity || 1
            });
        },

        calculatePrice(variant, quantity) {
            return {
                price: variant.price * (quantity || 1),
                compareAtPrice: (variant.compareAtPrice || 0) * (quantity || 1)
            };
        }
    };

    /* ======================================================================
       VARIANT ENGINE — shared by widgets/product-detail and
       widgets/quick-view-product. Both spread it into their Alpine component
       so the buy logic can only ever exist in one place.

       ⚠️  Two things about Qumra's payload that this exists to absorb:

       1. `variant.options` is an array of OBJECTS ({_id, label, value, …}),
          NOT an array of option-value ids. Matching a selected id against it
          with indexOf() compares a string to an object, never matches, and
          leaves the product addable with no resolved variant — an order lands
          with no way to tell which size was bought and no stock to deduct.

       2. `variant.pricing` can be `{}`. A variant with no pricing of its own
          inherits the product's, so a missing number must fall back rather
          than render the item as free.

       The engine also refuses to add anything until every option group has a
       choice, so the shopper picks a variant instead of the theme guessing.
       ====================================================================== */
    function HayatVariants(cfg) {
        cfg = cfg || {};

        var base = {
            price: num(cfg.price, 0),
            compareAtPrice: num(cfg.compareAtPrice, 0),
            quantity: num(cfg.quantity, 0),
            trackQuantity: !!cfg.trackQuantity,
            allowBackorder: !!cfg.allowBackorder
        };
        var groups = cfg.groups || [];          /* [{ name, values: [{id, label}] }] */
        var strings = cfg.strings || {};

        function num(v, fallback) {
            var n = Number(v);
            return isFinite(n) ? n : fallback;
        }

        /* one shape for both payload styles: ids, or the objects Qumra sends */
        function valueIdsOf(v) {
            return (v.options || []).map(function (o) {
                return (o && typeof o === 'object') ? String(o._id || o.id || '') : String(o);
            }).filter(Boolean);
        }

        var variants = (cfg.variants || []).map(function (v) {
            return {
                id: v.id,
                price: num(v.price, base.price) || base.price,
                compareAtPrice: num(v.compareAtPrice, base.compareAtPrice),
                quantity: num(v.quantity, 0),
                available: (v.available === null || v.available === undefined) ? null : num(v.available, 0),
                trackQuantity: !!v.trackQuantity,
                allowBackorder: !!v.allowBackorder,
                /* Index into the product's own gallery, resolved server-side.
                   -1 = this variant has no photo of its own, which is a real
                   answer: leave the gallery where the shopper left it rather
                   than snapping it back to the first image. */
                imageIndex: (typeof v.imageIndex === 'number') ? v.imageIndex : -1,
                valueIds: valueIdsOf(v)
            };
        }).filter(function (v) { return v.valueIds.length > 0; });

        /* Measured against the real endpoint, not assumed. A VARIANT is judged on
           `allowBackorder || available > 0` — `trackQuantity: false` does NOT make
           it unlimited the way it does at product level. Posting a value whose
           variant has available 0 and no backorder comes back
           `success:false, order.product_out_of_stock`, so the client has to reach
           the same verdict or it offers a button the server will refuse. */
        function availableOf(v) {
            return (v.available === null || v.available === undefined) ? v.quantity : v.available;
        }
        function purchasable(v) {
            return v.allowBackorder ? true : availableOf(v) > 0;
        }
        function stockOf(v) {
            return v.allowBackorder ? null : availableOf(v);   /* null = uncapped */
        }

        return {
            qty: 1,
            selectedOptions: {},        /* option name -> value id */
            selectedLabels: {},         /* option name -> value label */
            currentVariantId: null,
            currentVariantQuantity: base.quantity,
            /* The product's own SKU until a variant is resolved. `variant.sku`
               is documented (docs/qalab/variables.md) but was never carried
               through, so the page kept showing the parent code however many
               times the shopper changed the combination — a number a customer
               quotes back in support, and the wrong one. */
            currentSku: base.sku || '',
            /* Filled by the host widget from /ajax/cart. Empty is the honest
               default: an unknown cart must not tighten the cap. */
            cartLines: [],
            unitPrice: base.price,
            unitComparePrice: base.compareAtPrice,
            discountPercent: base.compareAtPrice > base.price
                ? Math.floor(((base.compareAtPrice - base.price) / base.compareAtPrice) * 100) : 0,
            isOutOfStock: !((!base.trackQuantity || base.allowBackorder) || base.quantity > 0),
            comboUnavailable: false,
            addingToCart: false,
            addedSuccess: false,
            formError: '',

            _groups: groups,
            _variants: variants,
            _base: base,
            _strings: strings,

            /* ---------- selection ---------- */

            /* Deliberately selects NOTHING. Pre-picking the first size makes the
               shopper's choice invisible and ships whatever the theme guessed. */
            initVariants() { this.matchVariant(); },

            selectOption(name, valueId, label) {
                if (this.valueDisabled(name, valueId)) return;
                this.selectedOptions[name] = valueId;
                this.selectedLabels[name] = label;
                this.formError = '';
                this.matchVariant();
            },

            missingOptions() {
                var sel = this.selectedOptions;
                return this._groups
                    .filter(function (g) { return !sel[g.name]; })
                    .map(function (g) { return g.name; });
            },

            selectionComplete() { return this.missingOptions().length === 0; },

            /* Is this value reachable at all, given what is already chosen in the
               OTHER groups? Answering per-value is what lets a sold-out size be
               struck through instead of failing at the add step. */
            valueDisabled(name, valueId) {
                if (!this._variants.length) return false;
                var sel = Object.assign({}, this.selectedOptions);
                sel[name] = valueId;
                var wanted = Object.keys(sel).map(function (k) { return sel[k]; });
                return !this._variants.some(function (v) {
                    for (var i = 0; i < wanted.length; i++) {
                        if (v.valueIds.indexOf(wanted[i]) === -1) return false;
                    }
                    return purchasable(v);
                });
            },

            matchVariant() {
                var self = this;

                if (!this._variants.length) { this.comboUnavailable = false; return; }

                if (!this.selectionComplete()) {
                    /* fall back to the product's own figures while undecided */
                    this.currentVariantId = null;
                    this.comboUnavailable = false;
                    this.unitPrice = this._base.price;
                    this.unitComparePrice = this._base.compareAtPrice;
                    this.currentVariantQuantity = this._base.quantity;
                    this.currentSku = this._base.sku || '';
                    this.discountPercent = this._base.compareAtPrice > this._base.price
                        ? Math.floor(((this._base.compareAtPrice - this._base.price) / this._base.compareAtPrice) * 100) : 0;
                    /* Undecided is not the same as available: if NO variant can be
                       bought, every value is struck through and the shopper can
                       never complete a selection. Say "sold out" now instead of
                       leaving them clicking at a wall. */
                    this.isOutOfStock = !this._variants.some(purchasable);
                    return;
                }

                var wanted = Object.keys(this.selectedOptions).map(function (k) { return self.selectedOptions[k]; });
                var matched = this._variants.find(function (v) {
                    if (v.valueIds.length !== wanted.length) return false;
                    for (var i = 0; i < wanted.length; i++) {
                        if (v.valueIds.indexOf(wanted[i]) === -1) return false;
                    }
                    return true;
                });

                if (!matched) {
                    /* a real state, not a no-op: the shopper picked a pair that was
                       never built, and the old code returned silently and let the
                       add go through against the previous variant. */
                    this.comboUnavailable = true;
                    this.currentVariantId = null;
                    this.isOutOfStock = true;
                    this.formError = strings.comboUnavailable || '';
                    return;
                }

                this.comboUnavailable = false;
                this.formError = '';
                this.currentVariantId = matched.id;
                this.unitPrice = matched.price;
                this.currentVariantQuantity = matched.quantity;
                /* Falls back to the parent when a variant carries none — an
                   empty line reads as data loss, the parent code does not. */
                this.currentSku = matched.sku || this._base.sku || '';
                this.isOutOfStock = !purchasable(matched);

                if (matched.compareAtPrice && matched.compareAtPrice > matched.price) {
                    this.unitComparePrice = matched.compareAtPrice;
                    this.discountPercent = Math.floor(((matched.compareAtPrice - matched.price) / matched.compareAtPrice) * 100);
                } else {
                    this.unitComparePrice = 0;
                    this.discountPercent = 0;
                }

                var cap = stockOf(matched);
                if (cap !== null && this.qty > cap) this.qty = Math.max(1, cap);
            },

            /* ---------- quantity ---------- */

            /* How many of THIS combination are already in the cart.
               Matches on the documented cart-line shape — `productId` and
               `variantId` — and on nothing else: an earlier reader in the PDP
               matched `item.product` and `item.productData._id`, neither of
               which a Qumra line has, and so never matched anything.
               A line with no variantId belongs to the product itself, which is
               the right answer for a product that has no options. */
            cartQty() {
                var pid = cfg.productId;
                var vid = this.currentVariantId || null;
                return (this.cartLines || []).reduce(function (sum, l) {
                    if (l.productId !== pid) return sum;
                    if ((l.variantId || null) !== vid) return sum;
                    return sum + (l.quantity || 0);
                }, 0);
            },

            /* The ceiling is what the shopper may still take, not what the shop
               owns. Stock minus what is already in their cart — otherwise five
               units can be added five at a time without end, and the label
               "only 5 left" sits above a cart holding forty. */
            /* The shop's own ceiling for whatever is selected. null = uncapped
               (untracked at product level, or on backorder). */
            _stockCap() {
                if (this.currentVariantId) {
                    var self = this;
                    var v = this._variants.find(function (x) { return x.id === self.currentVariantId; });
                    return v ? stockOf(v) : null;
                }
                if (this._variants.length) return null;      /* undecided — no cap yet */
                return (!this._base.trackQuantity || this._base.allowBackorder)
                    ? null : this._base.quantity;
            },

            maxQty() {
                var stock = this._stockCap();
                if (stock === null) return null;             /* uncapped stays uncapped */
                /* Never below 1: a cap of 0 would disable the stepper at a
                   quantity the shopper cannot lower to, and the add itself is
                   already blocked by isOutOfStock. */
                return Math.max(1, stock - this.cartQty());
            },

            /* The same subtraction as `maxQty`, for anything the shopper READS.
               `maxQty` cannot be reused for a label because of the floor above:
               it never returns 0, so a cart already holding the last unit still
               produced "only 1 left". That floor is right for a stepper and
               wrong for a sentence.

               This is what stops the page saying "بقي ٢ فقط" over "المتاح من
               هذا الخيار ١ فقط" — two true numbers that contradict each other,
               because one counted the shop's shelf and the other the shelf
               minus the shopper's own cart. null = uncapped, so nothing to
               count. */
            availableNow() {
                var stock = this._stockCap();
                if (stock === null) return null;
                return Math.max(0, stock - this.cartQty());
            },

            incQty() {
                var cap = this.maxQty();
                if (cap !== null && this.qty >= cap) {
                    /* the MESSAGE reports what is really left, not the capped
                       stepper value — `maxQty` floors at 1, so a cart already
                       holding every unit otherwise announced "only 1 left" */
                    this.formError = String(strings.maxQty || '').replace('{count}', this.availableNow());
                    return;
                }
                this.formError = '';
                this.qty = this.qty + 1;
            },

            decQty() { this.formError = ''; this.qty = Math.max(1, this.qty - 1); },

            /* ---------- money ---------- */

            /* formatPrice, not formatMoney — a zero-priced product reads "Free".
               The line TOTAL uses it too: qty × 0 is still free, and printing
               "0.00" beside a stepper reads as a bug rather than a gift. */
            displayPrice() { return window.formatPrice ? window.formatPrice(this.unitPrice * this.qty) : ''; },
            displayUnitPrice() { return window.formatPrice ? window.formatPrice(this.unitPrice) : ''; },
            displayComparePrice() {
                if (!this.unitComparePrice || this.unitComparePrice <= this.unitPrice) return '';
                return window.formatMoney ? window.formatMoney(this.unitComparePrice * this.qty) : '';
            },
            displaySavings() {
                if (!this.unitComparePrice || this.unitComparePrice <= this.unitPrice) return '';
                return window.formatMoney ? window.formatMoney((this.unitComparePrice - this.unitPrice) * this.qty) : '';
            },
            hasDiscount() { return !!(this.unitComparePrice && this.unitComparePrice > this.unitPrice); },

            /* ---------- add ---------- */

            /* The button stays clickable while the selection is incomplete — a
               disabled button explains nothing, and the shopper is owed the
               reason, not a dead control. It is only truly disabled once the
               answer is "you cannot buy this", which the label then states. */
            addDisabled() {
                /* `availableNow() === 0` belongs here for the same reason
                   `isOutOfStock` does: the answer really is "you cannot add
                   this", and the line above the button now says why (the shop
                   has stock, the shopper is holding all of it). Without it the
                   button stayed live and every click was refused by the guard
                   in validateBeforeAdd — a control that does nothing, which is
                   exactly what the comment above says not to ship. */
                return this.addingToCart || this.comboUnavailable || this.isOutOfStock
                    || this.availableNow() === 0;
            },

            /* returns false and sets formError when the add must not happen */
            validateBeforeAdd() {
                /* Stock first: when nothing is buyable, "please choose a colour"
                   is a lie — there is no colour left to choose. */
                if (this.isOutOfStock) {
                    this.formError = strings.outOfStock || '';
                    return false;
                }
                if (this.comboUnavailable) {
                    this.formError = strings.comboUnavailable || '';
                    return false;
                }
                var missing = this.missingOptions();
                if (missing.length) {
                    this.formError = String(strings.selectOptionsFirst || '')
                        .replace('{options}', missing.join(strings.listSeparator || ', '));
                    return false;
                }
                /* ⚠️  `availableNow()`, NOT `maxQty()`.
                   `maxQty` floors at 1 so the stepper never caps at a number it
                   cannot be lowered to — correct for a stepper, and a hole here:
                   with 2 in stock and 2 already in the cart it returned 1, so
                   `qty > cap` read `1 > 1` = false and the add went through. The
                   next click faced the same floored 1 and went through too, so a
                   single unit could be added over and over without end.
                   `availableNow()` floors at 0, which is the truth this guard
                   needs. The stepper keeps its own floor below. */
                var left = this.availableNow();
                if (left !== null && this.qty > left) {
                    this.qty = Math.max(1, left);
                    this.formError = String(strings.maxQty || '').replace('{count}', left);
                    return false;
                }
                return true;
            },

            /* ⚠️  /ajax/cart/add resolves the variant from `options: [valueIds]`
               and from nothing else. Probed against the live endpoint:

                 {options:[valueId]}   → resolves it (and refuses when sold out)
                 {variantId: "..."}    → 201, item.variantId = null
                 {variant:   "..."}    → 201, item.variantId = null
                 {productId} alone     → 201, item.variantId = null

               So every shape except `options` quietly creates a line with no
               variant on it — the order the bug report describes. `variantId` is
               resolved locally for price and stock only; it must never be what
               gets posted. */
            _cartPayload() {
                var sel = this.selectedOptions;
                var ids = Object.keys(sel).map(function (k) { return sel[k]; });
                return ids.length ? ids : null;
            },

            async _add() {
                if (this.addingToCart) return false;
                if (!this.validateBeforeAdd()) return false;
                this.addingToCart = true;
                this.formError = '';
                try {
                    await Qumra.cart.add(cfg.productId, this.qty, this._cartPayload());
                    return true;
                } catch (err) {
                    /* Same sentence the toast shows — CartManager._errorMessage
                       also turns keys like `order.product_out_of_stock` into
                       something a shopper can read. Repeated inline so the reason
                       stays next to the button that refused instead of fading. */
                    this.formError = (Qumra.cart && Qumra.cart._errorMessage)
                        ? Qumra.cart._errorMessage(err)
                        : ((err && err.message) || strings.addError || '');
                    return false;
                } finally {
                    this.addingToCart = false;
                }
            },

            async addToCart() {
                var self = this;
                var ok = await this._add();
                if (!ok) return;
                this.addedSuccess = true;
                setTimeout(function () { self.addedSuccess = false; }, 2000);
            },

            /* Buy Now goes to CHECKOUT, not to /cart.
               A shopper who presses it has already decided; routing them to the
               cart hands them the same decision a second time and adds a click
               to the shortest path in the shop. /cart is what "add to cart"
               leads to — the two buttons exist because they mean different
               things, and sending both to the same place erased the difference.

               The route is real: ui/cart.njk links to it and cart-page carries
               it as `checkout_url`. */
            async buyNow() {
                var ok = await this._add();
                if (ok) window.location.href = '/checkout';
            }
        };
    }

    // ===== ModalController =====
    const ModalController = {
        current: null,

        open(name) {
            this.current = name;
            document.body.style.overflow = 'hidden';
            EventBus.emit('modal:open', { name });
        },

        close() {
            const name = this.current;
            this.current = null;
            document.body.style.overflow = '';
            EventBus.emit('modal:close', { name });
        },

        toggle(name) {
            if (this.current === name) {
                this.close();
            } else {
                this.close();
                this.open(name);
            }
        }
    };

    /* Esc closes whatever overlay is open.
       ------------------------------------------------------------------
       Registered ONCE here rather than per component, because every overlay in
       the theme — the mobile drawer, the cart drawer, the search sheet, the
       filters drawer, the quick view — is driven by this one controller and by
       `$store.modal.current`. A per-component `@keydown.escape.window` would be
       five listeners that each have to be remembered when a sixth overlay is
       added; only the header's search dropdown had one, so Esc did nothing on
       any of the others.

       `close()` emits `modal:close`, which the Alpine bridge below already
       listens for to clear `$store.modal.current` — so the markup follows
       without any of it needing to know a key was pressed.

       Guarded on `current`: with nothing open this must not run, or it would
       clear body.style.overflow that something else may have set. */
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        if (!ModalController.current) return;
        ModalController.close();
    });

    /* =========================================================================
       Marquee — the measured infinite strip
       -------------------------------------------------------------------------
       Shared by every section that scrolls text forever, so the measuring lives
       in one place instead of being pasted per widget.

       Why measured and not `translateX(-50%)` on a duplicated group: the naive
       recipe only looks continuous when the content is ALREADY wider than the
       viewport. Three short phrases on a wide monitor leave a gap that marches
       across the screen once per cycle. So the group is cloned until the track
       is at least twice the viewport wide, and the shift is one group's
       measured width in pixels — exactly one period of a repeating pattern, so
       the wrap is invisible at any content length and any screen size.

       The duration is derived from that width too, so SPEED IS CONSTANT: a
       fixed `30s` makes one short phrase crawl and six long ones sprint, which
       is the first thing a merchant notices after editing the copy.

       Call: HayatMarquee(stripEl, trackEl, pxPerSecond)
       The track must contain exactly one child — the group to repeat.
       ====================================================================== */
    function Marquee(strip, track, pxPerSec) {
        if (!strip || !track) return;
        var original = track.firstElementChild;
        if (!original) return;
        var speed = pxPerSec || 60;

        function build() {
            /* Drop previous clones before measuring — measuring a track that
               still holds the last build's clones compounds on every resize. */
            while (track.children.length > 1) track.removeChild(track.lastElementChild);

            var groupW = original.getBoundingClientRect().width;
            var viewW = strip.getBoundingClientRect().width;
            if (!groupW || !viewW) return;

            /* After translating by one group width the visible window reads
               from groupW to groupW + viewW, so the track must be at least
               that wide. */
            var needed = Math.max(2, Math.ceil((viewW * 2) / groupW) + 1);
            for (var i = 1; i < needed; i++) {
                var clone = original.cloneNode(true);
                /* Clones are decoration. Without this a screen reader reads the
                   phrase as many times as the screen happens to be wide. */
                clone.setAttribute('aria-hidden', 'true');
                track.appendChild(clone);
            }

            track.style.setProperty('--mq-shift', groupW + 'px');
            track.style.setProperty('--mq-dur', (groupW / speed) + 's');
        }

        build();
        /* These strips are set in a serif that arrives after first paint and
           the group's width changes with it — measuring once leaves the shift
           wrong by however much the fallback font differed. */
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);

        var t;
        window.addEventListener('resize', function () {
            clearTimeout(t);
            t = setTimeout(build, 150);
        });
    }

    // ===== Qumra Namespace =====
    const Qumra = {
        config: QumraConfig,
        events: EventBus,
        api: ApiClient,
        cart: CartManager,
        wishlist: WishlistManager,
        search: SearchManager,
        product: ProductManager,
        modal: ModalController,
        utils: Utils,
        toast: Toast,
        card: HayatCard,
        cartItem: HayatCartItem
    };

    // ===== Global Exports =====
    window.Qumra = Qumra;
    /* The single JS product-card renderer — every widget that renders products
       from JSON must call HayatCard.build() / .mount() instead of its own HTML. */
    /* ===== HayatRail =====
       The tabbed scroll rail two sections share: a heading with an optional tab
       strip, a horizontally scrolling track, and a progress bar and arrows that
       describe whichever track is in view.

       It lives here rather than inline in each widget because the two are the
       same behaviour over different cards — collection tiles in one, product
       cards in the other — and a second copy of it would be a second place for
       the RTL arithmetic below to be got wrong.

       ⚠️  `scrollLeft` counts DOWN from 0 in RTL — it goes negative as the rail
       moves. Every read is wrapped in Math.abs() for that reason; a raw
       comparison leaves the bar pinned at 0 for the whole of an Arabic page.

       Markup contract — a widget opts in by rendering:
         [data-hy-rail-root]          the section
         [data-hy-rail="<n>"]         one track per tab
         [data-hy-tab="<n>"]          one button per tab   (optional)
         [data-hy-bar]                the progress fill    (optional)
         [data-hy-prev] [data-hy-next]                     (optional)
       ===== */
    const HayatRail = {
        init(root) {
            if (!root || root.__hyRail) return;
            root.__hyRail = true;

            var rails = root.querySelectorAll('[data-hy-rail]');
            if (!rails.length) return;
            var tabs = root.querySelectorAll('[data-hy-tab]');
            var bar = root.querySelector('[data-hy-bar]');
            var prev = root.querySelector('[data-hy-prev]');
            var next = root.querySelector('[data-hy-next]');
            var current = rails[0];

            function pos(el) { return Math.abs(el.scrollLeft); }
            function span(el) { return Math.max(1, el.scrollWidth - el.clientWidth); }

            function sync() {
                var scrollable = span(current) > 1;
                if (bar) {
                    /* A rail with nothing to scroll shows a FULL bar, not a
                       stub: the stub means "there is more this way", and on a
                       tab whose cards all fit that would be a promise the rail
                       cannot keep. Otherwise the fill has a floor, so the bar
                       reads as a bar at rest rather than as an empty groove. */
                    var p = pos(current) / span(current);
                    if (p > 1) p = 1;
                    var seen = current.clientWidth / Math.max(1, current.scrollWidth);
                    var floor = Math.min(0.28, Math.max(0.12, seen * 0.4));
                    var v = scrollable ? floor + (1 - floor) * p : 1;
                    bar.style.transform = 'scaleX(' + v.toFixed(4) + ')';
                }
                /* Disabled rather than hidden: the control keeps its place, so
                   the row does not reflow when a fuller tab is picked. */
                if (prev) prev.disabled = !scrollable || pos(current) <= 1;
                if (next) next.disabled = !scrollable || pos(current) >= span(current) - 1;
            }

            /* One "page" is everything in view less one card, so the card at the
               edge stays on screen as an anchor — a full-width jump loses the
               shopper's place. */
            function page(dir) {
                var card = current.firstElementChild;
                var step = current.clientWidth - (card ? card.offsetWidth : 0);
                if (step < 80) step = current.clientWidth;
                var rtl = getComputedStyle(current).direction === 'rtl';
                current.scrollBy({ left: (rtl ? -dir : dir) * step, behavior: 'smooth' });
            }

            for (var i = 0; i < rails.length; i++) {
                rails[i].addEventListener('scroll', function () {
                    if (this === current) sync();
                }, { passive: true });
            }
            if (prev) prev.addEventListener('click', function () { page(-1); });
            if (next) next.addEventListener('click', function () { page(1); });

            for (var j = 0; j < tabs.length; j++) {
                tabs[j].addEventListener('click', function () {
                    var n = this.getAttribute('data-hy-tab');
                    for (var k = 0; k < tabs.length; k++) {
                        var on = tabs[k] === this;
                        tabs[k].classList.toggle('is-active', on);
                        tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
                    }
                    for (var m = 0; m < rails.length; m++) {
                        var show = rails[m].getAttribute('data-hy-rail') === n;
                        rails[m].hidden = !show;
                        if (show) current = rails[m];
                    }
                    /* Back to the beginning: the bar and the arrows describe the
                       rail in view, and leaving a new tab where the last one was
                       would make both of them lie. */
                    current.scrollTo({ left: 0, behavior: 'auto' });
                    sync();
                });
            }

            sync();
            window.addEventListener('resize', sync);
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
        },

        initAll(scope) {
            var roots = (scope || document).querySelectorAll('[data-hy-rail-root]');
            for (var i = 0; i < roots.length; i++) this.init(roots[i]);
        }
    };

    /* The Theme Editor re-injects a section's markup on every edit, so binding
       once on DOMContentLoaded would leave an edited rail dead. `init` is
       idempotent — it flags the root — so re-running it is free. */
    document.addEventListener('DOMContentLoaded', function () { HayatRail.initAll(); });
    document.addEventListener('shopify:section:load', function (e) { HayatRail.initAll(e.target); });

    /* ======================================================================
       HayatAuto — an empty product or collection picker borrows the store's own
       ----------------------------------------------------------------------
       A section whose picker is empty renders its skeleton marked with a
       `data-hy-auto-*` hook, and fills it from here, so a fresh store looks
       stocked instead of grey. Anything the merchant picks is server-rendered
       and never touched.

       ONE request per kind for the whole page, shared through a promise, and
       each caller `take()`s the NEXT run of it — two sections side by side do
       not show the same four products while the store has more.

       ⚠️  No `limit` on the search. The endpoint passes it to a Mongo `$limit`
       as a STRING and answers "Expected a number" — every request that sent
       one failed, which is why the product rail's old fallback never filled.
       Without it the endpoint returns its default page.

       Collections have no AJAX endpoint at all. `/collections` is rendered by
       this theme's own collections-page widget, which stamps each tile with
       `data-hy-coll-*`; fetching that page and reading the stamps is the one
       place the list exists.
       ====================================================================== */
    const HayatAuto = {
        _p: null,
        _c: null,
        _pUsed: 0,
        _cUsed: 0,

        products() {
            if (!this._p) {
                this._p = SearchManager.search('', { sort: 'created-desc' })
                    .then(function (d) { return (d && (d.products || d.data || d.results)) || []; })
                    .catch(function () { return []; });
            }
            return this._p;
        },

        collections() {
            if (!this._c) {
                /* A theme PREVIEW is `?theme=<id>` on the store's own URL. Fetched
                   bare, /collections renders with the LIVE theme, which carries
                   no `data-hy-coll-*` stamps — so every collection slot stayed
                   grey in preview. Pass the id through. */
                var theme = new URLSearchParams(location.search).get('theme');
                var url = '/collections' + (theme ? '?theme=' + encodeURIComponent(theme) : '');
                this._c = fetch(url, { credentials: 'same-origin' })
                    .then(function (r) { return r.ok ? r.text() : ''; })
                    .then(function (html) {
                        var doc = new DOMParser().parseFromString(html, 'text/html');
                        return [].map.call(doc.querySelectorAll('[data-hy-coll]'), function (el) {
                            return {
                                title: el.getAttribute('data-hy-coll-title') || '',
                                url: el.getAttribute('data-hy-coll-url') || '#',
                                image: el.getAttribute('data-hy-coll-img') || '',
                                count: Number(el.getAttribute('data-hy-coll-count') || 0)
                            };
                        });
                    })
                    .catch(function () { return []; });
            }
            return this._c;
        },

        /* The next `n` from where the previous caller stopped, wrapping round —
           but never the same item twice in one answer. */
        _run(list, start, n) {
            var out = [];
            if (!list.length) return out;
            n = Math.min(n, list.length);
            for (var i = 0; i < n; i++) out.push(list[(start + i) % list.length]);
            return out;
        },

        take(n) {
            var self = this;
            return this.products().then(function (list) {
                var run = self._run(list, self._pUsed, n);
                self._pUsed += run.length;
                return run;
            });
        },

        takeCollections(n) {
            var self = this;
            return this.collections().then(function (list) {
                var run = self._run(list, self._cUsed, n);
                self._cUsed += run.length;
                return run;
            });
        },

        /* The list payload carries NO options or variants, and a product with
           options cannot be added blind (see split-slider). Sections that put a
           cart button on an item ask for the full record first. */
        _full: {},
        full(p) {
            var handle = p && (p.slug || p.handle);
            if (!handle) return Promise.resolve(p);
            if (!this._full[handle]) {
                this._full[handle] = ProductManager.get(handle)
                    .then(function (d) { return (d && (d.data || d.product)) || p; })
                    .catch(function () { return p; });
            }
            return this._full[handle];
        },

        hasOptions(p) {
            return !!((p.options && p.options.length) || (p.variants && p.variants.length) ||
                (p.variantsCount && p.variantsCount > 0));
        },

        inStock(p) {
            return !!(p.allowBackorder || !p.trackQuantity || p.variantsCount || (p.options && p.options.length) || p.quantity > 0);
        },

        url(p) {
            return '/products/' + encodeURIComponent(p.slug || p.handle || p._id);
        },

        img(p) {
            return (p.images && p.images[0] && p.images[0].fileUrl) || '';
        },

        /* Product-card grids: `data-hy-auto-cards="4"` on a grid of skeleton
           cards, plus optional `data-hy-auto-ratio`. Filled with the shared
           HayatCard, so an auto card and a picked one are the same card. */
        fillCards(scope) {
            var grids = (scope || document).querySelectorAll('[data-hy-auto-cards]:not([data-hy-auto-done])');
            [].forEach.call(grids, function (grid) {
                grid.setAttribute('data-hy-auto-done', '');
                var n = Number(grid.getAttribute('data-hy-auto-cards')) || 4;
                var opts = { variant: 'catalog', showEyebrow: false };
                var ratio = grid.getAttribute('data-hy-auto-ratio');
                if (ratio) opts.imageRatio = ratio;
                HayatAuto.take(n).then(function (list) {
                    if (!list.length) return;              /* skeleton stays */
                    grid.innerHTML = list.map(function (p) { return HayatCard.build(p, opts); }).join('');
                });
            });
        }
    };
    document.addEventListener('DOMContentLoaded', function () { HayatAuto.fillCards(); });

    /* A store with nothing to show must not show customers grey skeletons named
       «اسم المنتج»: once the auto-fill has answered, a section still holding
       placeholders is removed on the live store. The builder keeps them, since
       that's where the merchant needs to see the shape. */
    document.addEventListener('DOMContentLoaded', function () {
        var main = document.getElementById('hy-main');
        if (!main || !document.documentElement.classList.contains('hy-live')) return;
        var waiting = function (el) { return !el.closest('[data-blogs-grid], .hy-editor-only') && el.offsetParent !== null; };
        if (![].some.call(main.querySelectorAll('[data-hy-placeholder]'), waiting)) return;
        Promise.all([HayatAuto.products(), HayatAuto.collections()]).then(function (r) {
            var noProducts = !r[0].length, noCollections = !r[1].length;
            if (!noProducts && !noCollections) return;
            setTimeout(function () {
                main.querySelectorAll('[data-hy-placeholder]').forEach(function (el) {
                    if (el.closest('[data-blogs-grid], .hy-editor-only')) return;
                    var section = el.closest('section');
                    if (section && (noProducts || el.matches('.hy-cr-card, .hy-ct-card'))) section.hidden = true;
                });
            }, 300);
        });
    });
    window.HayatAuto = HayatAuto;

    window.HayatRail = HayatRail;
    window.HayatCard = HayatCard;
    /* The one marquee implementation — see the note on Marquee above. */
    window.HayatMarquee = Marquee;
    /* Alias kept for anything still referencing the previous theme's name. */
    window.TaqaCard = HayatCard;
    /* Same rule for cart lines. */
    /* legacy alias — a merchant's custom snippet may still call it */
    window.HayatCartItem = HayatCartItem;
    window.TaqaCartItem = HayatCartItem;

    /* ======================================================================
       Localised dates — one pass over every `<time data-hy-date>` on the page.

       Nunjucks has no date filter, so templates print the raw ISO value and
       this rewrites it. It used to live inside the home page's post-grid widget
       as a per-widget <script>, which meant the shared article card showed a
       bare "2026-08-25" everywhere else it was used — that widget has since
       been removed, and this is the only reason its dates still work. The
       language comes off <html>, not the browser, so month names follow the
       storefront.
       ====================================================================== */
    window.HayatLocaliseDates = function (root) { localiseDates(root); };
    function localiseDates(root) {
        var scope = root || document;
        var lang = document.documentElement.lang || 'ar';
        scope.querySelectorAll('time[data-hy-date]').forEach(function (el) {
            if (el.dataset.hyDateDone) return;
            var dt = new Date(el.getAttribute('datetime'));
            if (isNaN(dt)) return;                 /* keep the server fallback */
            try {
                el.textContent = dt.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
                el.dataset.hyDateDone = '1';
            } catch (e) { /* unknown locale — leave the ISO value */ }
        });
    }
    /* Merchant-authored HTML can contain a size chart the page cannot shrink to
       fit. Wrapping each table in a scroller keeps the TABLE scrollable and the
       page still. Doing it here rather than in CSS keeps the table a real table
       — the `display: block` trick would throw away the column layout. */
    function wrapProseTables(root) {
        /* `.hy-pdp-panel-body` is the product description — the third surface
           for merchant-authored HTML, and the one that is NOT `.taqa-prose`. It
           was left out here, so a spec table on a product page overflowed the
           viewport instead of scrolling inside its own box. */
        (root || document).querySelectorAll('.taqa-prose table, .hy-pdp-panel-body table').forEach(function (tbl) {
            var p = tbl.parentElement;
            if (p && p.classList.contains('hy-scroll-x')) return;
            var box = document.createElement('div');
            box.className = 'hy-scroll-x';
            tbl.parentNode.insertBefore(box, tbl);
            box.appendChild(tbl);
        });
    }

    function onReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }
    onReady(function () { localiseDates(); wrapProseTables(); });
    window.HayatLocaliseDates = localiseDates;
    window.HayatWrapProseTables = wrapProseTables;

    // Backward compatibility
    /* Back/forward restore — the cart badge must not come back stale.
       ------------------------------------------------------------------
       Every count on the page is seeded from the SERVER render, which for a
       bfcache restore is the render from BEFORE the shopper left. Add an item
       on a product page, press Back to the listing, and the browser hands back
       the frozen DOM with the old number — no request is made, so nothing in
       the normal update path ever fires.

       `persisted` is the guard: it is true only for a bfcache restore. A plain
       load already has a fresh server count and re-fetching there would be a
       wasted request on every navigation.

       _resync() re-reads the cart and re-broadcasts it, so the header badge,
       the drawer count and the drawer rows all follow from one call. It
       swallows its own network errors and leaves the screen alone. */
    /* ui/cart.njk paints the bar with a hardcoded minor-unit scale of 100 so
       the drawer is never blank on first open. Recompute it here with the real
       detected scale, before anything has had a chance to look at it. */
    document.addEventListener('DOMContentLoaded', function () {
        if (document.querySelector('[data-cart-ship]')) {
            CartManager._refreshShipBar(Number(config.cartTotalPrice) || 0);
        }
    });

    window.addEventListener('pageshow', function (e) {
        if (e.persisted) CartManager._resync();
    });

    window.CartManager = CartManager;
    window.WishlistManager = WishlistManager;
    window.SearchManager = SearchManager;
    window.ProductManager = ProductManager;
    window.EventBus = EventBus;
    window.formatMoney = Utils.formatMoney;
    window.formatPrice = Utils.formatPrice;
    window.HayatVariants = HayatVariants;
    window.toggleModal = function (name) { ModalController.toggle(name); };

    // ===== Alpine.js Stores + Components =====
    document.addEventListener('alpine:init', () => {
        // --- Stores ---
        Alpine.store('modal', {
            current: null,
            open(name) { Qumra.modal.open(name); this.current = name; },
            close() { Qumra.modal.close(); this.current = null; },
            toggle(name) {
                if (this.current === name) { this.close(); }
                else { this.close(); this.open(name); }
            }
        });

        Alpine.store('wishlist', {
            ids: (config.wishlistIds || []),
            has(productId) { return this.ids.indexOf(productId) !== -1; },
            update(data) {
                if (data && data.products) {
                    this.ids = data.products.map(p => p._id || p);
                }
            }
        });

        Alpine.store('cart', {
            totalQuantity: (window.__QUMRA_CONFIG__ && window.__QUMRA_CONFIG__.cartTotalQuantity) || 0,
            totalPrice: 0,
            items: [],
            update(data) {
                this.totalQuantity = data.totalQuantity || 0;
                this.totalPrice = data.totalPrice || 0;
                this.items = data.items || [];
            }
        });

        // --- Cart Interaction Component ---
        Alpine.data('cartInteraction', (config) => ({
            quantities: {},
            updateTimers: {},
            updating: null,
            removingId: null,
            confirmRemoveId: null,
            activeItems: [],

            /* ---- per-line stock, resolved from the product endpoint ----
               ⚠️  A cart line carries NO stock field. Measured on the live cart —
               a line is exactly:

                 _id · cart · productId · variantId · quantity · price ·
                 compareAtPrice · totalPrice · originalPrice · displayPrice
                 productData { _id · app · slug · title · price · image }
                 variantData { options[] }   (null when there is no variant)

               …so `+` had nothing to stop it, and the server will not stop it
               either when the PRODUCT allows backorder while the VARIANT does
               not. The only place the number lives is /ajax/product, so we ask
               it — once per product, and only when the cart is actually
               looked at. */
            stock: {},          /* itemId -> { cap: number|null, needsVariant: bool, soldOut: bool } */
            /* The cart total, kept live so the free-shipping bar can follow it.
               Seeded from the server render and replaced on every cart:updated —
               the bar used to be server-rendered ONLY, so it lagged a full
               interaction behind the numbers printed beside it. */
            cartTotal: Number(config.cartTotal) || 0,
            freeThreshold: Number(config.freeThreshold) || 0,
            stockLoading: false,
            stockLoaded: false,
            lineNote: {},       /* itemId -> sentence shown under the row */

            lines: {},          /* itemId -> { slug, variantId } — what stock lookup needs */

            init() {
                (config.items || []).forEach(i => {
                    this.quantities[i.id] = i.qty;
                    this.activeItems.push(i.id);
                    this.lines[i.id] = { slug: i.slug || '', variantId: i.variantId || null };
                });

                /* The drawer lives in the layout on EVERY page. Resolving stock
                   in init() would fire a product lookup per line on every page
                   load for a drawer nobody opened. Wait for it to be opened. */
                if (config.eagerStock) {
                    this.ensureStock();
                } else {
                    this.$watch('$store.modal.current', (v) => {
                        if (v === 'cart') this.ensureStock();
                    });
                }

                window.addEventListener('cart:updated', (e) => {
                    this.updating = null;
                    this.removingId = null;
                    this.confirmRemoveId = null;
                    if (e.detail) this.cartTotal = Number(e.detail.totalPrice) || 0;
                    if (e.detail && e.detail.items) {
                        this.activeItems = e.detail.items.map(i => i._id);
                        var fresh = false;
                        e.detail.items.forEach(item => {
                            this.quantities[item._id] = item.quantity;
                            if (!this.lines[item._id]) {
                                var pd = item.productData || {};
                                this.lines[item._id] = {
                                    slug: pd.slug || pd.handle || '',
                                    variantId: item.variantId || null
                                };
                                fresh = true;
                            }
                        });
                        /* a line the cart gained since the last resolve has no
                           ceiling yet — go and get it, or `+` runs free again */
                        if (fresh && this.stockLoaded) { this.stockLoaded = false; this.ensureStock(); }
                    } else {
                        this.activeItems = [];
                    }
                });
            },

            /* ---- stock resolution ---------------------------------------- */

            async ensureStock() {
                if (this.stockLoaded || this.stockLoading) return;
                this.stockLoading = true;
                try {
                    var ids = Object.keys(this.lines);
                    /* one request per distinct PRODUCT, not per line */
                    var bySlug = {};
                    ids.forEach((id) => { var sl = this.lines[id].slug; if (sl) bySlug[sl] = null; });
                    var slugs = Object.keys(bySlug);
                    var results = await Promise.all(slugs.map(function (sl) {
                        return Qumra.product.get(sl).catch(function () { return null; });
                    }));
                    slugs.forEach(function (sl, n) {
                        var r = results[n];
                        bySlug[sl] = (r && (r.data || r.product)) || null;
                    });

                    ids.forEach((id) => {
                        var p = bySlug[this.lines[id].slug];
                        if (!p) return;                       /* lookup failed — leave it uncapped */
                        this.stock[id] = this._readStock(p, this.lines[id].variantId);
                        this._noteFor(id);
                    });
                    this.stock = Object.assign({}, this.stock);
                    this.stockLoaded = true;
                } finally {
                    this.stockLoading = false;
                }
            },

            /* Same verdict the cart endpoint reaches: a VARIANT is judged on
               `allowBackorder || available > 0` — see HayatVariants. A product
               with no variants keeps the product-level rule, where
               `trackQuantity: false` really does mean unlimited. */
            _readStock(p, variantId) {
                var groups = (p.options || []).filter(function (o) { return (o.values || []).length > 0; });
                var variants = p.variants || [];

                if (variantId) {
                    var v = variants.find(function (x) { return String(x._id) === String(variantId); });
                    if (!v) return { cap: 0, needsVariant: false, soldOut: true };
                    var avail = (v.inventoryLevel && v.inventoryLevel.available != null)
                        ? v.inventoryLevel.available : v.quantity;
                    if (v.allowBackorder) return { cap: null, needsVariant: false, soldOut: false };
                    return { cap: avail, needsVariant: false, soldOut: !(avail > 0) };
                }

                /* No variant on a product that HAS options: an unfulfillable line
                   — nobody can tell which size to pick off the shelf. These are
                   the rows created before the card stopped adding blind. */
                if (groups.length || variants.length) {
                    return { cap: 0, needsVariant: true, soldOut: false };
                }

                if (!p.trackQuantity || p.allowBackorder) return { cap: null, needsVariant: false, soldOut: false };
                return { cap: p.quantity || 0, needsVariant: false, soldOut: !(p.quantity > 0) };
            },

            _noteFor(id) {
                var st = this.stock[id];
                if (!st) { delete this.lineNote[id]; return; }
                var t = config.strings || {};
                if (st.needsVariant) this.lineNote[id] = t.needsVariant || '';
                else if (st.soldOut) this.lineNote[id] = t.lineSoldOut || '';
                else delete this.lineNote[id];
                this.lineNote = Object.assign({}, this.lineNote);
            },

            /* Is ANY line unbuyable? Checkout is blocked while one is, because
               the order would be refused there anyway — and refused after the
               shopper has entered an address and a card, which is the worst
               place to learn it. Better to say it here, next to the line that
               caused it.

               Reads the same `stock` map `_noteFor()` writes its message from,
               so the button and the note can never disagree: if a line says
               "sold out", the button is off, and if no line does, it is on.

               `stockLoaded` gates it: before the fetch resolves nothing is
               known, and blocking on an unknown would stop a perfectly good
               cart every time the drawer opened. */
            /* How much more to spend. Clamped at 0 so a cart past the threshold
               reports "earned" rather than a negative remainder. */
            shipRemaining() {
                if (!this.freeThreshold) return 0;
                return Math.max(0, this.freeThreshold - this.cartTotal);
            },

            /* `>= threshold`, so a cart landing EXACTLY on the number qualifies.
               That boundary is the one a shopper aims at, and an off-by-one
               there tells someone who spent exactly 1000 that they did not. */
            shipEarned() {
                return this.freeThreshold > 0 && this.cartTotal >= this.freeThreshold;
            },

            /* formatMoney, not formatPrice: this is a REMAINING AMOUNT, and a
               remainder of zero never renders (the earned branch shows instead)
               — but if it ever did, "Free" would be the wrong word for it. */
            money(v) {
                return window.formatMoney ? window.formatMoney(v) : String(v);
            },

            shipPct() {
                if (!this.freeThreshold) return 0;
                return Math.min(100, Math.round((this.cartTotal / this.freeThreshold) * 100));
            },

            hasSoldOut() {
                if (!this.stockLoaded) return false;
                var st = this.stock;
                return Object.keys(st).some(function (id) {
                    return st[id] && (st[id].soldOut || st[id].needsVariant);
                });
            },

            capFor(id) {
                var st = this.stock[id];
                return st ? st.cap : null;            /* null = unknown or uncapped */
            },

            atCap(id) {
                var cap = this.capFor(id);
                return cap !== null && (this.quantities[id] || 1) >= cap;
            },

            increment(id) {
                /* One change in flight at a time. Without this a shopper can tap
                   `+` five times against a line with one unit left, and every
                   tap re-arms the debounce against a number the server has
                   already refused. */
                if (this.updating === id) return;

                /* First press on a drawer that was never opened through the
                   watcher (deep link, keyboard) still resolves before deciding. */
                if (!this.stockLoaded && !this.stockLoading) { this.ensureStock(); }

                var cap = this.capFor(id);
                if (cap !== null && (this.quantities[id] || 1) >= cap) {
                    var t = config.strings || {};
                    var msg = cap > 0
                        ? String(t.maxStock || '').replace('{count}', cap)
                        : (this.stock[id] && this.stock[id].needsVariant ? (t.needsVariant || '') : (t.lineSoldOut || ''));
                    this.lineNote[id] = msg;
                    this.lineNote = Object.assign({}, this.lineNote);
                    if (window.Qumra && Qumra.toast) Qumra.toast.error(msg);
                    return;
                }

                this.quantities[id] = (this.quantities[id] || 1) + 1;
                this._scheduleUpdate(id);
            },

            decrement(id) {
                var c = this.quantities[id] || 1;
                if (c <= 1) {
                    if (config.confirmRemove) {
                        this.confirmRemoveId = id;
                    } else {
                        this.removeItem(id);
                    }
                    return;
                }
                this.quantities[id] = c - 1;
                this._scheduleUpdate(id);
            },

            _scheduleUpdate(id) {
                if (this.updateTimers[id]) clearTimeout(this.updateTimers[id]);
                this.updateTimers[id] = setTimeout(() => {
                    this.updating = id;
                    delete this.updateTimers[id];
                    /* CartManager toasts the reason and re-reads the cart, and the
                       cart:updated it emits resets `quantities` — so the failure is
                       already handled; this only stops the unhandled rejection. */
                    Qumra.cart.update(id, this.quantities[id]).catch(() => { this.updating = null; });
                }, 500);
            },

            removeItem(id) {
                this.removingId = id;
                this.confirmRemoveId = null;
                Qumra.cart.remove(id).catch(() => { this.removingId = null; });
            }
        }));

        // --- Collection/Search Filter Component (AJAX) ---
        Alpine.data('collectionFilter', (cfg) => {
            cfg = cfg || {};
            var _sortMap = { newest: 'created-desc', price_asc: 'price-asc', price_desc: 'price-desc', highest_rated: 'rating-desc' };
            var _reverseSortMap = { 'created-desc': 'newest', 'price-asc': 'price_asc', 'price-desc': 'price_desc', 'rating-desc': 'highest_rated' };
            /* shop-page sends every range filter's handle; the first one drives
               priceMin/priceMax. `rangeHandle` is the older single-value form.
               Do NOT default to 'price' silently when a handle was sent — a
               wrong handle makes the price filter a no-op with no error. */
            var _rh = (cfg.rangeHandles && cfg.rangeHandles.length && cfg.rangeHandles[0])
                || cfg.rangeHandle || 'price';
            var _p = new URLSearchParams(window.location.search);
            var _s = _p.get('sort') || '';
            var _initSort = _reverseSortMap[_s] || _s;
            var _initPriceMin = _p.get('filters[' + _rh + '][min]') || '';
            var _initPriceMax = _p.get('filters[' + _rh + '][max]') || '';

            // Build initial active filters from URL
            var _initActive = {};
            _p.forEach(function (v, k) {
                var m = k.match(/^filters\[([^\]]+)\]\[\]$/);
                if (m) {
                    if (!_initActive[m[1]]) _initActive[m[1]] = [];
                    _initActive[m[1]].push(v);
                }
            });

            return {
                searchQuery: cfg.query || '',
                collectionId: cfg.collectionId || '',
                collections: cfg.collections || [],
                cardSettings: cfg.cardSettings || {},
                /* Falls back to the shared strings in __QUMRA_CONFIG__.card, so
                   widgets don't have to dump their own translation blobs. */
                translations: cfg.translations || HayatCard._t || {},
                /* handle → value → human label, used by the activeChips getter */
                filterLabels: cfg.filterLabels || {},
                rangeHandle: _rh,
                loading: false,
                currentSort: _initSort,
                priceMin: _initPriceMin,
                priceMax: _initPriceMax,
                /* Set by applyPrice() when it corrects what was typed. Empty
                   the rest of the time, which is what hides the line. */
                priceNote: '',
                sortOpen: false,
                _abortCtrl: null,
                _priceTimer: null,
                _activeFilters: _initActive,

                get currentCollection() {
                    if (!this.collectionId || !this.collections) return null;
                    for (var i = 0; i < this.collections.length; i++) {
                        if (this.collections[i].id === this.collectionId) return this.collections[i];
                    }
                    return null;
                },

                isActive(handle, value) {
                    return this._activeFilters[handle] && this._activeFilters[handle].indexOf(value) >= 0;
                },

                get activeCount() {
                    var c = 0;
                    var f = this._activeFilters;
                    for (var k in f) { if (f[k] && f[k].length) c += f[k].length; }
                    if (this.priceMin || this.priceMax) c++;
                    return c;
                },

                /* Flat list of what is currently filtered, for the removable chips
                   above the grid. `_activeFilters` stores VALUES, not labels — the
                   widget passes a handle→value→label map in cfg.filterLabels so a
                   chip can read "أزرق" instead of "#1B6BFF". Falls back to the raw
                   value when no label was supplied. */
                get activeChips() {
                    var out = [];
                    var labels = this.filterLabels || {};
                    var f = this._activeFilters;
                    for (var handle in f) {
                        if (!f[handle] || !f[handle].length) continue;
                        f[handle].forEach(function (value) {
                            out.push({
                                handle: handle,
                                value: value,
                                label: (labels[handle] && labels[handle][value]) || value
                            });
                        });
                    }
                    return out;
                },

                // --- Section mode helpers (qumra.filters API) ---
                _sectionTimer: null,

                /* `qumra.filters` is an undocumented runtime API, and which methods
                   it actually exposes varies. Probe the SPECIFIC method before
                   using it: init() only ever verified `.section`, so a missing
                   `.toggle` / `.range` / `.clear` used to throw into the catch
                   below and the filter silently did nothing. Anything not
                   available here falls through to the URL + /ajax/search/products
                   path, which is self-contained and always works. */
                _useSection(method) {
                    return !!(cfg.section && !this.searchQuery
                        && typeof qumra !== 'undefined' && qumra.filters
                        && typeof qumra.filters[method] === 'function');
                },

                _sectionOp(filterFn, fallback) {
                    var self = this;
                    self.loading = true;
                    /* Sort closes; the filter drawer does not, and the
                       difference is what each one is.

                       Sort is a single-choice menu: picking an option IS the
                       decision, so the menu has served its purpose and shuts.

                       The filter drawer is a workspace. Filters apply live —
                       the Apply button's only job is to dismiss it — so closing
                       it on every toggle meant a shopper could never pick a
                       second filter: tap a colour, it vanishes, re-open, tap a
                       size, it vanishes again. On mobile that made the panel
                       unusable and put Apply out of reach in the one state it
                       exists for.

                       It is now on $store.modal (see widgets/shop-page), so it
                       closes only on Apply, the X, the overlay, or Esc — every
                       one of them something the shopper did. */
                    self.sortOpen = false;
                    // Safety timeout — loading off after 6s even if MutationObserver misses
                    clearTimeout(self._sectionTimer);
                    self._sectionTimer = setTimeout(function () {
                        self.loading = false;
                        self._syncSidebarCount();
                    }, 6000);

                    var recover = function (e) {
                        console.error('[shop] section filter failed — falling back to /ajax/search/products', e);
                        clearTimeout(self._sectionTimer);
                        if (fallback) fallback();
                        else { self.loading = false; }
                    };

                    try {
                        var result = filterFn();
                        // A rejected promise must recover too — a sync try/catch
                        // never sees it, which is how failures went unnoticed.
                        if (result && typeof result.then === 'function') {
                            result.catch(recover);
                        }
                    } catch (e) {
                        recover(e);
                    }
                },

                _syncSidebarCount() {
                    var wrapper = document.querySelector('#products-grid-wrapper');
                    /* The count is rendered once inside the results partial and
                       mirrored into every slot that asked for it: the sidebar
                       (filters on) and the toolbar (always). Both are optional. */
                    var newCount = wrapper && wrapper.querySelector('#products-count-data');
                    if (newCount) {
                        ['#products-count', '#products-count-toolbar'].forEach(function (sel) {
                            var slot = document.querySelector(sel);
                            if (slot) slot.innerHTML = newCount.innerHTML;
                        });
                    }
                },

                // --- Filter actions ---

                sortBy(value) {
                    var self = this;
                    var mapped = _sortMap[value] || value;
                    this.currentSort = value;

                    var viaUrl = function () {
                        var url = new URL(window.location);
                        if (mapped) url.searchParams.set('sort', mapped);
                        else url.searchParams.delete('sort');
                        url.searchParams.delete('page');
                        self._fetch(url);
                    };

                    if (this._useSection('sort')) {
                        this._sectionOp(function () { return qumra.filters.sort(mapped || ''); }, viaUrl);
                        return;
                    }
                    viaUrl();
                },

                toggleFilter(handle, value) {
                    // Update reactive state
                    if (!this._activeFilters[handle]) this._activeFilters[handle] = [];
                    var idx = this._activeFilters[handle].indexOf(value);
                    if (idx >= 0) this._activeFilters[handle].splice(idx, 1);
                    else this._activeFilters[handle].push(value);
                    // Force Alpine reactivity
                    this._activeFilters = Object.assign({}, this._activeFilters);

                    var self = this;
                    var viaUrl = function () {
                        var url = new URL(window.location);
                        var key = 'filters[' + handle + '][]';
                        var existing = url.searchParams.getAll(key);
                        url.searchParams.delete(key);
                        var existIdx = existing.indexOf(value);
                        if (existIdx >= 0) existing.splice(existIdx, 1);
                        else existing.push(value);
                        existing.forEach(function (v) { url.searchParams.append(key, v); });
                        url.searchParams.delete('page');
                        self._fetch(url);
                    };

                    if (this._useSection('toggle')) {
                        this._sectionOp(function () { return qumra.filters.toggle(handle, value); }, viaUrl);
                        return;
                    }
                    viaUrl();
                },

                _debouncedApplyPrice() {
                    clearTimeout(this._priceTimer);
                    this._priceTimer = setTimeout(() => {
                        this.applyPrice();
                    }, 500);
                },

                /* ---- keyword filters (inputType: 'search_text') ----
                   A group whose `items` carry match rules rather than choices.
                   The shopper types; the value rides as a single-valued filter
                   param, which is the same shape the list filters use, so the
                   server needs no special case.

                   Kept beside applyPrice() because it shares its shape: write
                   the value, drop `page`, then let the section path handle it
                   with a full URL reload as the fallback. */
                textFilter(handle) {
                    var v = this._activeFilters[handle];
                    return (v && v.length) ? v[0] : '';
                },

                setTextFilter(handle, value) {
                    value = (value || '').trim();
                    if (value) this._activeFilters[handle] = [value];
                    else delete this._activeFilters[handle];
                    this._activeFilters = Object.assign({}, this._activeFilters);

                    /* ⚠️  Deliberately NOT routed through qumra.filters.
                       There is no section method for a keyword filter.
                       `qumra.filters.search()` is the STORE search — it takes a
                       query string, so calling it with (handle, value) wrote
                       the handle into `?q=` : typing in the brand box produced
                       /shop?q=100, and clearing the box never removed it
                       because nothing here had set `q` to begin with.

                       The URL path is complete on its own: `filters[handle][]`
                       is the same shape the list filters use, and _fetch()
                       re-renders the grid from /ajax/search/products without a
                       page load. */
                    var url = new URL(window.location);
                    var key = 'filters[' + handle + '][]';
                    url.searchParams.delete(key);
                    if (value) url.searchParams.append(key, value);
                    url.searchParams.delete('page');
                    this._fetch(url);
                },

                applyPrice() {
                    var self = this;
                    var rh = this.rangeHandle;

                    /* ---- Normalise before sending ----
                       There was no validation here at all. The inputs carry
                       `min`/`max` attributes, but those only bind the spinner
                       arrows and native form validation — and this field is
                       never submitted as a form: x-model writes straight to
                       state and a debounce calls this. So "-500" and a floor
                       above the ceiling both went to the server verbatim, which
                       answers them with an empty grid and no reason given.

                       CORRECTED, not rejected. A shopper who typed 900–100 meant
                       a range; refusing it makes them work out what was wrong,
                       while swapping it gives them the thing they were reaching
                       for. Same for a negative floor — there is no such price,
                       so 0 is the only reading. `priceNote` says what changed,
                       because a field that silently rewrites itself is worse
                       than one that explains. */
                    var note = '';
                    var lo = this.priceMin === '' || this.priceMin === null ? '' : Number(this.priceMin);
                    var hi = this.priceMax === '' || this.priceMax === null ? '' : Number(this.priceMax);

                    /* NaN from a pasted non-number clears the bound rather than
                       travelling as "NaN". */
                    if (lo !== '' && !isFinite(lo)) lo = '';
                    if (hi !== '' && !isFinite(hi)) hi = '';

                    if (lo !== '' && lo < 0) { lo = 0; note = (this.translations.priceNegative || ''); }
                    if (hi !== '' && hi < 0) { hi = 0; note = (this.translations.priceNegative || ''); }

                    if (lo !== '' && hi !== '' && lo > hi) {
                        var swap = lo; lo = hi; hi = swap;
                        note = (this.translations.priceSwapped || '');
                    }

                    /* Write the corrected values back so the field shows what was
                       actually sent — otherwise the grid and the box disagree. */
                    this.priceMin = lo === '' ? '' : String(lo);
                    this.priceMax = hi === '' ? '' : String(hi);
                    this.priceNote = note;

                    var min = this.priceMin;
                    var max = this.priceMax;

                    var viaUrl = function () {
                        var url = new URL(window.location);
                        if (min) url.searchParams.set('filters[' + rh + '][min]', min);
                        else url.searchParams.delete('filters[' + rh + '][min]');
                        if (max) url.searchParams.set('filters[' + rh + '][max]', max);
                        else url.searchParams.delete('filters[' + rh + '][max]');
                        url.searchParams.delete('page');
                        self._fetch(url);
                    };

                    if (this._useSection('range')) {
                        this._sectionOp(function () { return qumra.filters.range(rh, { min: min, max: max }); }, viaUrl);
                        return;
                    }
                    viaUrl();
                },

                clearFilters() {
                    var self = this;
                    this.priceMin = '';
                    this.priceMax = '';
                    /* Clears with the values it describes. A correction notice
                       left standing over two empty boxes is a message about
                       input that is no longer there. */
                    this.priceNote = '';
                    this._activeFilters = {};

                    /* A debounced applyPrice() from the keystroke just before
                       Clear would fire AFTER this and put the old bounds back —
                       the same race the popstate handler cancels for the same
                       reason. */
                    clearTimeout(this._priceTimer);

                    var viaUrl = function () {
                        var url = new URL(window.location);
                        url.searchParams.delete('page');
                        var keysToRemove = [];
                        url.searchParams.forEach(function (v, k) { if (k.startsWith('filters[')) keysToRemove.push(k); });
                        var unique = [];
                        keysToRemove.forEach(function (k) { if (unique.indexOf(k) === -1) unique.push(k); });
                        unique.forEach(function (k) { url.searchParams.delete(k); });
                        self._fetch(url);
                    };

                    if (this._useSection('clear')) {
                        this._sectionOp(function () { return qumra.filters.clear(); }, viaUrl);
                        return;
                    }
                    viaUrl();
                },

                setCollection(id, slug) {
                    if (cfg.section) {
                        window.location.href = slug ? '/shop/' + slug : '/shop';
                        return;
                    }
                    this.collectionId = id || '';
                    this._collectionSlug = slug || '';
                    var url = new URL(window.location);
                    url.pathname = slug ? '/shop/' + slug : '/shop';
                    var keysToRemove = [];
                    url.searchParams.forEach(function (v, k) { if (k.startsWith('filters[') || k === 'page') keysToRemove.push(k); });
                    var unique = [];
                    keysToRemove.forEach(function (k) { if (unique.indexOf(k) === -1) unique.push(k); });
                    unique.forEach(function (k) { url.searchParams.delete(k); });
                    this.priceMin = '';
                    this.priceMax = '';
                    this.currentSort = '';
                    this._activeFilters = {};
                    url.searchParams.delete('sort');
                    this._fetch(url);
                },

                setSearchQuery(q) {
                    this.searchQuery = q || '';
                    var url = new URL(window.location);
                    if (q) {
                        url.searchParams.set('q', q);
                    } else {
                        url.searchParams.delete('q');
                    }
                    url.searchParams.delete('page');
                    this._fetch(url);
                },

                goToPage(page) {
                    if (cfg.section && !this.searchQuery) {
                        var url = new URL(window.location);
                        if (page > 1) url.searchParams.set('page', page);
                        else url.searchParams.delete('page');
                        window.location.href = url.toString();
                        return;
                    }
                    var url = new URL(window.location);
                    if (page > 1) url.searchParams.set('page', page);
                    else url.searchParams.delete('page');
                    this._fetch(url);
                },

                // --- JSON API fetch (for collection-page / category-detail) ---

                async _fetch(url) {
                    if (this._abortCtrl) this._abortCtrl.abort();
                    this._abortCtrl = new AbortController();
                    this.loading = true;
                    /* Drawer stays open — see the note in _sectionOp. */
                    this.sortOpen = false;

                    try {
                        var apiUrl = new URL('/ajax/search/products', window.location.origin);
                        url.searchParams.forEach(function (v, k) {
                            apiUrl.searchParams.append(k, v);
                        });
                        if (!apiUrl.searchParams.has('q') && this.searchQuery) {
                            apiUrl.searchParams.set('q', this.searchQuery);
                        }
                        if (this.collectionId && !apiUrl.searchParams.has('collectionId')) {
                            apiUrl.searchParams.set('collectionId', this.collectionId);
                        }

                        /* The URL carries filters as `filters[<handle>][min|max]`,
                           but /ajax/search/products documents the price bounds as
                           `minPrice` / `maxPrice` — copied verbatim they were
                           simply ignored and the price filter did nothing here.
                           The `filters[…]` copies are left in place too: the docs
                           are known to be incomplete (they omit qumra.filters and
                           `context` entirely), so if the endpoint does understand
                           them, nothing is lost by sending both spellings. */
                        var pMin = url.searchParams.get('filters[' + this.rangeHandle + '][min]');
                        var pMax = url.searchParams.get('filters[' + this.rangeHandle + '][max]');
                        if (pMin && !apiUrl.searchParams.has('minPrice')) apiUrl.searchParams.set('minPrice', pMin);
                        if (pMax && !apiUrl.searchParams.has('maxPrice')) apiUrl.searchParams.set('maxPrice', pMax);
                        var res = await fetch(apiUrl.toString(), { signal: this._abortCtrl.signal });
                        if (!res.ok) throw new Error(res.status);
                        var data = await res.json();
                        this._renderResults(data);

                        if (url.toString() === window.location.href) {
                            history.replaceState(null, '', url.toString());
                        } else {
                            history.pushState(null, '', url.toString());
                        }
                    } catch (e) {
                        if (e.name !== 'AbortError') {
                            console.error('Filter fetch error:', e);
                        }
                    } finally {
                        this.loading = false;
                        this._abortCtrl = null;
                    }
                },

                _renderResults(data) {
                    var wrapper = document.querySelector('#products-grid-wrapper');
                    var countEl = document.querySelector('#products-count');
                    if (!wrapper) return;

                    var products = data.products || data.results || [];
                    var pagination = data.pagination || null;
                    var totalItems = pagination ? pagination.totalItems : products.length;
                    var cs = this.cardSettings;
                    var tr = this.translations;
                    var self = this;

                    // Update count
                    if (countEl) {
                        var countHtml;
                        if (self.searchQuery) {
                            /* ⚠️  ESCAPED. This string is assigned with innerHTML
                               and `searchQuery` comes straight from `?q=` in the
                               URL — so an unescaped copy is a REFLECTED XSS: a
                               crafted link like /shop?q=<img src=x onerror=…>
                               ran on the shopper's session. (`<script>` inserted
                               via innerHTML does not execute, which is exactly
                               why testing with <script>alert(1)</script> alone
                               makes this look safe when it is not.)
                               HayatCard.esc() is the same escaper the 35 other
                               interpolations in this file already use. */
                            countHtml = '<p class="text-sm text-secondary">' + (tr.resultsFor || '') +
                                ' <span class="font-bold text-primary">&quot;' + HayatCard.esc(self.searchQuery) + '&quot;</span></p>';
                            if (totalItems !== undefined) {
                                countHtml += '<p class="text-xs text-tertiary mt-1">' + HayatCard.esc(Utils.count(totalItems)) + '</p>';
                            }
                        } else {
                            countHtml = '<p class="text-sm text-secondary"><span class="font-bold text-primary">' + HayatCard.esc(Utils.count(totalItems)) + '</span></p>';
                        }
                        countEl.innerHTML = countHtml;
                    }

                    if (products.length > 0) {
                        /* The same .hy-shop-grid as the server's, driven by the
                           variables on the section, so an AJAX page of results is laid out by exactly the
                           same rules as the server-rendered first page. Hard-coded
                           Tailwind column classes here would silently drift from
                           whatever the widget rendered. */
                        var html = '<div class="hy-shop-grid">';
                        products.forEach(function (product) {
                            html += self._buildProductCard(product);
                        });
                        html += '</div>';

                        if (pagination && pagination.totalPages > 1) {
                            html += self._buildPagination(pagination);
                        }

                        wrapper.innerHTML = html;

                        wrapper.querySelectorAll('[x-data]').forEach(function (el) {
                            Alpine.initTree(el);
                        });

                        wrapper.querySelectorAll('.ajax-card').forEach(function (card, i) {
                            card.style.opacity = '0';
                            card.style.transform = 'translateY(20px)';
                            setTimeout(function () {
                                card.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
                                card.style.opacity = '1';
                                card.style.transform = 'translateY(0)';
                            }, i * 80);
                        });
                    } else {
                        var emptyIcon, emptyTitle, emptyText;
                        var hasAnyFilter = !!(self.searchQuery || self.priceMin || self.priceMax
                            || Object.keys(self._activeFilters || {}).length);
                        if (self.searchQuery) {
                            emptyIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>';
                            /* Escaped for the same reason as the count above — this
                               lands in innerHTML too, via '<h3>' + emptyTitle. */
                            emptyTitle = (tr.noResults || '') + ' &quot;' + HayatCard.esc(self.searchQuery) + '&quot;';
                            emptyText = tr.tryDifferent || '';
                        } else {
                            emptyIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>';
                            emptyTitle = tr.noProducts || '';
                            emptyText = tr.noResults || '';
                        }
                        wrapper.innerHTML =
                            '<div class="taqa-empty">' +
                            '<span class="taqa-empty-icon">' +
                            '<svg width="36" height="36" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + emptyIcon + '</svg>' +
                            '</span>' +
                            '<h3 class="m-0">' + emptyTitle + '</h3>' +
                            '<p class="taqa-text-sm m-0 max-w-md mx-auto">' + emptyText + '</p>' +
                            /* The way OUT of an empty result is to undo what
                               emptied it — not to go home, which throws away the
                               collection, the sort and the search along with the
                               filter that was the actual problem.

                               Only when something is actually on: with nothing
                               applied there is nothing to clear, and home is
                               then the honest offer.

                               The `x-data="{}"` is load-bearing. This markup is
                               injected with innerHTML into a component Alpine
                               has ALREADY initialised, and Alpine does not
                               rescan an initialised subtree — a bare @click
                               would never bind. The initTree pass below walks
                               `[x-data]` elements, so the wrapper is what gets
                               this button seen; it inherits clearFilters() from
                               the collectionFilter scope above it. Same reason
                               the injected product cards carry their own
                               x-data. */
                            (hasAnyFilter
                                ? '<span x-data="{}">' +
                                '<button type="button" class="hy-btn hy-btn--outline hy-btn--sm mt-1"' +
                                ' @click="clearFilters()">' + (tr.clearAll || '') + '</button>' +
                                '</span>'
                                : '<a href="/" class="hy-btn hy-btn--outline hy-btn--sm mt-1">' + (tr.home || '') + '</a>') +
                            '</div>';
                    }
                },

                /* Delegates to HayatCard — the single JS card renderer.
                   Do not inline card markup here again. */
                _buildProductCard(product) {
                    return HayatCard.build(product, this.cardSettings || {});
                },

                _buildPagination(pagination) {
                    var cell = 'taqa-btn-icon taqa-btn-icon--outline';
                    var arrow = function (dir) {
                        return '<svg class="rtl-flip" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" d="' +
                            (dir === 'prev' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6') + '"/></svg>';
                    };
                    var tr = HayatCard._t || {};
                    var h = '<nav class="flex items-center justify-center gap-2 flex-wrap mt-12" aria-label="pagination">';

                    if (pagination.currentPage > 1) {
                        h += '<button type="button" @click.prevent="goToPage(' + (pagination.currentPage - 1) + ')" class="' + cell +
                            '" aria-label="' + HayatCard.esc(tr.prev || '') + '">' + arrow('prev') + '</button>';
                    } else {
                        h += '<span class="' + cell + '" style="opacity:.35">' + arrow('prev') + '</span>';
                    }

                    for (var i = 1; i <= pagination.totalPages; i++) {
                        if (i === pagination.currentPage) {
                            h += '<span class="taqa-btn-icon font-num" style="background: var(--color-accent); color: #fff;" aria-current="page">' + i + '</span>';
                        } else if (i === 1 || i === pagination.totalPages ||
                            (i >= pagination.currentPage - 1 && i <= pagination.currentPage + 1)) {
                            h += '<button type="button" @click.prevent="goToPage(' + i + ')" class="' + cell + ' font-num">' + i + '</button>';
                        } else if (i === pagination.currentPage - 2 || i === pagination.currentPage + 2) {
                            h += '<span class="w-5 text-center" style="color: var(--color-text-tertiary);">…</span>';
                        }
                    }

                    if (pagination.hasNextPage) {
                        h += '<button type="button" @click.prevent="goToPage(' + (pagination.currentPage + 1) + ')" class="' + cell +
                            '" aria-label="' + HayatCard.esc(tr.next || '') + '">' + arrow('next') + '</button>';
                    } else {
                        h += '<span class="' + cell + '" style="opacity:.35">' + arrow('next') + '</span>';
                    }

                    return h + '</nav>';
                },

                _parseCollectionFromPath() {
                    var match = window.location.pathname.match(/^\/shop\/(.+?)(?:\/|$)/);
                    if (match && cfg.collections) {
                        var slug = decodeURIComponent(match[1]);
                        for (var i = 0; i < cfg.collections.length; i++) {
                            if (cfg.collections[i].slug === slug) {
                                return { id: cfg.collections[i].id, slug: slug };
                            }
                        }
                    }
                    return null;
                },

                init() {
                    var self = this;
                    self._collectionSlug = '';
                    var params = new URLSearchParams(window.location.search);

                    // Read collection from URL path (/shop/slug)
                    var pathCol = self._parseCollectionFromPath();
                    if (pathCol) {
                        self.collectionId = pathCol.id;
                        self._collectionSlug = pathCol.slug;
                    }

                    // Read search query from URL
                    if (!self.searchQuery && params.get('q')) {
                        self.searchQuery = params.get('q');
                    }

                    if (cfg.section) {
                        var hasFiltersApi = typeof qumra !== 'undefined' && qumra.filters && qumra.filters.section;

                        /* SAFETY NET: without the qumra.filters section runtime nothing
                           would ever mount into #products-grid-wrapper and the shop page
                           would sit permanently blank with no error. Fall back to the
                           JSON search API, which renders through HayatCard. */
                        if (!hasFiltersApi) {
                            console.warn('[shop] qumra.filters unavailable — falling back to /ajax/search/products');
                            self._fetch(new URL(window.location));
                            return;
                        }

                        qumra.filters.section(cfg.section);

                        var wrapper = document.querySelector('#products-grid-wrapper');
                        if (wrapper) {
                            var countTimer;
                            var isEmpty = function () {
                                return !wrapper.children.length || !wrapper.textContent.trim();
                            };

                            /* Once the section has painted, every rescue timer below
                               MUST be cancelled. They used to keep running and the
                               1.5s "last resort" would fire while a perfectly good
                               filtered render was already on screen, replacing it
                               with an UNFILTERED /ajax/search/products result. */
                            var sectionMounted = false;
                            var cancelRescues = function () {
                                sectionMounted = true;
                                clearTimeout(self._nudgeTimer);
                                clearTimeout(self._lastResortTimer);
                            };

                            new MutationObserver(function () {
                                clearTimeout(countTimer);
                                clearTimeout(self._sectionTimer);
                                if (!isEmpty()) cancelRescues();
                                countTimer = setTimeout(function () {
                                    self._syncSidebarCount();
                                    self.loading = false;
                                }, 100);
                            }).observe(wrapper, { childList: true });

                            // First nudge: the section sometimes needs an explicit
                            // filter call before it renders anything.
                            self._nudgeTimer = setTimeout(function () {
                                if (!isEmpty()) { cancelRescues(); self._syncSidebarCount(); return; }
                                if (qumra.filters.sort) {
                                    var p = new URLSearchParams(window.location.search);
                                    try { qumra.filters.sort(p.get('sort') || ''); } catch (e) { }
                                }
                            }, 500);

                            /* LAST RESORT: still nothing in the wrapper means the
                               section never mounted (e.g. `shop-products` missing
                               from pages/shop.json). Render from the JSON API
                               instead of leaving the shopper staring at a blank
                               page.

                               ⚠️  Two hard-won guards, do not drop either:

                               1. 1500ms was shorter than a normal section round
                                  trip on this dev proxy, so this fired while the
                                  filtered render was still in flight and then
                                  overwrote it. It now waits 6s AND is cancelled
                                  the moment the section paints (cancelRescues).

                               2. /ajax/search/products only understands q,
                                  minPrice, maxPrice, collectionId, minRating and
                                  sort — it has NO concept of attribute filters.
                                  Falling back to it while `filters[…][]` is in the
                                  URL returns the UNFILTERED catalogue, which reads
                                  as "the filter silently does nothing". A blank
                                  grid with a console error is the honest outcome. */
                            self._lastResortTimer = setTimeout(function () {
                                if (sectionMounted || !isEmpty()) return;

                                var hasAttrFilters = false;
                                new URLSearchParams(window.location.search).forEach(function (v, k) {
                                    if (/^filters\[[^\]]+\]\[\]$/.test(k)) hasAttrFilters = true;
                                });

                                if (hasAttrFilters) {
                                    console.error('[shop] section "' + cfg.section + '" never mounted and attribute ' +
                                        'filters are active — NOT falling back to /ajax/search/products, which cannot ' +
                                        'apply them and would show the full catalogue as if the filter had matched everything.');
                                    self.loading = false;
                                    return;
                                }

                                console.warn('[shop] section "' + cfg.section + '" never mounted — falling back to /ajax/search/products');
                                self._fetch(new URL(window.location));
                            }, 6000);
                        }
                        if (self.searchQuery) {
                            self._fetch(new URL(window.location));
                        }
                    } else if (cfg.initialFetch) {
                        self._fetch(new URL(window.location));
                    }

                    // Re-sync the filter UI + grid whenever the user navigates with the
                    // browser back/forward buttons. This runs in BOTH modes:
                    //  - AJAX mode (!cfg.section): re-fetch the results for the popped URL.
                    //  - Section mode: the Qumra FiltersModule does NOT watch history, so
                    //    after back/forward nobody refreshes the grid and it goes stale
                    //    (e.g. price filter "brings different products"). We re-sync the
                    //    controls from the URL and call qumra.filters.rerender() so the
                    //    grid matches the URL again.
                    window.addEventListener('popstate', function () {
                        var p = new URLSearchParams(window.location.search);
                        var sort = p.get('sort') || '';
                        self.currentSort = _reverseSortMap[sort] || sort;
                        self.priceMin = p.get('filters[' + self.rangeHandle + '][min]') || '';
                        self.priceMax = p.get('filters[' + self.rangeHandle + '][max]') || '';
                        self.searchQuery = p.get('q') || '';

                        var newActive = {};
                        p.forEach(function (v, k) {
                            var m = k.match(/^filters\[([^\]]+)\]\[\]$/);
                            if (m) {
                                if (!newActive[m[1]]) newActive[m[1]] = [];
                                newActive[m[1]].push(v);
                            }
                        });
                        self._activeFilters = newActive;

                        var pc = self._parseCollectionFromPath();
                        if (pc) {
                            self.collectionId = pc.id;
                            self._collectionSlug = pc.slug;
                        } else {
                            self.collectionId = '';
                            self._collectionSlug = '';
                        }

                        // Cancel any pending debounced price apply so it can't fire after
                        // the back-navigation and overwrite the restored state.
                        clearTimeout(self._priceTimer);

                        if (cfg.section && !self.searchQuery) {
                            self._sectionOp(function () {
                                if (typeof qumra !== 'undefined' && qumra.filters && qumra.filters.rerender) {
                                    qumra.filters.rerender();
                                }
                            });
                        } else {
                            self._fetch(new URL(window.location));
                        }
                    });
                }
            };
        });

        // --- Product Card Component ---
        Alpine.data('productCard', (productId, productUrl) => ({
            productId: productId,
            productUrl: productUrl || '',
            cartLoading: false,
            cartSuccess: false,
            wishlistLoading: false,

            get inWishlist() {
                return Alpine.store('wishlist').has(this.productId);
            },

            /* ⚠️  The grid payload has no options/variants/variantsCount field —
               a listed product is {_id, title, slug, handle, images, pricing,
               quantity, allowBackorder, averageRating, reviewsCount, qid}. So a
               card CANNOT tell a plain product from a two-size dress, and the
               old one-shot `cart.add(productId)` silently created cart lines
               with no variant on every product that had options: no way to know
               which size was ordered, and no variant stock to deduct.

               Resolving the product costs one request, and only when the shopper
               actually presses add. If it turns out to have options, the quick
               view opens so the choice is made properly. */
            async _needsChoice() {
                try {
                    var res = await Qumra.product.get(this.slugFromUrl());
                    var p = (res && (res.data || res.product)) || res || {};
                    var groups = (p.options || []).filter(function (o) {
                        return o && (o.values || []).length > 0;
                    });
                    return groups.length > 0 || (p.variants || []).length > 0;
                } catch (e) {
                    /* Unknown beats wrong: if the lookup fails, send them to the
                       product page rather than add something unidentifiable. */
                    return true;
                }
            },

            slugFromUrl() {
                var parts = String(this.productUrl || '').split('/').filter(Boolean);
                return decodeURIComponent(parts[parts.length - 1] || '');
            },

            async addToCart() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (await this._needsChoice()) {
                        this.cartLoading = false;
                        if (this.slugFromUrl()) {
                            window.dispatchEvent(new CustomEvent('quick-view', {
                                detail: { slug: this.slugFromUrl() }
                            }));
                        } else if (this.productUrl) {
                            window.location.href = this.productUrl;
                        }
                        return;
                    }
                    await Qumra.cart.add(this.productId);
                    this.cartSuccess = true;
                    setTimeout(() => { this.cartSuccess = false; }, 2000);
                } catch (e) {
                    // Error already handled in CartManager
                } finally {
                    this.cartLoading = false;
                }
            },

            async buyNow() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (await this._needsChoice()) {
                        this.cartLoading = false;
                        if (this.productUrl) window.location.href = this.productUrl;
                        return;
                    }
                    await Qumra.cart.add(this.productId);
                    /* Same destination as the product page's Buy Now — see the
                       note there. A card and a PDP must not disagree on what
                       the same button does. */
                    window.location.href = '/checkout';
                } catch (e) {
                    this.cartLoading = false;
                }
            },

            async toggleWishlist() {
                if (this.wishlistLoading) return;
                this.wishlistLoading = true;
                try {
                    await Qumra.wishlist.toggle(this.productId, this.inWishlist);
                } catch (e) {
                    // silent
                } finally {
                    this.wishlistLoading = false;
                }
            }
        }));

        // --- Quick View Component ---
        Alpine.data('quickView', () => ({
            loading: false,
            error: false,
            hasContent: false,

            async openQuickView(slug) {
                if (!slug) return;
                this.loading = true;
                this.error = false;
                this.hasContent = false;
                var container = document.getElementById('quick-view-content-dynamic');
                if (container) container.innerHTML = '';
                Qumra.modal.open('quick-view');

                try {
                    var res = await fetch('/products/' + encodeURIComponent(slug) + '?widgetKey=quick-view-product');
                    if (!res.ok) throw new Error('Failed to load');
                    var html = await res.text();

                    // Inject HTML into DOM
                    if (container) {
                        container.innerHTML = html;

                        // Execute any <script> tags in the injected HTML
                        container.querySelectorAll('script').forEach(function (oldScript) {
                            var newScript = document.createElement('script');
                            if (oldScript.src) {
                                newScript.src = oldScript.src;
                            } else {
                                newScript.textContent = oldScript.textContent;
                            }
                            oldScript.parentNode.replaceChild(newScript, oldScript);
                        });

                        // Let Alpine initialize the new DOM tree
                        this.$nextTick(function () {
                            container.querySelectorAll('[x-data]').forEach(function (el) {
                                Alpine.initTree(el);
                            });
                        });
                    }

                    this.hasContent = true;
                } catch (e) {
                    console.error('Quick view error:', e);
                    this.error = true;
                } finally {
                    this.loading = false;
                }
            }
        }));
    });

    // ===== Sync Alpine Stores with Events =====
    EventBus.on('cart:updated', (data) => {
        if (window.Alpine && Alpine.store('cart')) {
            Alpine.store('cart').update(data);
        }
    });

    EventBus.on('wishlist:updated', (data) => {
        if (window.Alpine && Alpine.store('wishlist')) {
            Alpine.store('wishlist').update(data);
        }
    });

    EventBus.on('modal:open', ({ name }) => {
        if (window.Alpine && Alpine.store('modal')) {
            Alpine.store('modal').current = name;
        }
    });

    EventBus.on('modal:close', () => {
        if (window.Alpine && Alpine.store('modal')) {
            Alpine.store('modal').current = null;
        }
    });

    // ===== Arabic text on an English page =====
    // Default and merchant text can stay Arabic on /en, and Latin tracking
    // breaks its letter joins. CSS can't see a script, only a language, so the
    // text is labelled here and the `:lang(ar)` reset in style.css does the rest.
    if (document.documentElement.lang === 'en') {
        var _tagArabic = function (root) {
            var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), node;
            while ((node = walk.nextNode())) {
                var el = node.parentElement;
                if (el && !/^(SCRIPT|STYLE)$/.test(el.tagName) && /[\u0600-\u06FF]/.test(node.nodeValue)) el.setAttribute('lang', 'ar');
            }
        };
        _tagArabic(document.body);
        new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (n) { if (n.nodeType === 1) _tagArabic(n); });
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ===== Scroll Reveal (IntersectionObserver) =====
    // Skip entirely inside builder preview (iframe) so widgets stay visible
    if (window.self === window.top) {
        document.documentElement.classList.add('reveal-init');

        var _reducedMotion = document.documentElement.classList.contains('hy-no-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function _observeReveal(el) {
            if (el.classList.contains('is-visible')) return;
            if (_reducedMotion) { el.classList.add('is-visible'); return; }
            _revealIO.observe(el);
        }

        var _revealIO = _reducedMotion ? null : new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    _revealIO.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });

        document.querySelectorAll('.reveal').forEach(_observeReveal);

        // Watch for dynamically added .reveal elements (AJAX content)
        new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.classList.contains('reveal')) _observeReveal(node);
                    node.querySelectorAll && node.querySelectorAll('.reveal').forEach(_observeReveal);
                });
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

})();
