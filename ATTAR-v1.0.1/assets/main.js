
/* Mazaj Theme - Main JavaScript */
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
            outOfStock: (config.messages && config.messages.outOfStock) || 'This product is out of stock',
            soldOut: (config.messages && config.messages.soldOut) || 'Out of stock',
            onlyAvailable: (config.messages && config.messages.onlyAvailable) || 'Only {{count}} available',
            needsVariant: (config.messages && config.messages.needsVariant) || 'Choose options for this item',
            checkoutBlocked: (config.messages && config.messages.checkoutBlocked) || 'Some items are no longer available',
            stock: Object.assign({
                soldOut: 'Out of stock', allInCart: 'All available stock is already in your cart',
                low: 'Only {{count}} left!', inStock: 'In stock', inStockCount: 'In stock · {{count}} left'
            }, (config.messages && config.messages.stock) || {}),
            count: (config.messages && config.messages.count) || {},
            card: Object.assign({
                addToCart: 'Add to Cart', added: 'Added', outOfStock: 'Out of Stock', chooseOptions: 'Choose Options', almostGone: 'Almost gone', free: 'Free'
            }, (config.messages && config.messages.card) || {})
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

        // Floor, never round: 37.5% off is shown as 37%, not a bigger promise than the real one
        calcDiscount(price, compareAtPrice) {
            if (!compareAtPrice || compareAtPrice <= price) return 0;
            return Math.floor(((compareAtPrice - price) / compareAtPrice) * 100);
        },

        // Number + noun with Arabic plural forms — JS twin of ui/count.njk
        count(n) {
            var M = QumraConfig.messages.count || {};
            n = Number(n) || 0;
            var r = n % 100;
            if (n === 1) return M.one || '1';
            if (n === 2) return M.two || '2';
            return n + ' ' + ((r >= 3 && r <= 10 ? M.few : M.many) || '');
        },

        // One CSS colour for a swatch — JS twin of ui/color-value.njk
        swatchColor(value, label) {
            var v = String(value || '').trim();
            if (/^(#|rgb|hsl)/.test(v)) return v;
            var map = { 'أسود': '#111111', black: '#111111', 'أبيض': '#FFFFFF', white: '#FFFFFF', 'أحمر': '#C62828', red: '#C62828', 'أزرق': '#1E56A0', blue: '#1E56A0', 'كحلي': '#14213D', navy: '#14213D', 'أخضر': '#2E7D32', green: '#2E7D32', 'زيتي': '#556B2F', olive: '#556B2F', 'أصفر': '#F2C230', yellow: '#F2C230', 'برتقالي': '#E67E22', orange: '#E67E22', 'بنفسجي': '#6A3FA0', purple: '#6A3FA0', 'موف': '#8E6BBF', mauve: '#8E6BBF', 'وردي': '#E88FB0', pink: '#E88FB0', 'بيج': '#D9C7A8', beige: '#D9C7A8', 'كريمي': '#F1E7D2', cream: '#F1E7D2', 'بني': '#6D4C33', brown: '#6D4C33', 'رمادي': '#8A8A8A', gray: '#8A8A8A', grey: '#8A8A8A', 'ذهبي': '#C9A227', gold: '#C9A227', 'فضي': '#BFC3C7', silver: '#BFC3C7', 'عنابي': '#6E1F2F', burgundy: '#6E1F2F' };
            return map[String(label || v).trim().toLowerCase()] || map[v.toLowerCase()] || 'var(--color-bg-secondary)';
        },

        // Locale strings keep their {{count}} placeholder when rendered for JS
        fillCount(str, n) {
            return String(str || '').replace(/\{\{\s*count\s*\}\}/g, n);
        },

        // Escape for HTML text and attribute values — anything from a URL or the API
        // goes through this before it reaches innerHTML.
        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

    // ===== Stock =====
    // One rule for "how many can still be bought", shared by product page, quick view and cart.
    // `entity` is a product or a variant: { quantity, trackQuantity, allowBackorder }.
    const Stock = {
        // Max units the store will sell; null = unlimited.
        // MEASURED on the server (not assumed): a PRODUCT with trackQuantity:false is
        // unlimited, but a VARIANT is always capped by its own quantity unless it allows
        // backorders — the server answers `order.product_out_of_stock` /
        // `order.quantity_exceeds_stock` even when the variant's trackQuantity is false.
        limit(entity) {
            if (!entity || entity.allowBackorder) return null;
            if (!entity.isVariant && !entity.trackQuantity) return null;
            return Math.max(0, Number(entity.quantity) || 0);
        },

        // Units of this product (or this exact variant) already in the cart
        inCart(cart, productId, variantId) {
            return ((cart && cart.items) || []).reduce(function (n, i) {
                if (i.productId !== productId) return n;
                if (variantId && i.variantId !== variantId) return n;
                return n + (Number(i.quantity) || 0);
            }, 0);
        },

        // URL of a variant's own image (the server render only has its ID). null = none.
        variantImage(slug, variantId) {
            return this.product(slug).then(function (p) {
                var v = p && (p.variants || []).find(function (x) { return x._id === variantId; });
                var img = v && v.images && v.images[0];
                return (img && img.fileUrl) || null;
            });
        },

        // "Only N left" threshold — ONE number for the whole theme (layout.njk → lowStockAt)
        lowAt() { return Number(config.lowStockAt) || 3; },

        // Product page and quick view start on the first option values. When that combination
        // is sold out and another can be bought, start there. byValue: { valueId: [optionName, label] }
        openOnBuyable(host, byValue) {
            var picked = Object.values(host.selectedOptions);
            var buyable = function (v) { return Stock.limit(v) !== 0; };
            var current = host.variants.find(function (v) {
                return v.options.length === picked.length && picked.every(function (id) { return v.options.indexOf(id) > -1; });
            });
            if (!current || buyable(current)) return;
            var next = host.variants.find(buyable);
            if (!next) return;
            next.options.forEach(function (id) {
                var o = byValue[id];
                if (!o) return;
                host.selectedOptions[o[0]] = id;
                if (host.selectedLabels) host.selectedLabels[o[0]] = o[1];
            });
        },

        // Alpine mixin for the product page and quick view — one implementation, no twins.
        // The host sets `stockEntity` to the matched variant and calls _clampQty().
        cap(productId, entity, slug) {
            CartManager.rememberSlug(productId, slug);
            return {
                productId: productId,
                stockEntity: entity,
                cartSnapshot: null,
                // Truth: what can still be bought (stock − this customer's cart). null = no cap.
                // Every number the customer READS and every guard uses this.
                availableNow() {
                    var limit = Stock.limit(this.stockEntity);
                    if (limit === null) return null;
                    return Math.max(0, limit - Stock.inCart(this.cartSnapshot, this.productId, this.currentVariantId));
                },
                // Stepper ceiling only
                maxQty() {
                    var a = this.availableNow();
                    return a === null ? 99 : a;
                },
                // Four explicit, exhaustive states — never "the opposite of the others"
                //   soldout : the store has none            → button off
                //   incart  : you already hold all of it    → button off
                //   low     : 1 … lowAt left for you        → button on
                //   instock : unlimited, or more than lowAt → button on
                stockState() {
                    if (Stock.limit(this.stockEntity) === 0) return 'soldout';
                    var a = this.availableNow();
                    if (a === 0) return 'incart';
                    if (a !== null && a <= Stock.lowAt()) return 'low';
                    return 'instock';
                },
                canBuy() {
                    var st = this.stockState();
                    return st !== 'soldout' && st !== 'incart';
                },
                stockLine() {
                    var M = QumraConfig.messages.stock, a = this.availableNow();
                    switch (this.stockState()) {
                        case 'soldout': return M.soldOut;
                        case 'incart': return M.allInCart;
                        case 'low': return Utils.fillCount(M.low, a);
                        // The count belongs on the same line, and only when it's real
                        default: return a === null ? M.inStock : Utils.fillCount(M.inStockCount, a);
                    }
                },
                _clampQty() {
                    var max = this.maxQty();
                    if (this.qty > max) this.qty = Math.max(1, max);
                },
                _watchCart() {
                    var self = this;
                    CartManager.get().then(function (data) { self.cartSnapshot = data; self._clampQty(); }).catch(function () {});
                    window.addEventListener('cart:updated', function (e) { self.cartSnapshot = e.detail; self._clampQty(); });
                }
            };
        },

        // Stock is read fresh per page load, one request per product
        _cache: {},
        product(slug) {
            if (!slug) return Promise.resolve(null);
            if (!this._cache[slug]) {
                this._cache[slug] = ApiClient.get(QumraConfig.api.product.get, { handle: slug })
                    .then(function (res) { var d = res && (res.data || res); return (d && (d.product || d)) || null; })
                    .catch(function () { return null; });
            }
            return this._cache[slug];
        }
    };

    // ===== Demo catalogue =====
    // Shown ONLY when the store has no products at all, so a freshly installed theme
    // never looks empty. Photos are CC0 (assets/demo-product-*.jpg). Demo cards link to
    // /shop and can't be added to the cart — they have no real product id.
    const Demo = {
        _items: [
            { ar: 'دهن عود ملكي', en: 'Royal Oud Oil', price: 1450, was: 1700, rating: 5, reviews: 21 },
            { ar: 'عطر عود المبخر', en: 'Oud Al Mubakhar Eau de Parfum', price: 890, rating: 5, reviews: 14 },
            { ar: 'ثنائي العنبر والمسك', en: 'Amber & Musk Duo', price: 1250, was: 1480, rating: 4, reviews: 9 },
            { ar: 'عود كمبودي — قطع', en: 'Cambodian Oud Chips', price: 1900, rating: 5, reviews: 7 },
            { ar: 'بخور معطّر بالعنبر', en: 'Amber Bakhoor', price: 320, rating: 4, reviews: 18 },
            { ar: 'عطر المسك الأزرق', en: 'Blue Musk Parfum', price: 760, was: 880, rating: 5, reviews: 11 },
            { ar: 'ورد طائفي مجفّف', en: 'Dried Taif Rose Buds', price: 240, rating: 4, reviews: 6 },
            { ar: 'مبخرة خشب منقوشة', en: 'Carved Wooden Incense Burner', price: 450, rating: 5, reviews: 4 }
        ],
        products(limit) {
            var en = QumraConfig.defaults.language === 'en';
            var imgs = config.demoImages || [];
            var factor = (_moneyFormat && _moneyFormat.factor) || 1; // prices are in the store's raw units
            return this._items.slice(0, limit || this._items.length).map(function (d, i) {
                return {
                    _id: 'demo-' + (i + 1), demo: true, slug: '',
                    title: en ? d.en : d.ar,
                    pricing: { price: Math.round(d.price * factor), compareAtPrice: d.was ? Math.round(d.was * factor) : 0 },
                    images: imgs[i] ? [{ fileUrl: imgs[i] }] : [],
                    averageRating: d.rating, totalReviews: d.reviews,
                    allowBackorder: true, variantsCount: 0
                };
            });
        }
    };

    // ===== Cards =====
    // JS TWIN of ui/product-card.njk (ATTAR fragrance card) — same markup & classes.
    // Change both together. Used wherever cards are built after an AJAX fetch
    // (collection-products, product-grid, the shop filter).
    const Cards = {
        _aspect(ratio) {
            return ratio === 'square' ? 'aspect-[1/1]' : (ratio === 'landscape' ? 'aspect-[4/3]' : 'aspect-[3/4]');
        },

        product(p, opts) {
            opts = opts || {};
            var L = QumraConfig.messages.card;
            var esc = Utils.esc;
            var pricing = p.pricing || {};
            var price = pricing.price || 0;
            var cmp = pricing.compareAtPrice || 0;
            var hasDisc = cmp && cmp > price;
            var discount = Utils.calcDiscount(price, cmp);
            var hasVariants = p.variantsCount > 0 || (p.variants && p.variants.length > 0) || (p.options && p.options.length > 0);
            // Listings send variant products with quantity 0 — the variant list (when present) decides.
            // Quantity 0 with no variant data at all is unknown, not sold out: the card opens the product.
            var variantsKnown = p.variants !== undefined || p.options !== undefined || p.variantsCount != null;
            var viewOnly = false;
            var canBuy = true;
            if (hasVariants) {
                canBuy = !!(p.allowBackorder || !(p.variants && p.variants.length) || p.variants.some(function (v) { return v.quantity > 0 || v.allowBackorder; }));
            } else if (!p.allowBackorder && !(p.quantity > 0)) {
                if (variantsKnown && p.trackQuantity) canBuy = false;
                else viewOnly = true;
            }
            var lowStock = canBuy && !hasVariants && p.trackQuantity && !p.allowBackorder && p.quantity > 0 && p.quantity <= Stock.lowAt();
            var title = esc(p.title);
            var img = (p.images && p.images[0] && p.images[0].fileUrl) || '';
            var img2 = (p.images && p.images[1] && p.images[1].fileUrl) || '';
            var isDemo = !!p.demo;
            // /products/<slug>; never fall back to _id — /products/<_id> is a 500
            var slug = p.slug || p.handle || '';
            var href = (isDemo || !slug) ? '/shop' : '/products/' + encodeURIComponent(slug);
            if (!isDemo) CartManager.rememberSlug(p._id, slug);
            // tags arrive as strings or objects — print a name, never [object Object]
            var tags = (Array.isArray(p.tags) ? p.tags : []).map(function (t) {
                return typeof t === 'string' ? t : (t && (t.displayName || t.name || t.title || t.label || t.value)) || '';
            }).filter(Boolean).slice(0, 3);
            var idx = opts.index || 0;
            var idxLabel = idx > 0 && idx < 10 ? '0' + idx : String(idx);
            var fade = ' style="filter: saturate(1.03) contrast(1.02);"';

            // Search results carry no variant info — such a card checks before adding
            var h = isDemo
                ? '<article class="group flex flex-col h-full" data-demo>'
                : '<article class="group flex flex-col h-full" x-data="productCard(\'' + esc(p._id) + '\')"' +
                  (!variantsKnown ? ' data-check-variants' : '') + '>';

            h += '<a href="' + href + '" class="block"><div class="relative ' + this._aspect(opts.ratio) + ' w-full overflow-hidden attar-pcard-media" style="background: radial-gradient(120% 120% at 50% 18%, color-mix(in srgb, var(--color-accent) 10%, transparent) 0%, var(--color-bg-secondary) 46%, var(--color-bg-primary) 100%); border: 1px solid var(--color-border);">';
            if (img) {
                h += '<img src="' + esc(img) + '" alt="' + title + '" class="absolute inset-0 w-full h-full object-cover transition-transform duration-[1100ms] ease-out ' + (img2 ? 'group-hover:opacity-0' : 'group-hover:scale-[1.04]') + '"' + fade + ' loading="lazy" />';
                if (img2) h += '<img src="' + esc(img2) + '" alt="" class="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-[1100ms] ease-out"' + fade + ' loading="lazy" />';
            } else {
                h += '<div class="attar-mark" aria-hidden="true"></div>';
            }
            if (hasDisc) h += '<span class="absolute top-3 start-3 z-10 inline-flex items-center px-2.5 py-1 text-[10px] font-medium tracking-[0.12em]" style="background: var(--color-sale); color: var(--color-on-sale);"><bdi dir="ltr">−' + discount + '%</bdi></span>';
            if (lowStock) h += '<span class="attar-low-badge absolute bottom-3 start-3 z-10 font-body-ar">' + esc(L.almostGone) + '</span>';
            if (!canBuy) h += '<div class="absolute inset-0 flex items-center justify-center z-20" style="background: color-mix(in srgb, var(--color-bg-primary) 68%, transparent); backdrop-filter: blur(1px);"><span class="px-4 py-1.5 text-[11px] font-medium tracking-[0.1em] uppercase" style="background: var(--color-surface); color: var(--color-text-secondary); border: 1px solid var(--color-border);">' + esc(L.outOfStock) + '</span></div>';
            h += '</div></a>';

            h += '<div class="flex flex-col flex-1 mt-5"><span class="editorial-rule"></span><div class="flex items-start gap-4 pt-4">';
            if (idx > 0) h += '<span class="text-[13px] leading-none pt-1 tabular-nums shrink-0" style="color: var(--color-accent); letter-spacing: 0.05em;">' + idxLabel + '</span>';
            h += '<div class="flex flex-col flex-1 min-w-0 gap-2">';
            h += '<a href="' + href + '" class="anaqa-pcard-name attar-pcard-name font-heading-ar text-[17px] leading-snug line-clamp-2">' + title + '</a>';
            if (tags.length) h += '<div class="flex flex-wrap gap-1.5">' + tags.map(function (t) { return '<span class="attar-note-tag">' + esc(t) + '</span>'; }).join('') + '</div>';
            h += '<div class="flex items-baseline gap-2.5">';
            h += '<span class="text-[14px] font-light tracking-wide" style="color: ' + (hasDisc ? 'var(--color-sale-text, var(--color-text-primary))' : 'var(--color-text-primary)') + ';">' + (price > 0 ? Utils.formatMoney(price) : esc(L.free)) + '</span>';
            if (hasDisc) h += '<span class="text-[12px] font-light line-through" style="color: var(--color-text-tertiary);">' + Utils.formatMoney(cmp) + '</span>';
            h += '</div>';

            if (canBuy && !isDemo) {
                if (viewOnly) {
                    h += '<a href="' + href + '" class="anaqa-add-btn font-body-ar">' + esc(L.viewProduct) + '</a>';
                } else if (hasVariants) {
                    h += '<a href="' + href + '" class="anaqa-add-btn font-body-ar">' + esc(L.chooseOptions) + '</a>';
                } else {
                    h += '<button @click.prevent="addToCart()" :disabled="cartLoading || cartSuccess" type="button" class="anaqa-add-btn font-body-ar">' +
                        '<span x-show="cartLoading" class="inline-flex"><svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg></span>' +
                        '<span x-show="cartSuccess && !cartLoading" x-cloak class="inline-flex items-center gap-1.5"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' + esc(L.added) + '</span>' +
                        '<span x-show="!cartLoading && !cartSuccess">' + esc(L.addToCart) + '</span></button>';
                }
            }
            h += '</div></div></div></article>';
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
            el.setAttribute('role', type === 'error' ? 'alert' : 'status');
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
        // productId → slug. The AJAX cart response carries no slug, so every place that
        // knows one (SSR cart, product page, quick view, product cards) records it here
        // for the rows the drawer builds in JS.
        slugs: {},
        rememberSlug(productId, slug) {
            if (productId && slug) this.slugs[productId] = slug;
        },

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
            // Count with its noun (cart head + drawer), never a bare number
            document.querySelectorAll('[data-cart-count-text]').forEach(function (el) {
                el.textContent = Utils.count(data.totalQuantity || 0);
            });
            // Free-shipping progress (ui/free-shipping.njk)
            var fsMsg = config.messages && config.messages.freeShipping;
            document.querySelectorAll('[data-free-shipping]').forEach(function (el) {
                var goal = Number(el.getAttribute('data-free-shipping')) || 0, total = Number(data.totalPrice) || 0;
                var text = el.querySelector('[data-fs-text]'), bar = el.querySelector('[data-fs-bar]');
                if (!goal || !fsMsg) return;
                if (text) text.textContent = total >= goal ? fsMsg.reached : String(fsMsg.left).replace('{amount}', Utils.formatMoney(goal - total));
                if (bar) bar.style.width = Math.min(100, Math.floor(total / goal * 100)) + '%';
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
                    var listEl = container.querySelector('.space-y-4');
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
                    var countEl = countBar.querySelector('[data-cart-count-text]');
                    if (countEl) countEl.textContent = Utils.count(data.totalQuantity);
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

        _buildItemHTML(item) {
            var id = item._id;
            var pd = item.productData || {};
            /* /ajax/cart/add answers with no slug (measured) — fall back to the
               productId → slug map; no slug at all → no link rather than a dead one */
            var rawSlug = pd.slug || pd.handle || CartManager.slugs[item.productId] || '';
            var href = rawSlug ? '/products/' + encodeURIComponent(rawSlug) : '';
            var title = Utils.esc(pd.title || '');
            var imageUrl = Utils.esc((pd.image && pd.image.fileUrl) || '');
            var q = "'" + Utils.esc(id) + "'";
            var totalPrice = Utils.formatMoney(item.totalPrice);
            var hasCompare = item.compareAtPrice && item.compareAtPrice > item.price;
            var totalComparePrice = hasCompare ? Utils.formatMoney(item.totalCompareAtPrice) : '';

            var imageHtml = imageUrl
                ? '<div class="w-20 h-20 overflow-hidden bg-secondary border">' +
                '<img src="' + imageUrl + '" alt="' + title + '" class="w-full h-full object-cover" loading="lazy"></div>'
                : '<div class="w-20 h-20 bg-secondary border flex items-center justify-center">' +
                '<svg class="w-7 h-7 text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>';

            var variantHtml = '';
            if (item.variantData && item.variantData.options && item.variantData.options.length) {
                variantHtml = '<div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1">';
                item.variantData.options.forEach(function (opt) {
                    var optName = Utils.esc((opt.option && opt.option.name) || '');
                    var optType = (opt.option && opt.option.type) || 'text';
                    var colorDot = optType === 'color'
                        ? '<span class="inline-block w-3 h-3 rounded-full border align-middle" style="background-color: ' + Utils.esc(Utils.swatchColor(opt.value, opt.label)) + '"></span>'
                        : '';
                    variantHtml += '<span class="text-[11px] text-tertiary flex items-center gap-1">' +
                        optName + ': ' + colorDot +
                        '<span class="text-secondary">' + Utils.esc(opt.label) + '</span></span>';
                });
                variantHtml += '</div>';
            }

            return '<div class="transition-all duration-300" data-cart-item="' + id + '" ' +
                'x-show="activeItems.includes(\'' + id + '\')" ' +
                'x-transition:enter="transition ease-out duration-300" ' +
                'x-transition:enter-start="opacity-0 translate-y-2" ' +
                'x-transition:enter-end="opacity-100 translate-y-0" ' +
                'x-transition:leave="transition ease-in duration-200" ' +
                'x-transition:leave-start="opacity-100" ' +
                'x-transition:leave-end="opacity-0" ' +
                ':class="{ \'opacity-20 pointer-events-none\': removingId === \'' + id + '\' }">' +
                '<div class="flex gap-3.5">' +
                (href ? '<a href="' + href + '" @click="$store.modal.close()" class="shrink-0">' + imageHtml + '</a>' : '<div class="shrink-0">' + imageHtml + '</div>') +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-start justify-between gap-2">' +
                (href
                    ? '<a href="' + href + '" @click="$store.modal.close()" class="text-[13px] font-semibold text-primary hover:text-primary transition-colors line-clamp-2 leading-snug">' + title + '</a>'
                    : '<span class="text-[13px] font-semibold text-primary line-clamp-2 leading-snug">' + title + '</span>') +
                '<button @click="removeItem(\'' + id + '\')" class="shrink-0 mt-0.5 text-tertiary hover:text-red-400 transition-colors p-0.5">' +
                '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
                '</button>' +
                '</div>' +
                variantHtml +
                '<p x-show="isOverStock(' + q + ')" x-cloak x-text="stockNote(' + q + ')" class="attar-citem-note"></p>' +
                '<div class="flex items-center justify-between mt-2.5">' +
                '<div class="inline-flex items-center bg-secondary rounded-full h-8">' +
                '<button @click="decrement(\'' + id + '\')" class="w-8 h-8 rounded-full flex items-center justify-center text-tertiary hover:text-primary hover:bg-white transition-all">' +
                '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 12H4"/></svg>' +
                '</button>' +
                '<span class="w-7 text-center text-xs font-bold text-primary">' +
                '<span x-show="updating !== \'' + id + '\'" x-text="quantities[\'' + id + '\']">' + item.quantity + '</span>' +
                '<svg x-show="updating === \'' + id + '\'" x-cloak class="w-3.5 h-3.5 animate-spin mx-auto text-primary" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>' +
                '</span>' +
                '<button @click="increment(' + q + ')" :class="{ \'opacity-30 cursor-not-allowed\': quantities[' + q + '] >= maxFor(' + q + ') }" class="w-8 h-8 rounded-full flex items-center justify-center text-tertiary hover:text-primary hover:bg-white transition-all">' +
                '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>' +
                '</button>' +
                '</div>' +
                '<div class="text-end">' +
                '<span class="text-sm font-bold text-primary transition-all" data-item-total="' + id + '" :class="{ \'animate-pulse text-primary\': updating === \'' + id + '\' }">' + totalPrice + '</span>' +
                (hasCompare ? '<span class="block text-[10px] text-tertiary line-through" data-item-compare="' + id + '">' + totalComparePrice + '</span>' : '') +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';
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
        stock: Stock,
        cards: Cards,
        demo: Demo,
        toast: Toast
    };

    // ===== Global Exports =====
    window.Qumra = Qumra;

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
            lines: {},   // itemId → { productId, variantId }
            limits: {},  // itemId → max purchasable units (null = unlimited, missing = not known yet)

            init() {
                (config.items || []).forEach(i => {
                    this.quantities[i.id] = i.qty;
                    this.activeItems.push(i.id);
                    this.lines[i.id] = { productId: i.productId, variantId: i.variantId || null };
                    CartManager.rememberSlug(i.productId, i.slug);
                });
                this._checkStock();

                window.addEventListener('cart:updated', (e) => {
                    this.updating = null;
                    this.removingId = null;
                    this.confirmRemoveId = null;
                    if (e.detail && e.detail.items) {
                        this.activeItems = e.detail.items.map(i => i._id);
                        e.detail.items.forEach(item => {
                            this.quantities[item._id] = item.quantity;
                            this.lines[item._id] = { productId: item.productId, variantId: item.variantId || null };
                        });
                    } else {
                        this.activeItems = [];
                    }
                    this._checkStock();
                });
            },

            // ── Stock: a sold-out or over-stock line blocks checkout (fail-open if stock is unknown) ──
            maxFor(id) {
                var l = this.limits[id];
                return l == null ? Infinity : l;
            },
            isSoldOut(id) { return this.limits[id] === 0; },
            isOverStock(id) {
                return this.activeItems.includes(id) && (this.quantities[id] || 0) > this.maxFor(id);
            },
            stockNote(id) {
                if (!this.isOverStock(id)) return '';
                if (this.isSoldOut(id)) return QumraConfig.messages.soldOut;
                return Utils.fillCount(QumraConfig.messages.onlyAvailable, this.limits[id]);
            },
            get checkoutBlocked() {
                return this.activeItems.some(id => this.isOverStock(id));
            },
            goCheckout(e) {
                if (this.checkoutBlocked) {
                    e.preventDefault();
                    Toast.error(QumraConfig.messages.checkoutBlocked);
                    return;
                }
                Alpine.store('modal').close();
            },
            _checkStock() {
                var self = this;
                this.activeItems.forEach(function (id) {
                    var line = self.lines[id];
                    if (!line) return;
                    Stock.product(CartManager.slugs[line.productId]).then(function (p) {
                        if (!p) return;
                        var v = line.variantId && (p.variants || []).find(function (x) { return x._id === line.variantId; });
                        var entity = v ? Object.assign({ isVariant: true }, v) : p;
                        self.limits[id] = Stock.limit(entity);
                    });
                });
            },

            increment(id) {
                var next = (this.quantities[id] || 1) + 1;
                if (next > this.maxFor(id)) {
                    Toast.warning(Utils.fillCount(QumraConfig.messages.onlyAvailable, this.limits[id]));
                    return;
                }
                this.quantities[id] = next;
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
            var _rh = cfg.rangeHandle || 'price';
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

            // The page's own collection may be missing from the list (it only holds what the
            // platform sends) — add it so the title, breadcrumb and chips still know it.
            var _cols = (cfg.collections || []).slice();
            if (cfg.current && cfg.current.id && !_cols.some(function (c) { return c.id === cfg.current.id; })) _cols.push(cfg.current);
            cfg.collections = _cols;

            return {
                searchQuery: cfg.query || '',
                collectionId: cfg.collectionId || '',
                collections: _cols,
                cardSettings: cfg.cardSettings || {},
                translations: cfg.translations || {},
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

                // --- Section mode helpers (qumra.filters API) ---
                _sectionTimer: null,

                _sectionOp(filterFn) {
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
                    try {
                        filterFn();
                    } catch (e) {
                        console.error('Filter error:', e);
                        self.loading = false;
                        clearTimeout(self._sectionTimer);
                    }
                },

                _syncSidebarCount() {
                    var wrapper = document.querySelector('#products-grid-wrapper');
                    var newCount = wrapper && wrapper.querySelector('#products-count-data');
                    var sidebarCount = document.querySelector('#products-count');
                    if (newCount && sidebarCount) {
                        sidebarCount.innerHTML = newCount.innerHTML;
                    }
                },

                // --- Filter actions ---

                sortBy(value) {
                    var mapped = _sortMap[value] || value;
                    this.currentSort = value;
                    if (cfg.section && !this.searchQuery) {
                        this._sectionOp(function () { return qumra.filters.sort(mapped || ''); });
                        return;
                    }
                    var url = new URL(window.location);
                    if (mapped) url.searchParams.set('sort', mapped);
                    else url.searchParams.delete('sort');
                    url.searchParams.delete('page');
                    this._fetch(url);
                },

                toggleFilter(handle, value) {
                    // Update reactive state
                    if (!this._activeFilters[handle]) this._activeFilters[handle] = [];
                    var idx = this._activeFilters[handle].indexOf(value);
                    if (idx >= 0) this._activeFilters[handle].splice(idx, 1);
                    else this._activeFilters[handle].push(value);
                    // Force Alpine reactivity
                    this._activeFilters = Object.assign({}, this._activeFilters);

                    if (cfg.section && !this.searchQuery) {
                        this._sectionOp(function () { return qumra.filters.toggle(handle, value); });
                        return;
                    }
                    var url = new URL(window.location);
                    var key = 'filters[' + handle + '][]';
                    var existing = url.searchParams.getAll(key);
                    url.searchParams.delete(key);
                    var existIdx = existing.indexOf(value);
                    if (existIdx >= 0) existing.splice(existIdx, 1);
                    else existing.push(value);
                    existing.forEach(function (v) { url.searchParams.append(key, v); });
                    url.searchParams.delete('page');
                    this._fetch(url);
                },

                _debouncedApplyPrice() {
                    clearTimeout(this._priceTimer);
                    this._priceTimer = setTimeout(() => {
                        this.applyPrice();
                    }, 500);
                },

                applyPrice() {
                    var rh = this.rangeHandle;
                    var min = this.priceMin;
                    var max = this.priceMax;
                    if (cfg.section && !this.searchQuery) {
                        this._sectionOp(function () { return qumra.filters.range(rh, { min: min, max: max }); });
                        return;
                    }
                    var url = new URL(window.location);
                    if (min) url.searchParams.set('filters[' + rh + '][min]', min);
                    else url.searchParams.delete('filters[' + rh + '][min]');
                    if (max) url.searchParams.set('filters[' + rh + '][max]', max);
                    else url.searchParams.delete('filters[' + rh + '][max]');
                    url.searchParams.delete('page');
                    this._fetch(url);
                },

                clearFilters() {
                    this.priceMin = '';
                    this.priceMax = '';
                    this._activeFilters = {};
                    if (cfg.section && !this.searchQuery) {
                        this._sectionOp(function () { return qumra.filters.clear(); });
                        return;
                    }
                    var url = new URL(window.location);
                    url.searchParams.delete('page');
                    var keysToRemove = [];
                    url.searchParams.forEach(function (v, k) { if (k.startsWith('filters[')) keysToRemove.push(k); });
                    var unique = [];
                    keysToRemove.forEach(function (k) { if (unique.indexOf(k) === -1) unique.push(k); });
                    unique.forEach(function (k) { url.searchParams.delete(k); });
                    this._fetch(url);
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
                            countHtml = '<p class="text-sm text-secondary"><span class="font-bold text-primary">' + Utils.esc(Utils.count(totalItems)) + '</span></p>';
                        }
                        countEl.innerHTML = countHtml;
                    }

                    if (products.length > 0) {
                        var gridClass = cs.gridClass || 'md:grid-cols-2 lg:grid-cols-3';
                        var html = '<div class="grid grid-cols-2 gap-3 md:gap-5 ' + (/lg:grid-cols-4/.test(gridClass) ? 'attar-fit-4 attar-fit-span-sm attar-lone-sm2 attar-lone-md3' : 'attar-fit-3 attar-fit-span attar-fit-span-sm') + ' ' + gridClass + '">';
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
                            '<div class="flex flex-col items-center justify-center py-20 text-center">' +
                            '<div class="w-24 h-24 rounded-full bg-secondary flex items-center justify-center mb-5">' +
                            '<svg class="w-12 h-12 text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + emptyIcon + '</svg>' +
                            '</div>' +
                            '<h3 class="text-lg font-bold text-primary mb-2">' + emptyTitle + '</h3>' +
                            '<p class="text-secondary text-sm mb-6 max-w-md mx-auto">' + emptyText + '</p>' +
                            '<a href="/" class="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:opacity-80 transition-colors">' +
                            (tr.home || '') +
                            '<svg class="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>' +
                            '</svg>' +
                            '</a>' +
                            '</div>';
                    }
                },

                _buildProductCard(product) {
                    // Same card as the server render (ui/product-card.njk) — see Cards.product
                    var cs = this.cardSettings || {};
                    return '<div class="ajax-card h-full">' + Cards.product(product, { ratio: cs.imageRatio }) + '</div>';
                },

                _buildPagination(pagination) {
                    var enter = 'this.style.background=\'var(--color-text-primary)\';this.style.color=\'var(--color-bg-primary)\'';
                    var leave = 'this.style.background=\'transparent\';this.style.color=\'var(--color-text-primary)\'';
                    var cell = 'w-11 h-11 max-sm:w-10 max-sm:h-10 flex items-center justify-center transition-colors text-sm';
                    var arrowPrev = '<svg class="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7"/></svg>';
                    var arrowNext = '<svg class="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7"/></svg>';
                    var h = '<nav class="flex items-center justify-center gap-2 mt-14" aria-label="pagination">';
                    if (pagination.currentPage > 1) {
                        h += '<button @click.prevent="goToPage(' + (pagination.currentPage - 1) + ')" class="' + cell + '" style="border:1px solid var(--color-border); color:var(--color-text-primary);" onmouseenter="' + enter + '" onmouseleave="' + leave + '">' + arrowPrev + '</button>';
                    } else {
                        h += '<span class="' + cell + '" style="border:1px solid var(--color-border); color:var(--color-text-tertiary); opacity:.4;">' + arrowPrev + '</span>';
                    }
                    for (var i = 1; i <= pagination.totalPages; i++) {
                        if (i === pagination.currentPage) {
                            h += '<span class="' + cell + '" style="background:var(--color-text-primary); color:var(--color-bg-primary); border:1px solid var(--color-text-primary);">' + i + '</span>';
                        } else if (i === 1 || i === pagination.totalPages || (i >= pagination.currentPage - 1 && i <= pagination.currentPage + 1)) {
                            h += '<button @click.prevent="goToPage(' + i + ')" class="' + cell + '" style="border:1px solid var(--color-border); color:var(--color-text-secondary);" onmouseenter="' + enter + '" onmouseleave="' + leave + '">' + i + '</button>';
                        } else if (i === pagination.currentPage - 2 || i === pagination.currentPage + 2) {
                            h += '<span class="w-6 flex items-center justify-center text-sm" style="color:var(--color-text-tertiary);">…</span>';
                        }
                    }
                    if (pagination.hasNextPage) {
                        h += '<button @click.prevent="goToPage(' + (pagination.currentPage + 1) + ')" class="' + cell + '" style="border:1px solid var(--color-border); color:var(--color-text-primary);" onmouseenter="' + enter + '" onmouseleave="' + leave + '">' + arrowNext + '</button>';
                    } else {
                        h += '<span class="' + cell + '" style="border:1px solid var(--color-border); color:var(--color-text-tertiary); opacity:.4;">' + arrowNext + '</span>';
                    }
                    h += '</nav>';
                    return h;
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
                        if (typeof qumra !== 'undefined' && qumra.filters && qumra.filters.section) {
                            qumra.filters.section(cfg.section);
                        }
                        var wrapper = document.querySelector('#products-grid-wrapper');
                        if (wrapper) {
                            var countTimer;
                            new MutationObserver(function () {
                                clearTimeout(countTimer);
                                clearTimeout(self._sectionTimer);
                                countTimer = setTimeout(function () {
                                    self._syncSidebarCount();
                                    self.loading = false;
                                }, 100);
                            }).observe(wrapper, { childList: true });

                            setTimeout(function () {
                                if (!wrapper.children.length || !wrapper.textContent.trim()) {
                                    if (typeof qumra !== 'undefined' && qumra.filters && qumra.filters.sort) {
                                        var p = new URLSearchParams(window.location.search);
                                        var sort = p.get('sort') || '';
                                        try { qumra.filters.sort(sort); } catch (e) { }
                                    }
                                } else {
                                    self._syncSidebarCount();
                                }
                            }, 500);
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
            cartLoading: false,
            cartSuccess: false,
            wishlistLoading: false,

            init() {
                var a = this.$el.querySelector('a[href^="/products/"]');
                var m = a && a.getAttribute('href').match(/^\/products\/([^?#]+)/);
                if (m) CartManager.rememberSlug(this.productId, decodeURIComponent(m[1]));
            },

            get inWishlist() {
                return Alpine.store('wishlist').has(this.productId);
            },

            // Cards built from search results can't tell if a product has variants.
            // Check first; if it does, open quick view to choose instead of a failed add.
            async _needsOptions() {
                // $root: inside a click handler $el is the button, which never carries the flag
                if (!this.$root.hasAttribute('data-check-variants')) return false;
                var slug = CartManager.slugs[this.productId];
                var p = await Stock.product(slug);
                if (p && ((p.variants || []).length || (p.options || []).length)) {
                    this.$dispatch('quick-view', { slug: slug });
                    return true;
                }
                return false;
            },

            async addToCart() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (await this._needsOptions()) return;
                    await Qumra.cart.add(this.productId);
                    this.cartSuccess = true;
                    setTimeout(() => { this.cartSuccess = false; }, 2000);
                } catch (e) {
                    // The toast comes from CartManager. A refused add (options the listing didn't
                    // tell us about, stock it couldn't see) is settled on the product page.
                    var slug = CartManager.slugs[this.productId];
                    if (e && e.status === 400 && slug) window.location.href = '/products/' + encodeURIComponent(slug);
                } finally {
                    this.cartLoading = false;
                }
            },

            async buyNow() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (await this._needsOptions()) { this.cartLoading = false; return; }
                    await Qumra.cart.add(this.productId);
                    window.location.href = '/cart';
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

    // ===== Arabic text on the English storefront =====
    // Saved merchant text stays Arabic under lang="en", where :lang(ar) can't reset the
    // uppercase labels' letter-spacing (it breaks joined letters) — .attar-ar does.
    if (document.documentElement.lang === 'en') {
        document.addEventListener('DOMContentLoaded', function () {
            var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                var el = walker.currentNode.parentElement;
                if (el && !/^(SCRIPT|STYLE)$/.test(el.tagName) && /[\u0600-\u06FF]/.test(walker.currentNode.nodeValue)) el.classList.add('attar-ar');
            }
        });
    }

    // ===== Scroll Reveal (IntersectionObserver) =====
    // Skip entirely inside builder preview (iframe) so widgets stay visible
    if (window.self === window.top) {
        document.documentElement.classList.add('reveal-init');

        var _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('attar-no-motion');

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
        }, { threshold: 0, rootMargin: '0px 0px 15% 0px' });

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

    // ===== Autoplay only while visible =====
    // Anything that moves by itself stops when it's off-screen (document.hidden only
    // covers a background tab). Swiper keeps its instance on el.swiper.
    if ('IntersectionObserver' in window) {
        window.addEventListener('load', function () {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    var sw = entry.target.swiper;
                    if (!sw || !sw.autoplay || !sw.params.autoplay || !sw.params.autoplay.enabled) return;
                    if (entry.isIntersecting) sw.autoplay.start(); else sw.autoplay.stop();
                });
            });
            document.querySelectorAll('.swiper').forEach(function (el) { io.observe(el); });
        });
    }

    // ===== Sticky columns taller than the screen =====
    // A sticky box taller than the viewport pins with its lower half out of reach. Give
    // it a negative `top`: it scrolls until its bottom shows, then sticks.
    (function () {
        var SEL = '[data-sticky-fit]';
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

})();
