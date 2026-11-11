
/* RIYADA Theme - Main JavaScript */
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
            currency: config.currency || 'SAR',
            currencySymbol: config.currencySymbol || 'ر.س',
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

    QumraConfig.messages.stock = Object.assign({
        soldOut: 'Out of stock', allInCart: 'All available stock is already in your cart',
        low: 'Almost gone — only {{count}} left', inStock: 'In stock', inStockCount: 'In stock · {{count}} left',
        onlyAvailable: 'Only {{count}} available', needsVariant: 'Choose the options for this item',
        checkoutBlocked: 'Some items are not available in the requested quantity'
    }, (config.messages && config.messages.stock) || {});

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
    // Money format is MEASURED from the server, never assumed: layout.njk renders
    // `{{ MONEY_PROBE | money }}` into config.moneyFormatSample. From that one sample we
    // read the scale (minor units ÷100, exchange rate, or none), the decimals, both
    // separators, the digit set and where the symbol sits — so JS prices always match
    // what `| money` prints server-side, on any store and any market.
    const MONEY_PROBE = 123456789;
    const _moneyFormat = (function () {
        var sample = String(config.moneyFormatSample || '');
        var m = sample.match(/[0-9٠-٩][0-9٠-٩.,٬٫'\s  ]*[0-9٠-٩]/);
        if (!m) return null;
        var arabicDigits = /[٠-٩]/.test(m[0]);
        var raw = m[0].replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
        var seps = raw.replace(/[0-9]/g, '');
        var lastSep = seps.slice(-1);
        var lastIdx = raw.lastIndexOf(lastSep);
        var tail = lastSep ? raw.slice(lastIdx + 1) : '';
        // The probe has 9 integer digits, so grouping alone always yields 2+ identical
        // separators. The last one is decimal if it's the only one, differs from the
        // first, or doesn't close a 3-digit group.
        var isDecimal = !!lastSep && (seps.length === 1 || lastSep !== seps[0] || tail.length !== 3);
        var decimals = isDecimal ? tail.length : 0;
        var intPart = isDecimal ? raw.slice(0, lastIdx) : raw;
        var value = parseFloat(intPart.replace(/[^0-9]/g, '') + (decimals ? '.' + tail : ''));
        if (!value) return null;
        return {
            factor: MONEY_PROBE / value,
            decimals: decimals,
            decimalSep: isDecimal ? lastSep : '.',
            groupSep: (intPart.match(/[^0-9]/) || [''])[0],
            arabicDigits: arabicDigits,
            prefix: sample.slice(0, m.index),
            suffix: sample.slice(m.index + m[0].length)
        };
    })();

    const Utils = {
        formatMoney(amount) {
            if (amount == null || amount === '') return '';
            var f = _moneyFormat;
            if (!f) return Number(amount).toFixed(2) + ' ' + QumraConfig.defaults.currencySymbol;
            var v = Number(amount) / f.factor;
            var neg = v < 0;
            var parts = Math.abs(v).toFixed(f.decimals).split('.');
            var num = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, f.groupSep);
            if (parts[1]) num += f.decimalSep + parts[1];
            if (f.arabicDigits) num = num.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x0660 + +d); });
            return (neg ? '-' : '') + f.prefix + num + f.suffix;
        },

        // Display units → the store's raw price units (demo catalogue)
        toRaw(display) { return Math.round(display * ((_moneyFormat && _moneyFormat.factor) || 1)); },

        // Locale strings keep their {{count}} placeholder when rendered for JS
        fillCount(str, n) {
            return String(str || '').replace(/\{\{?\s*count\s*\}?\}/g, n);   // {count} or {{count}}
        },

        // Twin of ui/count.njk: منتج واحد · منتجان · 3 منتجات · 11 منتج
        count(n) {
            var c = (window.__QUMRA_CONFIG__ && window.__QUMRA_CONFIG__.counts) || {};
            n = Number(n) || 0;
            var m = n % 100;
            var s = n === 1 ? c.one : n === 2 ? c.two : (m >= 3 && m <= 10) ? c.few : c.many;
            return String(s == null ? n : s).replace('{n}', n);
        },

        // Escape for HTML text and attribute values
        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        calcDiscount(price, compareAtPrice) {
            if (!compareAtPrice || compareAtPrice <= price) return 0;
            // Floor, never round: 37.5% off is shown as 37%, not a bigger promise
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
       RiyadaCard — the ONE JavaScript product-card renderer
       -------------------------------------------------------------------------
       ⚠️  THIS CARD HAS A TWIN: ui/product-card.njk renders the same markup
       server-side. If you change the structure here, change it there too.
       All styling lives in assets/style.css → "PRODUCT CARD", so the two can
       never drift visually — only the markup order has to stay in sync.

       Reading order: brand → name → specs → rating → price → stock → action

       Every widget that renders products from JSON must call
       RiyadaCard.build(product, opts) instead of writing its own template.
       ====================================================================== */
    const RiyadaCard = {
        _t: (config.card || {}),
        _defaults: (config.cardDefaults || {}),

        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        /* Accepts the RIYADA vocabulary ('1x1', '4x3', '4x5') and the older
           descriptive one ('square', 'landscape', 'portrait'). */
        ratioClass(ratio) {
            switch (ratio) {
                case '4x3':
                case 'landscape': return 'riyada-ratio-4x3';
                case '4x5':
                case 'portrait': return 'riyada-ratio-4x5';
                case '3x4': return 'riyada-ratio-3x4';
                default: return 'riyada-ratio-1x1';   // '1x1' | 'square' | unset
            }
        },

        /* Pick the size option: options[0], or options[1] when the first is a
           colour. Mirrors the njk twin exactly — see ui/product-card.njk for
           why it is two explicit slots rather than a search. Returns null when
           the payload carries no options at all, which is the normal case for
           trimmed list/search responses. */
        sizeOption(p) {
            var opts = p && p.options;
            if (!Array.isArray(opts) || !opts.length) return null;
            var o0 = opts[0], o1 = opts[1];
            if (o0 && o0.type !== 'color' && o0.values && o0.values.length) return o0;
            if (o1 && o1.type !== 'color' && o1.values && o1.values.length) return o1;
            return null;
        },

        sizes(opt) {
            if (!opt) return '';
            var self = this;
            return '<div class="riyada-pcard-sizes">' +
                opt.values.slice(0, 6).map(function (v) {
                    var vid = self.esc(v._id);
                    return '<button type="button" class="riyada-size"' +
                        ' :class="selectedSize === \'' + vid + '\' && \'is-active\'"' +
                        ' :aria-pressed="selectedSize === \'' + vid + '\'"' +
                        ' @click.prevent="pickSize(\'' + vid + '\')">' + self.esc(v.label) + '</button>';
                }).join('') + '</div>';
        },

        _starPath: 'm12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45L2.6 9.45l6.5-.95L12 2.6Z',

        _star(cls) {
            return '<svg' + (cls ? ' class="' + cls + '"' : '') +
                ' viewBox="0 0 24 24" fill="currentColor"><path d="' + this._starPath + '"/></svg>';
        },

        stars(rating, reviews) {
            var full = Math.floor(rating);
            var half = (rating - full) >= 0.25;
            var h = '<span class="riyada-stars riyada-stars--sm">';
            for (var i = 1; i <= 5; i++) {
                if (i <= full) h += this._star();
                else if (i === full + 1 && half) h += '<span class="riyada-star-half">' + this._star() + this._star() + '</span>';
                else h += this._star('riyada-star-empty');
            }
            h += '</span><span class="riyada-rating-count">(' + reviews + ')</span>';
            return '<div class="flex items-center gap-1.5">' + h + '</div>';
        },

        /* Tags become the quick-spec chips — same rule as the njk twin. */
        specs(tags) {
            if (!Array.isArray(tags) || !tags.length) return '';
            var self = this;
            /* tags arrive as strings OR objects ({ name, displayName… }) */
            tags = tags.map(function (t) { return typeof t === 'string' ? t : (t && (t.displayName || t.name || t.title || t.label || t.value)) || ''; }).filter(Boolean);
            if (!tags.length) return '';
            return '<div class="riyada-spec-row">' +
                tags.slice(0, 3).map(function (tag) {
                    return '<span class="riyada-spec">' + self.esc(tag) + '</span>';
                }).join('') + '</div>';
        },

        /* Listings send a product with sizes as quantity 0 and no variant data: that
           is "unknown", not sold out. Twin of unknownStock in ui/product-card.njk. */
        unknownStock(p) {
            return !p.variantsCount && p.variantsCount !== 0 && p.variants === undefined && p.options === undefined
                && !p.allowBackorder && !(Number(p.quantity) > 0);
        },

        /* in / low / out — mirrors the njk thresholds exactly. */
        stock(p) {
            if (this.unknownStock(p)) return '<span class="riyada-stock" data-stock-pill hidden></span>';
            var untracked = p.allowBackorder || !p.trackQuantity;
            var qty = p.quantity || 0;
            var t = this._t;
            if (!untracked && qty <= 0) {
                return '<span class="riyada-stock riyada-stock--out"><span class="riyada-stock-dot"></span>' +
                    this.esc(t.outOfStock) + '</span>';
            }
            if (!untracked && qty <= (Number(config.lowStockAt) || 3)) {
                /* t.lowStock is "أوشك على النفاد — بقي {count} فقط" — the placeholder has to be
                   filled here too, or the AJAX card prints it literally. Twin of
                   the same line in ui/product-card.njk. */
                return '<span class="riyada-stock riyada-stock--low"><span class="riyada-stock-dot"></span>' +
                    this.esc(String(t.lowStock || '').replace('{count}', qty)) + '</span>';
            }
            return '<span class="riyada-stock riyada-stock--in"><span class="riyada-stock-dot"></span>' +
                this.esc(t.inStock) + '</span>';
        },

        _atcInner(label) {
            return '<span x-show="cartLoading" class="riyada-spinner" style="width:14px;height:14px;border-width:1.5px;"></span>' +
                '<span x-show="cartSuccess && !cartLoading" x-cloak class="inline-flex items-center gap-1.5">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
                '<path stroke-linecap="round" stroke-linejoin="round" d="M4 12.5 9.5 18 20 6.5"/></svg>' +
                this.esc(this._t.added) + '</span>' +
                '<span x-show="!cartLoading && !cartSuccess">' + this.esc(label) + '</span>';
        },

        build(p, opts) {
            if (!p) return '';
            /* Same fallbacks as ui/product-card.njk. Without them an AJAX card (the home
               rail's latest products, the shop's JSON fallback) had no add-to-cart button
               and no stock line, while the server card did. */
            var o = Object.assign({ showBrand: true, showSpecs: true, showSizes: true, showStock: true, atcStyle: 'always' },
                this._defaults, { showSecondImage: true }, opts || {});
            var t = this._t;

            var price = (p.pricing && p.pricing.price) || 0;
            var was = (p.pricing && p.pricing.compareAtPrice) || 0;
            var onSale = was && was > price;
            var off = Utils.calcDiscount(price, was);   // floored

            var unknown = this.unknownStock(p);
            var inStock = unknown || p.allowBackorder || !p.trackQuantity || p.quantity > 0;
            // search results carry no variant info (variantsCount: null) — also read
            // options/variants, and let the card verify before a blind add
            var hasVariants = !!((p.variantsCount && p.variantsCount > 0) || (p.variants && p.variants.length) || (p.options && p.options.length));
            var isDemo = !!p.demo;     // demo catalogue: inert card → /shop

            var imgs = p.images || [];
            var img = imgs[0] && imgs[0].fileUrl;
            var imgAlt = (o.showSecondImage && imgs[1] && imgs[1].fileUrl) || '';

            var title = this.esc(p.title);
            // /product/<slug> (user's choice); never fall back to _id — /products/<_id> is a 500
            var slug = p.slug || p.handle || '';
            var url = isDemo ? '/shop' : '/product/' + encodeURIComponent(slug);
            if (!isDemo) CartManager.rememberSlug(p._id, slug);
            /* Not a documented field — render the line only if it exists. */
            var brand = p.brand || p.vendor || '';

            var h = '<article class="riyada-pcard ajax-card group"' + (isDemo ? ' data-demo'
                : ' x-data="productCard(\'' + this.esc(p._id) + '\')"' + (unknown ? ' data-stock-unknown' : '')) + '>';

            /* ---------- media ---------- */
            h += '<div class="riyada-pcard-media ' + this.ratioClass(o.imageRatio) + '">';
            h += '<a href="' + url + '" aria-label="' + title + '">';
            if (img) {
                h += '<img src="' + this.esc(img) + '" alt="' + title + '" loading="lazy" class="riyada-pcard-img riyada-pcard-img--primary' +
                    (imgAlt ? '' : ' riyada-pcard-img--only') + '"/>';
                if (imgAlt) {
                    h += '<img src="' + this.esc(imgAlt) + '" alt="' + title +
                        '" loading="lazy" class="riyada-pcard-img riyada-pcard-img--alt"/>';
                }
            } else {
                h += '<span class="riyada-pcard-noimg"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/></svg></span>';
            }
            h += '</a>';

            if (onSale) {
                h += '<div class="riyada-pcard-badges"><span class="riyada-badge riyada-badge--off">−' + off + '%</span></div>';
            }

            if ((o.showQuickView || o.showCompare) && !isDemo) {
                h += '<div class="riyada-pcard-actions">';
                if (o.showQuickView) {
                    h += '<button type="button" class="riyada-btn-icon riyada-btn-icon--filled riyada-btn-icon--sm" aria-label="' +
                        this.esc(t.quickView) + '" @click.prevent="$dispatch(\'quick-view\', { slug: ' + this.esc(JSON.stringify(String(slug))) + ' })">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
                        '<circle cx="12" cy="12" r="2.75"/></svg></button>';
                }
                if (o.showCompare) {
                    h += '<button type="button" class="riyada-btn-icon riyada-btn-icon--filled riyada-btn-icon--sm" aria-label="' +
                        this.esc(t.compare) + '" @click.prevent="$dispatch(\'compare-toggle\', { id: \'' + p._id + '\' })">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h7M4 7l2.5-2.5M4 7l2.5 2.5M20 17h-7m7 0-2.5-2.5M20 17l-2.5 2.5"/></svg></button>';
                }
                h += '</div>';
            }

            if (!inStock) {
                h += '<div class="riyada-soldout-veil"><span>' + this.esc(t.outOfStock) + '</span></div>';
            }

            /* Size picker over the foot of the image — the card's signature.
               Only when the payload actually carries options; see sizeOption(). */
            var sizeOpt = (o.showSizes && !isDemo) ? this.sizeOption(p) : null;
            var hasSizes = !!sizeOpt;
            if (inStock && hasSizes) h += this.sizes(sizeOpt);

            if (inStock && !hasSizes && o.atcStyle === 'tray' && !isDemo) {
                h += '<div class="riyada-reveal-tray">';
                h += (hasVariants || unknown)
                    ? '<a href="' + url + '"' + (unknown ? ' data-view-product' : '') + ' class="riyada-btn riyada-btn--light riyada-btn--sm riyada-pcard-atc">' + this.esc(unknown ? t.viewProduct : t.chooseOptions) + '</a>'
                    : '<button type="button" @click.prevent="addToCart()" :disabled="cartLoading || cartSuccess" class="riyada-btn riyada-btn--light riyada-btn--sm riyada-pcard-atc">' +
                    this._atcInner(t.addToCart) + '</button>';
                h += '</div>';
            }
            h += '</div>';

            /* ---------- body ---------- */
            h += '<div class="riyada-pcard-body">';

            if (o.showBrand && brand) h += '<span class="riyada-pcard-brand">' + this.esc(brand) + '</span>';

            h += '<a href="' + url + '" class="riyada-pcard-name"><span class="riyada-clamp-2">' + title + '</span></a>';

            if (o.showSpecs) h += this.specs(p.tags);

            var reviews = p.reviewsCount || 0;
            if (o.showRating && reviews > 0) h += this.stars(p.averageRating || 0, reviews);

            h += '<div class="riyada-pcard-prices">';
            if (price > 0) h += '<span class="riyada-price' + (onSale ? ' riyada-price--sale' : '') + '">' + Utils.formatMoney(price) + '</span>';
            if (onSale) h += '<span class="riyada-price-was">' + Utils.formatMoney(was) + '</span>';
            h += '</div>';

            if (o.showStock) h += this.stock(p);

            if (inStock && o.atcStyle !== 'hidden' && !isDemo) {
                if (hasSizes) {
                    /* Sizes are on the card, so the button acts on the picked
                       one and stays disabled until there is one. Adding an
                       arbitrary variant on the shopper's behalf causes returns. */
                    h += '<button type="button" @click.prevent="addToCart()"' +
                        ' :disabled="!selectedSize || cartLoading || cartSuccess"' +
                        ' class="riyada-btn riyada-btn--primary riyada-btn--sm riyada-btn--block mt-1">' +
                        '<span x-show="cartLoading" class="riyada-spinner" style="width:14px;height:14px;border-width:1.5px;"></span>' +
                        '<span x-show="cartSuccess && !cartLoading" x-cloak class="inline-flex items-center gap-1.5">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" d="M4 12.5 9.5 18 20 6.5"/></svg>' +
                        this.esc(t.added) + '</span>' +
                        '<span x-show="!cartLoading && !cartSuccess && !selectedSize">' + this.esc(t.chooseSize) + '</span>' +
                        '<span x-show="!cartLoading && !cartSuccess && selectedSize">' + this.esc(t.addToCart) + '</span>' +
                        '</button>';
                } else if (o.atcStyle === 'always') {
                    h += (hasVariants || unknown)
                        ? '<a href="' + url + '"' + (unknown ? ' data-view-product' : '') + ' class="riyada-btn riyada-btn--outline riyada-btn--sm riyada-btn--block mt-1">' + this.esc(unknown ? t.viewProduct : t.chooseOptions) + '</a>'
                        : '<button type="button" @click.prevent="addToCart()" :disabled="cartLoading || cartSuccess" class="riyada-btn riyada-btn--primary riyada-btn--sm riyada-btn--block mt-1">' +
                        this._atcInner(t.addToCart) + '</button>';
                }
            }

            h += '</div></article>';
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
       RiyadaCartItem — the ONE JavaScript cart-line renderer
       -------------------------------------------------------------------------
       ⚠️  THIS LINE HAS A TWIN: ui/cart.njk renders the same markup
       server-side (drawer + cart page). Change one, change the other.
       Styling lives in assets/style.css → "CART ITEM".

       Only used when CartManager adds a row to an ALREADY-RENDERED drawer, so
       it must emit the same data-* hooks _refreshDrawer() looks for.
       ====================================================================== */

    // ===== Stock =====
    // One rule for "how many can still be bought", shared by the product page, quick view
    // and the cart. MEASURED on the server: a PRODUCT with trackQuantity:false is unlimited,
    // but a VARIANT is always capped by its own quantity unless it allows backorders
    // (`order.product_out_of_stock` even with trackQuantity:false).
    const Stock = {
        limit(entity) {
            if (!entity || entity.allowBackorder) return null;            // null = no cap
            if (!entity.isVariant && !entity.trackQuantity) return null;
            var q = (entity.inventoryLevel && entity.inventoryLevel.available != null)
                ? entity.inventoryLevel.available : entity.quantity;
            return Math.max(0, Number(q) || 0);
        },
        inCart(cart, productId, variantId) {
            return ((cart && cart.items) || []).reduce(function (n, i) {
                if (String(i.productId) !== String(productId)) return n;
                if (variantId && String(i.variantId) !== String(variantId)) return n;
                return n + (Number(i.quantity) || 0);
            }, 0);
        },
        lowAt() { return Number(config.lowStockAt) || 3; },
        // /ajax/product (response under `data`), once per page per product
        _cache: {},
        product(slug) {
            if (!slug) return Promise.resolve(null);
            if (!this._cache[slug]) {
                this._cache[slug] = ApiClient.get(QumraConfig.api.product.get, { handle: slug })
                    .then(function (r) { var d = r && (r.data || r); return (d && (d.product || d)) || null; })
                    .catch(function () { return null; });
            }
            return this._cache[slug];
        },
        variantImage(slug, variantId) {
            return this.product(slug).then(function (p) {
                var v = p && (p.variants || []).find(function (x) { return String(x._id) === String(variantId); });
                var img = v && v.images && v.images[0];
                return (img && img.fileUrl) || null;
            });
        },
        // Alpine mixin for the product page AND quick view — one implementation, no twins.
        // Host sets `stockEntity` (the matched variant, isVariant:true) and calls _clampQty().
        cap(productId, entity, slug, lowAt) {
            CartManager.rememberSlug(productId, slug);
            return {
                productId: productId,
                stockEntity: entity,
                cartSnapshot: null,
                _lowAt: lowAt,
                // truth: store cap − what THIS shopper already holds (null = no cap)
                availableNow() {
                    var lim = Stock.limit(this.stockEntity);
                    return lim === null ? null : Math.max(0, lim - Stock.inCart(this.cartSnapshot, this.productId, this.currentVariantId));
                },
                maxQty() { var a = this.availableNow(); return a === null ? 99 : a; },   // stepper only
                // four explicit, exhaustive states
                stockState() {
                    if (Stock.limit(this.stockEntity) === 0) return 'soldout';
                    var a = this.availableNow();
                    if (a === 0) return 'incart';
                    if (a !== null && a <= (Number(this._lowAt) || Stock.lowAt())) return 'low';
                    return 'instock';
                },
                canBuy() { var st = this.stockState(); return st !== 'soldout' && st !== 'incart'; },
                stockLine() {
                    var M = QumraConfig.messages.stock, a = this.availableNow();
                    switch (this.stockState()) {
                        case 'soldout': return M.soldOut;
                        case 'incart': return M.allInCart;
                        case 'low': return Utils.fillCount(M.low, a);
                        default: return a === null ? M.inStock : Utils.fillCount(M.inStockCount, a);
                    }
                },
                stockBarPct() {
                    var a = this.availableNow();
                    return a === null ? 0 : Math.max(8, Math.min(100, (a / (Number(this._lowAt) || Stock.lowAt())) * 100));
                },
                _clampQty() { var m = this.maxQty(); if (this.qty > m) this.qty = Math.max(1, m); },
                _watchCart() {
                    var self = this;
                    CartManager.get().then(function (d) { self.cartSnapshot = d; self._clampQty(); }).catch(function () {});
                    window.addEventListener('cart:updated', function (e) { self.cartSnapshot = e.detail; self._clampQty(); });
                }
            };
        }
    };

    // ===== Demo catalogue =====
    // Shown ONLY when the store has no products at all (CC0 photos assets/demo-product-*.jpg,
    // docs/demo-images.md). Demo cards are inert: link to /shop, no cart, no quick view.
    const Demo = {
        _items: [
            { ar: 'حذاء جري خفيف', en: 'Lightweight Running Shoe', price: 1450, was: 1800 },
            { ar: 'كيتل بيل ١٢ كجم', en: 'Kettlebell 12 kg', price: 950 },
            { ar: 'مات يوجا ٦ مم', en: 'Yoga Mat 6 mm', price: 420, was: 520 },
            { ar: 'طقم أحزمة مقاومة', en: 'Resistance Band Set', price: 380 },
            { ar: 'زجاجة مياه رياضية', en: 'Sports Water Bottle', price: 260 },
            { ar: 'قفازات ملاكمة', en: 'Boxing Gloves', price: 890, was: 1050 },
            { ar: 'كرة قدم مقاس ٥', en: 'Football, Size 5', price: 540 },
            { ar: 'رولر استشفاء', en: 'Recovery Foam Roller', price: 330 }
        ],
        products(limit) {
            /* a shopper must never see made-up products with prices */
            if (!document.documentElement.classList.contains('riyada-preview')) return [];
            var en = (QumraConfig.defaults.language || 'ar') === 'en';
            var imgs = config.demoImages || [];
            return this._items.slice(0, limit || this._items.length).map(function (d, i) {
                return { _id: 'demo-' + (i + 1), demo: true, slug: '', title: en ? d.en : d.ar,
                    pricing: { price: Utils.toRaw(d.price), compareAtPrice: d.was ? Utils.toRaw(d.was) : 0 },
                    images: imgs[i] ? [{ fileUrl: imgs[i] }] : [], allowBackorder: true, variantsCount: 0 };
            });
        }
    };

    const RiyadaCartItem = {
        _t: (config.cart || {}),

        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        build(item, opts) {
            if (!item) return '';
            var o = opts || {};
            var compact = o.compact !== false;      // the drawer is the default caller
            var id = item._id;
            var pd = item.productData || {};
            var title = this.esc(pd.title);
            var rowSlug = pd.slug || pd.handle || CartManager.slugs[String(item.productId)] || '';
            var url = rowSlug ? '/product/' + encodeURIComponent(rowSlug) : '';   // no slug → no link
            var img = (pd.image && pd.image.fileUrl) || '';
            var hasCompare = item.compareAtPrice && item.compareAtPrice > item.price;
            var onClick = o.onClick || "$store.modal.close()";
            var t = this._t;

            var h = '<div class="riyada-citem' + (compact ? ' riyada-citem--compact' : '') + '"' +
                ' data-cart-item="' + id + '"' +
                ' x-show="activeItems.includes(\'' + id + '\')"' +
                ' x-transition:enter="transition ease-out duration-300"' +
                ' x-transition:enter-start="opacity-0 translate-y-2"' +
                ' x-transition:enter-end="opacity-100 translate-y-0"' +
                ' x-transition:leave="transition ease-in duration-200"' +
                ' x-transition:leave-start="opacity-100"' +
                ' x-transition:leave-end="opacity-0"' +
                ' :class="removingId === \'' + id + '\' && \'is-removing\'">';

            /* ---- image ---- */
            h += url ? '<a href="' + url + '" class="riyada-citem-media" @click="' + onClick + '">' : '<span class="riyada-citem-media">';
            h += img
                ? '<img src="' + this.esc(img) + '" alt="' + title + '" loading="lazy"/>'
                : '<span class="absolute inset-0 flex items-center justify-center" style="color: var(--color-accent-soft);">' +
                '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
                '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.75" cy="9" r="1.75"/>' +
                '<path d="m4 17 5-4.5 4.5 4 3-2.5L21 18"/></svg></span>';
            h += url ? '</a>' : '</span>';

            /* ---- body ---- */
            h += '<div class="riyada-citem-body">';
            h += '<div class="flex items-start justify-between gap-2">' +
                (url ? '<a href="' + url + '" class="riyada-citem-name" @click="' + onClick + '"><span class="riyada-clamp-2">' + title + '</span></a>'
                     : '<span class="riyada-citem-name line-clamp-2">' + title + '</span>') +
                '<button type="button" @click="removeItem(\'' + id + '\')" class="riyada-citem-remove" aria-label="' + this.esc(t.remove) + '">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button></div>';

            /* ---- selected options ---- */
            var opts_ = (item.variantData && item.variantData.options) || [];
            if (opts_.length) {
                h += '<div class="flex flex-wrap items-center gap-x-3 gap-y-1">';
                opts_.forEach((op) => {
                    var name = (op.option && op.option.name) || '';
                    var isColor = op.option && op.option.type === 'color';
                    h += '<span class="riyada-citem-opt">' + this.esc(name) + ': ' +
                        (isColor ? '<span class="riyada-citem-dot" style="background: ' + this.esc(op.value || '#CBD3DE') + ';"></span>' : '') +
                        '<span style="color: var(--color-text-secondary);">' + this.esc(op.label) + '</span></span>';
                });
                h += '</div>';
            }

            /* why this line can't be bought as-is (stock / missing variant) */
            h += '<p class="riyada-citem-note" x-show="stockNote(\'' + id + '\')" x-cloak x-text="stockNote(\'' + id + '\')"></p>';

            /* ---- qty + price ---- */
            h += '<div class="riyada-citem-foot">' +
                '<div class="riyada-qty riyada-qty--sm">' +
                '<button type="button" @click="decrement(\'' + id + '\')" aria-label="-">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M5 12h14"/></svg></button>' +
                '<span class="riyada-qty-value">' +
                '<span x-show="updating !== \'' + id + '\'" x-text="quantities[\'' + id + '\']">' + item.quantity + '</span>' +
                '<span x-show="updating === \'' + id + '\'" x-cloak class="riyada-spinner" style="width:13px;height:13px;border-width:1.5px;"></span>' +
                '</span>' +
                '<button type="button" @click="increment(\'' + id + '\')" :disabled="atCap(\'' + id + '\')" aria-label="+">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg></button>' +
                '</div>' +
                '<div class="text-end">' +
                /* unit price × qty — mirrors the same block in ui/cart.njk */
                '<span class="riyada-citem-unit" title="' + this.esc(t.unitPrice) + '">' +
                '<bdi>' + Utils.formatMoney(item.price) + '</bdi>' +
                '<span aria-hidden="true">×</span>' +
                '<bdi x-text="quantities[\'' + id + '\']">' + item.quantity + '</bdi>' +
                '</span>' +
                '<span class="riyada-price block" data-item-total="' + id + '" :class="updating === \'' + id + '\' && \'opacity-50\'">' +
                Utils.formatMoney(item.totalPrice) + '</span>' +
                '<span class="riyada-price-was block" data-item-compare="' + id + '"' +
                (hasCompare ? '>' + Utils.formatMoney(item.totalCompareAtPrice) : ' style="display:none;">') +
                '</span>' +
                '</div></div>';

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
        // productId → slug. The /ajax/cart/add response carries no slug (measured), so
        // every place that knows one records it (SSR cart, PDP, quick view, cards).
        slugs: {},
        rememberSlug(productId, slug) { if (productId && slug) this.slugs[String(productId)] = slug; },

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

        // Pick the clearest message for a failed cart add: out-of-stock,
        // then any specific server message, then the generic fallback.
        _errorMessage(error) {
            const serverMsg = (error && error.data && error.data.message) || (error && error.message) || '';
            const isStock = (error && error.status === 409)
                || /stock|inventory|out of stock|مخزون|الكميه|الكمية|نفد|نفذ/i.test(serverMsg);
            if (isStock) {
                return QumraConfig.messages.outOfStock || serverMsg || QumraConfig.messages.addError;
            }
            if (serverMsg && !/^Request failed|^Failed$/i.test(serverMsg)) {
                return serverMsg;
            }
            return QumraConfig.messages.addError;
        },

        async update(itemId, quantity) {
            const data = await ApiClient.post(QumraConfig.api.cart.change, { itemId, quantity });
            if (data.success !== false) {
                this._updateUI(data);
                this._refreshDrawer(data);
                EventBus.emit('cart:updated', data);
            }
            return data;
        },

        async remove(itemId) {
            const itemEl = document.querySelector('[data-cart-item="' + itemId + '"]');
            if (itemEl) itemEl.classList.add('removing');
            const data = await ApiClient.post(QumraConfig.api.cart.remove, { itemId });
            if (data.success !== false) {
                this._updateUI(data);
                EventBus.emit('cart:updated', data);
                setTimeout(() => {
                    if (itemEl) itemEl.remove();
                    this._refreshDrawer(data);
                }, 400);
            }
            return data;
        },

        async clear() {
            const data = await ApiClient.post(QumraConfig.api.cart.clear, {});
            if (data.success !== false) {
                this._updateUI(data);
                this._refreshDrawer(data);
                EventBus.emit('cart:updated', data);
            }
            return data;
        },

        _updateUI(data) {
            updateSelectors(QumraConfig.selectors.cart, {
                count: data.totalQuantity || 0,
                itemsCount: (data.items || []).length,
                total: Utils.formatMoney(data.totalPrice)
            });
            document.querySelectorAll('[data-cart-count-text]').forEach(function (el) {
                el.textContent = Utils.count(data.totalQuantity || 0);
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
                        if (item.totalCompareAtPrice && item.compareAtPrice > item.price) {
                            el.textContent = Utils.formatMoney(item.totalCompareAtPrice);
                            el.style.display = '';
                        } else {
                            el.style.display = 'none';
                        }
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

                // Hide empty state
                if (empty) empty.style.display = 'none';
            } else {
                // No items - show empty state
                if (container) container.style.display = 'none';
                if (footer) footer.style.display = 'none';
                if (countBar) countBar.style.display = 'none';
                if (empty) empty.style.display = '';
            }
        },

        /* Delegates to RiyadaCartItem — the single JS cart-line renderer.
           Do not inline cart markup here again. */
        _buildItemHTML(item) {
            return RiyadaCartItem.build(item);
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
        card: RiyadaCard,
        stock: Stock,
        demo: Demo,
        cartItem: RiyadaCartItem
    };

    // ===== Global Exports =====
    window.Qumra = Qumra;
    /* The single JS product-card renderer — every widget that renders products
       from JSON must call RiyadaCard.build() / .mount() instead of its own HTML. */
    window.RiyadaCard = RiyadaCard;
    /* Same rule for cart lines. */
    window.RiyadaCartItem = RiyadaCartItem;

    // Backward compatibility
    window.CartManager = CartManager;
    window.WishlistManager = WishlistManager;
    window.SearchManager = SearchManager;
    window.ProductManager = ProductManager;
    window.EventBus = EventBus;
    window.formatMoney = Utils.formatMoney;
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
        /* Esc closes whichever drawer / modal is open (keyboard users had no way out) */
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var m = Alpine.store('modal');
            if (m && m.current) m.close();
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
            /* ---- per-line stock (a cart line carries none — read /ajax/product) ---- */
            lines: {},          // itemId → { productId, variantId }
            stock: {},          // itemId → { cap: number|null, needsVariant, soldOut }
            stockLoaded: false,

            init() {
                (config.items || []).forEach(i => {
                    this.quantities[i.id] = i.qty;
                    this.activeItems.push(i.id);
                    this.lines[i.id] = { productId: i.productId, variantId: i.variantId || null };
                    CartManager.rememberSlug(i.productId, i.slug);
                });
                /* the drawer lives on every page: resolve stock only when it's opened;
                   the cart page is a deliberate visit, so it resolves on mount */
                if (config.eagerStock) this._checkStock();
                else this.$watch('$store.modal.current', (v) => { if (v === 'cart') this._checkStock(); });

                window.addEventListener('cart:updated', (e) => {
                    this.updating = null;
                    this.removingId = null;
                    this.confirmRemoveId = null;
                    if (e.detail && e.detail.items) {
                        this.activeItems = e.detail.items.map(i => i._id);
                        e.detail.items.forEach(item => {
                            this.quantities[item._id] = item.quantity;
                            if (!this.lines[item._id]) this.lines[item._id] = { productId: item.productId, variantId: item.variantId || null };
                            var sl = item.productData && (item.productData.slug || item.productData.handle);
                            CartManager.rememberSlug(item.productId, sl);
                        });
                    } else {
                        this.activeItems = [];
                    }
                    if (this.stockLoaded || config.eagerStock) this._checkStock();
                });
            },

            _checkStock() {
                var self = this;
                this.stockLoaded = true;
                this.activeItems.forEach(function (id) {
                    var line = self.lines[id];
                    if (!line) return;
                    Stock.product(CartManager.slugs[String(line.productId)]).then(function (p) {
                        if (!p) return;                                   // unknown → fail-open
                        var groups = (p.options || []).filter(function (o) { return (o.values || []).length; });
                        var st;
                        if (line.variantId) {
                            var v = (p.variants || []).find(function (x) { return String(x._id) === String(line.variantId); });
                            if (!v) st = { cap: 0, needsVariant: false, soldOut: true };
                            else { var c = Stock.limit(Object.assign({ isVariant: true }, v)); st = { cap: c, needsVariant: false, soldOut: c === 0 }; }
                        } else if (groups.length || (p.variants || []).length) {
                            st = { cap: 0, needsVariant: true, soldOut: false };   // a line no one can fulfil
                        } else {
                            var c2 = Stock.limit(p); st = { cap: c2, needsVariant: false, soldOut: c2 === 0 };
                        }
                        self.stock[id] = st;
                        self.stock = Object.assign({}, self.stock);
                    });
                });
            },
            capFor(id) { var st = this.stock[id]; return st ? st.cap : null; },
            atCap(id) { var c = this.capFor(id); return c !== null && (this.quantities[id] || 1) >= c; },
            lineBlocked(id) {
                var st = this.stock[id];
                if (!st || this.activeItems.indexOf(id) === -1) return false;
                if (st.soldOut || st.needsVariant) return true;
                return st.cap !== null && (this.quantities[id] || 0) > st.cap;
            },
            stockNote(id) {
                if (!this.lineBlocked(id)) return '';
                var st = this.stock[id], M = QumraConfig.messages.stock;
                if (st.needsVariant) return M.needsVariant;
                if (st.soldOut) return M.soldOut;
                return Utils.fillCount(M.onlyAvailable, st.cap);
            },
            get checkoutBlocked() {
                var self = this;
                return this.activeItems.some(function (id) { return self.lineBlocked(id); });
            },
            goCheckout(e) {
                if (!this.checkoutBlocked) { if (Alpine.store('modal')) Alpine.store('modal').close(); return; }
                e.preventDefault();
                Toast.error(QumraConfig.messages.stock.checkoutBlocked);
            },

            increment(id) {
                if (!this.stockLoaded) this._checkStock();
                if (this.atCap(id)) {
                    var c = this.capFor(id);
                    Toast.warning(c > 0 ? Utils.fillCount(QumraConfig.messages.stock.onlyAvailable, c) : this.stockNote(id) || QumraConfig.messages.stock.soldOut);
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
                    Qumra.cart.update(id, this.quantities[id]);
                }, 500);
            },

            removeItem(id) {
                this.removingId = id;
                this.confirmRemoveId = null;
                Qumra.cart.remove(id);
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
                translations: cfg.translations || RiyadaCard._t || {},
                /* handle → value → human label, used by the activeChips getter */
                filterLabels: cfg.filterLabels || {},
                rangeHandle: _rh,
                loading: false,
                currentSort: _initSort,
                priceMin: _initPriceMin,
                priceMax: _initPriceMax,
                filtersOpen: false,
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
                    self.filtersOpen = false;
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

                applyPrice() {
                    var self = this;
                    var rh = this.rangeHandle;
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
                    this._activeFilters = {};

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
                    this.filtersOpen = false;
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
                            countHtml = '<p class="text-sm text-secondary">' + (tr.resultsFor || '') +
                                ' <span class="font-bold text-primary">&quot;' + Utils.esc(self.searchQuery) + '&quot;</span></p>';
                            if (totalItems !== undefined) {
                                countHtml += '<p class="text-xs text-tertiary mt-1">' + Utils.esc(Utils.count(totalItems)) + '</p>';
                            }
                        } else {
                            countHtml = '<p class="text-sm text-secondary">' + Utils.esc(Utils.count(totalItems)) + '</p>';
                        }
                        countEl.innerHTML = countHtml;
                    }

                    if (products.length > 0) {
                        /* Uses the shared .riyada-grid primitive driven by CSS vars,
                           so an AJAX page of results is laid out by exactly the
                           same rules as the server-rendered first page. Hard-coded
                           Tailwind column classes here would silently drift from
                           whatever the widget rendered. */
                        var cols = cs.cols || {};
                        var html = '<div class="riyada-grid" style="' +
                            '--cols-desktop: ' + (cols.desktop || 4) + ';' +
                            '--cols-tablet: ' + (cols.tablet || 3) + ';' +
                            '--cols-mobile: ' + (cols.mobile || 2) + ';">';
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
                        if (self.searchQuery) {
                            emptyIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>';
                            emptyTitle = (tr.noResults || '') + ' &quot;' + Utils.esc(self.searchQuery) + '&quot;';
                            emptyText = tr.tryDifferent || '';
                        } else {
                            emptyIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>';
                            emptyTitle = tr.noProducts || '';
                            emptyText = tr.noResults || '';
                        }
                        wrapper.innerHTML =
                            '<div class="riyada-empty">' +
                            '<span class="riyada-empty-icon">' +
                            '<svg width="36" height="36" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + emptyIcon + '</svg>' +
                            '</span>' +
                            '<h3 class="m-0">' + emptyTitle + '</h3>' +
                            '<p class="riyada-text-sm m-0 max-w-md mx-auto">' + emptyText + '</p>' +
                            '<a href="/" class="riyada-btn riyada-btn--outline riyada-btn--sm mt-1">' + (tr.home || '') + '</a>' +
                            '</div>';
                    }
                },

                /* Delegates to RiyadaCard — the single JS card renderer.
                   Do not inline card markup here again. */
                _buildProductCard(product) {
                    return RiyadaCard.build(product, this.cardSettings || {});
                },

                _buildPagination(pagination) {
                    var cell = 'riyada-btn-icon riyada-btn-icon--outline';
                    var arrow = function (dir) {
                        return '<svg class="rtl-flip" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" d="' +
                            (dir === 'prev' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6') + '"/></svg>';
                    };
                    var tr = RiyadaCard._t || {};
                    var h = '<nav class="flex items-center justify-center gap-2 flex-wrap mt-12" aria-label="pagination">';

                    if (pagination.currentPage > 1) {
                        h += '<button type="button" @click.prevent="goToPage(' + (pagination.currentPage - 1) + ')" class="' + cell +
                            '" aria-label="' + RiyadaCard.esc(tr.prev || '') + '">' + arrow('prev') + '</button>';
                    } else {
                        h += '<span class="' + cell + '" style="opacity:.35">' + arrow('prev') + '</span>';
                    }

                    for (var i = 1; i <= pagination.totalPages; i++) {
                        if (i === pagination.currentPage) {
                            h += '<span class="riyada-btn-icon font-num" style="background: var(--color-accent); color: #fff;" aria-current="page">' + i + '</span>';
                        } else if (i === 1 || i === pagination.totalPages ||
                            (i >= pagination.currentPage - 1 && i <= pagination.currentPage + 1)) {
                            h += '<button type="button" @click.prevent="goToPage(' + i + ')" class="' + cell + ' font-num">' + i + '</button>';
                        } else if (i === pagination.currentPage - 2 || i === pagination.currentPage + 2) {
                            h += '<span class="w-5 text-center" style="color: var(--color-text-tertiary);">…</span>';
                        }
                    }

                    if (pagination.hasNextPage) {
                        h += '<button type="button" @click.prevent="goToPage(' + (pagination.currentPage + 1) + ')" class="' + cell +
                            '" aria-label="' + RiyadaCard.esc(tr.next || '') + '">' + arrow('next') + '</button>';
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
                           JSON search API, which renders through RiyadaCard. */
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
        Alpine.data('productCard', (productId) => ({
            productId: productId,
            init() {
                var a = this.$el.querySelector('a[href^="/product/"]');
                var m = a && a.getAttribute('href').match(/^\/product\/([^?#]+)/);
                if (m) CartManager.rememberSlug(this.productId, decodeURIComponent(m[1]));
                /* Listing payloads carry no variant stock: quantity 0 is unknown until
                   /ajax/product says so. Asked once the card is near the screen. */
                if (m && this.$el.hasAttribute('data-stock-unknown')) {
                    var el = this.$el, slug = decodeURIComponent(m[1]);
                    var run = function () {
                        Stock.product(slug).then(function (p) {
                            if (!p) return;   /* no answer: «عرض المنتج» stays, which is always true */
                            /* same rule as Stock.limit: a variant is capped by its own quantity */
                            var buyable = function (x) { return x && (x.allowBackorder || Number(x.quantity) > 0); };
                            var ok = (p.variants || []).length ? p.variants.some(buyable) : buyable(p);
                            var t = config.card || {};
                            var pill = el.querySelector('[data-stock-pill]');
                            var btn = el.querySelector('[data-view-product]');
                            if (pill) {
                                pill.classList.add(ok ? 'riyada-stock--in' : 'riyada-stock--out');
                                pill.innerHTML = '<span class="riyada-stock-dot"></span>' + RiyadaCard.esc((ok ? t.inStock : t.outOfStock) || '');
                                pill.hidden = false;
                            }
                            if (ok) {
                                if (btn && (p.options || []).length) btn.textContent = t.chooseOptions || '';
                                return;
                            }
                            if (btn) btn.remove();
                            var media = el.querySelector('.riyada-pcard-media');
                            if (media && !media.querySelector('.riyada-soldout-veil')) {
                                var veil = document.createElement('div');
                                veil.className = 'riyada-soldout-veil';
                                veil.innerHTML = '<span>' + RiyadaCard.esc(t.outOfStock || '') + '</span>';
                                media.appendChild(veil);
                            }
                        });
                    };
                    if ('IntersectionObserver' in window) {
                        var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); } }, { rootMargin: '300px' });
                        io.observe(el);
                    } else run();
                }
            },
            /* A card can't tell a plain product from a two-group one (search results
               carry no variant data). Adding without every option creates a
               parent-priced line (measured). Check first; if the card's own picks
               don't cover every option group, open quick view to choose instead. */
            async _needsOptions() {
                var slug = CartManager.slugs[String(this.productId)];
                if (!slug) return false;
                var p = await Stock.product(slug);
                if (!p) return false;
                var groups = (p.options || []).filter(function (o) { return (o.values || []).length; }).length;
                var picked = this.selectedSize ? 1 : 0;
                if (groups > picked) { this.$dispatch('quick-view', { slug: slug }); return true; }
                return false;
            },
            /* The option-value _id of the size chosen on the card, or null.
               Both card renderers (ui/product-card.njk and RiyadaCard.build)
               bind their size buttons to this. */
            selectedSize: null,
            cartLoading: false,
            cartSuccess: false,
            wishlistLoading: false,

            get inWishlist() {
                return Alpine.store('wishlist').has(this.productId);
            },

            /* Tapping the picked size again clears it — on touch there is no
               other way to undo a mis-tap without leaving the card. */
            pickSize(valueId) {
                this.selectedSize = this.selectedSize === valueId ? null : valueId;
            },

            /* CartManager.add sends an ARRAY as `options` (option-value ids) and
               a bare value as `variantId` — so the size must go in as [id]. */
            _options() {
                return this.selectedSize ? [this.selectedSize] : null;
            },

            async addToCart() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (await this._needsOptions()) return;
                    await Qumra.cart.add(this.productId, 1, this._options());
                    this.cartSuccess = true;
                    setTimeout(() => { this.cartSuccess = false; }, 2000);
                } catch (e) {
                    // Error already toasted in CartManager
                    this._openProductOnRefusal(e);
                } finally {
                    this.cartLoading = false;
                }
            },

            async buyNow() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (await this._needsOptions()) { this.cartLoading = false; return; }
                    await Qumra.cart.add(this.productId, 1, this._options());
                    window.location.href = '/cart';
                } catch (e) {
                    this.cartLoading = false;
                    this._openProductOnRefusal(e);
                }
            },

            /* The server refused a blind add (400: options or stock the card can't
               see), so send the shopper to the page that can show why. */
            _openProductOnRefusal(e) {
                var slug = CartManager.slugs[String(this.productId)];
                if (e && e.status === 400 && slug) {
                    setTimeout(function () { window.location.href = '/products/' + encodeURIComponent(slug); }, 900);
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

    // ===== Scroll Reveal (IntersectionObserver) =====
    // Skip entirely inside builder preview (iframe) so widgets stay visible
    if (window.self === window.top) {
        document.documentElement.classList.add('reveal-init');

        var _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // ===== Sticky that never traps (معيار قمرة RSP-03) =====
    // A sticky column taller than the viewport would pin its top and leave its bottom
    // unreachable. Instead of max-height + an inner scrollbar (which clips popovers),
    // give it a negative `top`: it scrolls until its bottom shows, then sticks.
    (function () {
        var SEL = '[data-sticky-fit], [class*="-summary"][class*="riyada-cp-"]';
        function fit(el) {
            el.style.top = '';
            var cs = getComputedStyle(el);
            if (cs.position !== 'sticky') return;
            var base = parseFloat(cs.top) || 0;
            var h = el.getBoundingClientRect().height;
            if (h + base > window.innerHeight) el.style.top = (window.innerHeight - h - 16) + 'px';
        }
        function fitAll() { document.querySelectorAll(SEL).forEach(fit); }
        window.addEventListener('load', function () {
            fitAll();
            window.addEventListener('resize', fitAll);
            if ('ResizeObserver' in window) {
                var ro = new ResizeObserver(function (en) { en.forEach(function (e) { fit(e.target); }); });
                document.querySelectorAll(SEL).forEach(function (el) { ro.observe(el); });
            }
        });
    })();

    // ===== Motion only while visible =====
    // Swiper autoplay and CSS marquees stop off-screen (document.hidden only covers a
    // background tab) and resume when they scroll back in.
    if ('IntersectionObserver' in window) {
        window.addEventListener('load', function () {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    var el = entry.target, sw = el.swiper;
                    if (sw && sw.autoplay && sw.params.autoplay && sw.params.autoplay.enabled) {
                        if (entry.isIntersecting) sw.autoplay.start(); else sw.autoplay.stop();
                    }
                    if (el.classList.contains('riyada-offer-track')) {
                        el.style.animationPlayState = entry.isIntersecting ? '' : 'paused';
                        el.querySelectorAll('*').forEach(function (c) { c.style.animationPlayState = entry.isIntersecting ? '' : 'paused'; });
                    }
                });
            });
            document.querySelectorAll('.swiper, .riyada-offer-track').forEach(function (el) { io.observe(el); });
        });
    }

    // ===== Colour swatches =====
    // Option values may hold a hex, a colour name in either language, or nothing but the
    // label. A name CSS can't read would paint a white circle, so it goes through this
    // table; a colour nobody can resolve shows its label as a size-style chip instead.
    (function () {
        var NAMES = {
            'أسود': '#111111', 'black': '#111111', 'أبيض': '#FFFFFF', 'white': '#FFFFFF',
            'أحمر': '#C62828', 'red': '#C62828', 'أزرق': '#1565C0', 'blue': '#1565C0',
            'كحلي': '#1B2A49', 'navy': '#1B2A49', 'سماوي': '#6EC6E6', 'sky blue': '#6EC6E6',
            'أخضر': '#2E7D32', 'green': '#2E7D32', 'زيتي': '#6B6B2E', 'olive': '#6B6B2E',
            'أصفر': '#F9C80E', 'yellow': '#F9C80E', 'برتقالي': '#EF6C00', 'orange': '#EF6C00',
            'بني': '#6D4C41', 'brown': '#6D4C41', 'بيج': '#D9C7A8', 'beige': '#D9C7A8',
            'كريمي': '#F5EBD7', 'cream': '#F5EBD7', 'رمادي': '#9E9E9E', 'gray': '#9E9E9E', 'grey': '#9E9E9E',
            'وردي': '#EC7FA9', 'pink': '#EC7FA9', 'بنفسجي': '#6A1B9A', 'purple': '#6A1B9A',
            'عنابي': '#7B1E3A', 'نبيتي': '#7B1E3A', 'burgundy': '#7B1E3A', 'ذهبي': '#C9A227', 'gold': '#C9A227',
            'فضي': '#BFC3C7', 'silver': '#BFC3C7', 'تركواز': '#1AA6A6', 'turquoise': '#1AA6A6'
        };
        function lookup(s) {
            s = String(s || '').trim();
            if (!s) return '';
            var key = s.toLowerCase();
            if (NAMES[key]) return NAMES[key];
            if (key.indexOf('ال') === 0 && NAMES[key.slice(2)]) return NAMES[key.slice(2)];
            return (window.CSS && CSS.supports && CSS.supports('color', s)) ? s : '';
        }
        function paint(el) {
            var label = el.getAttribute('data-swatch-label') || '';
            var color = lookup(el.getAttribute('data-swatch')) || lookup(label);
            el.removeAttribute('data-swatch');
            if (color) { el.style.backgroundColor = color; return; }
            el.classList.remove('riyada-swatch');
            el.classList.add('riyada-size', 'riyada-size--lg');
            el.textContent = label;
        }
        function scan(root) { root.querySelectorAll('[data-swatch]').forEach(paint); }
        scan(document);
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); });
            });
        }).observe(document.body, { childList: true, subtree: true });
    })();

})();
