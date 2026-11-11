
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
    const _moneyFormat = (function () {
        var sample = (config.moneyFormatSample || '').trim();
        var symbol = config.currencySymbol || '';
        if (!sample || !symbol) return { useComma: true, space: ' ' };
        var idx = sample.indexOf(symbol);
        var hasSpace = idx > 0 && sample[idx - 1] === ' ';
        var numPart = sample.substring(0, hasSpace ? idx - 1 : idx);
        return { useComma: numPart.indexOf(',') !== -1, space: hasSpace ? ' ' : '', decimals: numPart.indexOf('.') !== -1 };
    })();

    const Utils = {
        /* Twin of ui/count.njk: منتج واحد · منتجان · 3 منتجات · 11 منتج */
        countText(n) {
            var t = config.card || {};
            n = Number(n) || 0;
            if (n === 1) return t.countOne;
            if (n === 2) return t.countTwo;
            return n + ' ' + (n >= 3 && n <= 10 ? t.countFew : t.countMany);
        },

        formatMoney(amount) {
            if (amount == null) return '';
            var num = Number(amount);
            var formatted;
            /* same as the server's `| money`: «260ج.م», not «260.00ج.م» beside it */
            var digits = (_moneyFormat.decimals || num % 1 !== 0) ? 2 : 0;
            if (_moneyFormat.useComma) {
                formatted = num.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
            } else {
                formatted = num.toFixed(digits);
            }
            return formatted + _moneyFormat.space + QumraConfig.defaults.currencySymbol;
        },

        calcDiscount(price, compareAtPrice) {
            if (!compareAtPrice || compareAtPrice <= price) return 0;
            /* FLOOR, not round. 500 against 800 is 37.5% off; rounding
               advertises 38% for a cut that is not 38%, and overstating a
               discount is the one direction that is wrong in more than taste. */
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
       LamsaCard — the ONE JavaScript product-card renderer
       -------------------------------------------------------------------------
       ⚠️  THIS CARD HAS A TWIN: ui/product-card.njk renders the same markup
       server-side. If you change the structure here, change it there too.
       All styling lives in assets/style.css → "PRODUCT CARD", so the two can
       never drift visually — only the markup order has to stay in sync.

       Every widget that renders products from JSON must call
       LamsaCard.build(product, opts) instead of writing its own template.
       ====================================================================== */
    const LamsaCard = {
        _t: (config.card || {}),
        _defaults: (config.cardDefaults || {}),

        esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        /* Accepts both the LAMSA vocabulary ('1/1', '4/5', '3/4', '4/3') and the
           legacy widget vocabulary ('square', 'portrait', 'landscape'). */
        ratioClass(ratio) {
            switch (ratio) {
                case '4/5': return 'lamsa-ratio-4/5';
                case '3/4':
                case 'portrait': return 'lamsa-ratio-3/4';
                case '4/3':
                case 'landscape': return 'lamsa-ratio-4/3';
                default: return 'lamsa-ratio-1/1';   // '1/1' | 'square' | unset
            }
        },

        _starPath: 'm12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45L2.6 9.45l6.5-.95L12 2.6Z',

        _star(cls) {
            return '<svg' + (cls ? ' class="' + cls + '"' : '') +
                ' viewBox="0 0 24 24" fill="currentColor"><path d="' + this._starPath + '"/></svg>';
        },

        stars(rating, reviews) {
            var full = Math.floor(rating);
            var half = (rating - full) >= 0.25;
            var h = '<span class="lamsa-stars lamsa-stars--sm">';
            for (var i = 1; i <= 5; i++) {
                if (i <= full) h += this._star();
                else if (i === full + 1 && half) h += '<span class="lamsa-star-half">' + this._star() + this._star() + '</span>';
                else h += this._star('lamsa-star-empty');
            }
            h += '</span><span class="lamsa-rating-count">(' + reviews + ')</span>';
            return '<div class="flex items-center gap-1.5">' + h + '</div>';
        },

        /* Every `color` option becomes one swatch row — same rule as the njk. */
        swatches(options) {
            var self = this, out = '';
            (options || []).forEach(function (o) {
                if (o.type !== 'color' || !o.values || !o.values.length) return;
                var vals = o.values;
                out += '<div class="lamsa-swatches" role="img" aria-label="' +
                    self.esc(o.name) + ': ' + vals.length + '">';
                vals.slice(0, 5).forEach(function (v) {
                    out += '<span class="lamsa-swatch lamsa-swatch--sm" data-swatch="' + self.esc(v.label) +
                        '" data-swatch-value="' + self.esc(v.value || '') + '" title="' + self.esc(v.label) + '"></span>';
                });
                if (vals.length > 5) out += '<span class="lamsa-swatch-more">+' + (vals.length - 5) + '</span>';
                out += '</div>';
            });
            return out;
        },

        _atcInner(label) {
            return '<span x-show="cartLoading" class="lamsa-spinner" style="width:15px;height:15px;border-width:1.5px;"></span>' +
                '<span x-show="cartSuccess && !cartLoading" x-cloak class="inline-flex items-center gap-1.5">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
                '<path stroke-linecap="round" stroke-linejoin="round" d="M4 12.5 9.5 18 20 6.5"/></svg>' +
                this.esc(this._t.added) + '</span>' +
                '<span x-show="!cartLoading && !cartSuccess">' + this.esc(label) + '</span>';
        },

        /* Twin of the stock block in ui/product-card.njk. Listing payloads carry
           no trackQuantity, so `!p.trackQuantity` alone read every card as in
           stock. Trust isAvailable → full rule → listing rule, in that order. */
        isInStock(p) {
            if (p.isAvailable !== undefined && p.isAvailable !== null) return !!p.isAvailable;
            if (p.trackQuantity !== undefined && p.trackQuantity !== null) {
                return !!(p.allowBackorder || !p.trackQuantity || p.quantity > 0);
            }
            return true;
        },

        /* Twin of `stockUnknown` in ui/product-card.njk: quantity 0 on a listing
           with no variant data is unknown, so the card links to the product. */
        isStockUnknown(p) {
            if (p.isAvailable !== undefined && p.isAvailable !== null) return false;
            if (p.trackQuantity !== undefined && p.trackQuantity !== null) return false;
            return !p.allowBackorder && !(p.quantity > 0);
        },

        build(p, opts) {
            if (!p) return '';
            var o = Object.assign({}, this._defaults, opts || {});
            var t = this._t;

            var price = (p.pricing && p.pricing.price) || 0;
            var was = (p.pricing && p.pricing.compareAtPrice) || 0;
            var onSale = was && was > price;
            var off = onSale ? Math.floor(((was - price) / was) * 100) : 0;

            var inStock = this.isInStock(p);
            var stockUnknown = this.isStockUnknown(p);
            var hasVariants = (p.variantsCount && p.variantsCount > 0) || (p.options && p.options.length > 0);

            var imgs = p.images || [];
            var img = imgs[0] && imgs[0].fileUrl;
            var imgAlt = (o.showSecondImage && imgs[1] && imgs[1].fileUrl) || '';

            var title = this.esc(p.title);
            var slug = p.slug || p.handle || p._id;
            var url = '/products/' + slug;

            var h = '<article class="lamsa-pcard ajax-card group" x-data="productCard(\'' + p._id + '\', ' + this.esc(JSON.stringify(slug)) + ')">';

            /* ---------- media ---------- */
            h += '<div class="lamsa-pcard-media ' + this.ratioClass(o.imageRatio) + '">';
            h += '<a href="' + url + '" aria-label="' + title + '">';
            if (img) {
                h += '<img src="' + this.esc(img) + '" alt="' + title + '" loading="lazy" class="lamsa-pcard-img' +
                    (imgAlt ? '' : ' lamsa-pcard-img--only') + '"/>';
                if (imgAlt) {
                    h += '<img src="' + this.esc(imgAlt) + '" alt="' + title +
                        '" loading="lazy" class="lamsa-pcard-img lamsa-pcard-img--alt"/>';
                }
            } else {
                h += '<span class="lamsa-pcard-noimg"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">' +
                    '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.75" cy="9" r="1.75"/>' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="m4 17 5-4.5 4.5 4 3-2.5L21 18"/></svg></span>';
            }
            h += '</a>';

            if (onSale) {
                h += '<div class="lamsa-pcard-badges"><span class="lamsa-badge lamsa-badge--sale font-num">−' + off + '%</span></div>';
            }

            if (o.showQuickView) {
                h += '<button type="button" class="lamsa-btn-icon lamsa-btn-icon--filled lamsa-btn-icon--sm lamsa-pcard-quick" aria-label="' +
                    this.esc(t.quickView) + '" @click.prevent="$dispatch(\'quick-view\', { slug: \'' + this.esc(slug) + '\' })">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
                    '<circle cx="12" cy="12" r="2.75"/></svg></button>';
            }

            if (!inStock) {
                h += '<div class="lamsa-soldout-veil"><span>' + this.esc(t.outOfStock) + '</span></div>';
            }

            if (inStock && o.atcStyle === 'tray') {
                h += '<div class="lamsa-reveal-tray">';
                h += (hasVariants || stockUnknown)
                    ? '<a href="' + url + '" class="lamsa-btn lamsa-btn--light lamsa-btn--sm lamsa-pcard-atc">' + this.esc(hasVariants ? t.chooseOptions : t.viewProduct) + '</a>'
                    : '<button type="button" @click.prevent="addToCart()" :disabled="cartLoading || cartSuccess" class="lamsa-btn lamsa-btn--light lamsa-btn--sm lamsa-pcard-atc">' +
                      this._atcInner(t.addToCart) + '</button>';
                h += '</div>';
            }
            h += '</div>';

            /* ---------- body ---------- */
            h += '<div class="lamsa-pcard-body">';

            if (o.showSwatches) h += this.swatches(p.options);

            h += '<a href="' + url + '" class="lamsa-pcard-name line-clamp-2">' + title + '</a>';

            var reviews = p.reviewsCount || 0;
            if (o.showRating && reviews > 0) h += this.stars(p.averageRating || 0, reviews);

            if (o.showSuitability && Array.isArray(p.tags) && p.tags.length) {
                h += '<div class="flex flex-wrap gap-1.5">';
                p.tags.slice(0, 2).forEach((tag) => {
                    /* live tags are objects — read their text, skip anything empty */
                    if (tag && typeof tag === 'object') tag = tag.displayName || tag.name || tag.title || tag.label || tag.value || '';
                    if (!tag) return;
                    h += '<span class="lamsa-suit">' + this.esc(tag) + '</span>';
                });
                h += '</div>';
            }

            h += '<div class="lamsa-pcard-prices">';
            if (price > 0) h += '<span class="lamsa-price">' + Utils.formatMoney(price) + '</span>';
            if (onSale) h += '<span class="lamsa-price-was">' + Utils.formatMoney(was) + '</span>';
            h += '</div>';

            if (inStock && o.atcStyle === 'always') {
                h += (hasVariants || stockUnknown)
                    ? '<a href="' + url + '" class="lamsa-btn lamsa-btn--soft lamsa-btn--sm lamsa-btn--block mt-1">' + this.esc(hasVariants ? t.chooseOptions : t.viewProduct) + '</a>'
                    : '<button type="button" @click.prevent="addToCart()" :disabled="cartLoading || cartSuccess" class="lamsa-btn lamsa-btn--soft lamsa-btn--sm lamsa-btn--block mt-1">' +
                      this._atcInner(t.addToCart) + '</button>';
            }

            h += '</div></article>';
            return h;
        },

        /* Render a list of products into a container and boot Alpine on them. */
        mount(container, products, opts) {
            if (!container) return;
            var self = this;
            container.innerHTML = (products || []).map(function (p) { return self.build(p, opts); }).join('');
            LamsaSwatch.paint(container);
            if (window.Alpine) {
                container.querySelectorAll('[x-data]').forEach(function (el) { Alpine.initTree(el); });
            }
        }
    };

    /* =========================================================================
       LamsaCartItem — the ONE JavaScript cart-line renderer
       -------------------------------------------------------------------------
       ⚠️  THIS LINE HAS A TWIN: ui/cart-item.njk renders the same markup
       server-side (drawer + cart page). Change one, change the other.
       Styling lives in assets/style.css → "CART ITEM".

       Only used when CartManager adds a row to an ALREADY-RENDERED drawer, so
       it must emit the same data-* hooks _refreshDrawer() looks for.
       ====================================================================== */
    const LamsaCartItem = {
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
            var url = '/products/' + (pd.slug || pd.handle || '');
            var img = (pd.image && pd.image.fileUrl) || '';
            var hasCompare = item.compareAtPrice && item.compareAtPrice > item.price;
            var onClick = o.onClick || "$store.modal.close()";
            var t = this._t;

            var h = '<div class="lamsa-citem' + (compact ? ' lamsa-citem--compact' : '') + '"' +
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
            h += '<a href="' + url + '" class="lamsa-citem-media" @click="' + onClick + '">';
            h += img
                ? '<img src="' + this.esc(img) + '" alt="' + title + '" loading="lazy"/>'
                : '<span class="absolute inset-0 flex items-center justify-center" style="color: var(--color-accent-soft);">' +
                  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.75" cy="9" r="1.75"/>' +
                  '<path d="m4 17 5-4.5 4.5 4 3-2.5L21 18"/></svg></span>';
            h += '</a>';

            /* ---- body ---- */
            h += '<div class="lamsa-citem-body">';
            h += '<div class="flex items-start justify-between gap-2">' +
                '<a href="' + url + '" class="lamsa-citem-name line-clamp-2" @click="' + onClick + '">' + title + '</a>' +
                '<button type="button" @click="removeItem(\'' + id + '\')" class="lamsa-citem-remove" aria-label="' + this.esc(t.remove) + '">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button></div>';

            /* ---- selected options ---- */
            var opts_ = (item.variantData && item.variantData.options) || [];
            if (opts_.length) {
                h += '<div class="flex flex-wrap items-center gap-x-3 gap-y-1">';
                opts_.forEach((op) => {
                    var name = (op.option && op.option.name) || '';
                    var isColor = op.option && op.option.type === 'color';
                    h += '<span class="lamsa-citem-opt">' + this.esc(name) + ': ' +
                        (isColor ? '<span class="lamsa-citem-dot" style="background: ' + this.esc(op.value || '#E7C6CE') + ';"></span>' : '') +
                        '<span style="color: var(--color-text-secondary);">' + this.esc(op.label) + '</span></span>';
                });
                h += '</div>';
            }

            /* ---- qty + price ---- */
            h += '<div class="lamsa-citem-foot">' +
                '<div class="lamsa-qty lamsa-qty--sm">' +
                '<button type="button" @click="decrement(\'' + id + '\')" aria-label="-">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M5 12h14"/></svg></button>' +
                '<span class="lamsa-qty-value">' +
                '<span x-show="updating !== \'' + id + '\'" x-text="quantities[\'' + id + '\']">' + item.quantity + '</span>' +
                '<span x-show="updating === \'' + id + '\'" x-cloak class="lamsa-spinner" style="width:13px;height:13px;border-width:1.5px;"></span>' +
                '</span>' +
                '<button type="button" @click="increment(\'' + id + '\')" aria-label="+">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg></button>' +
                '</div>' +
                '<div class="text-end">' +
                /* unit price × qty — mirrors the same block in ui/cart.njk */
                '<span class="lamsa-citem-unit" title="' + this.esc(t.unitPrice) + '">' +
                '<bdi>' + Utils.formatMoney(item.price) + '</bdi>' +
                '<span aria-hidden="true">×</span>' +
                '<bdi x-text="quantities[\'' + id + '\']">' + item.quantity + '</bdi>' +
                '</span>' +
                '<span class="lamsa-price block" data-item-total="' + id + '" :class="updating === \'' + id + '\' && \'opacity-50\'">' +
                Utils.formatMoney(item.totalPrice) + '</span>' +
                '<span class="lamsa-price-was block" data-item-compare="' + id + '"' +
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
                EventBus.emit('cart:item-added', { productId, quantity: body.quantity, data });

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
                /* before cart:updated — listeners that need to describe the line
                   that left still have the previous snapshot at this point */
                EventBus.emit('cart:item-removed', { itemId, data });
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

        /* Delegates to LamsaCartItem — the single JS cart-line renderer.
           Do not inline cart markup here again. */
        _buildItemHTML(item) {
            return LamsaCartItem.build(item);
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
                /* live variants carry `pricing.{price, compareAtPrice}` */
                price: (variant.pricing ? variant.pricing.price : variant.price) * (quantity || 1),
                compareAtPrice: ((variant.pricing ? variant.pricing.compareAtPrice : variant.compareAtPrice) || 0) * (quantity || 1)
            };
        }
    };

    /* =========================================================================
       Analytics · GA4 ecommerce
       -------------------------------------------------------------------------
       Every event is derived from the cart payloads the theme already emits, so
       nothing in CartManager or any widget needs to know this module exists. If
       the merchant has not set a Measurement ID, `gtag` is never defined and
       every call here is a no-op — that is the whole guard.
       ====================================================================== */
    const Analytics = {
        /* last cart lines we saw, so a removal can still describe what left */
        _prev: [],

        get _live() { return typeof window.gtag === 'function'; },

        /* ?lamsa_debug=1 prints every event and its full payload to the console.
           It does NOT send anything — in dev `gtag` is undefined anyway, so this
           is the only way to watch the ecommerce events while building. On a
           published store it prints alongside the real send. */
        _debug: /[?&]lamsa_debug=1/.test(window.location.search),

        /* THE one place that decides the money scale.
           Prices arrive from the API in whatever unit the `| money` filter also
           works in, and Utils.formatMoney prints them unchanged — so GA gets the
           same number the shopper reads. If the scale is ever detected properly
           (see the MONEY note on Utils.formatMoney), fix it HERE and both the
           displayed price and the reported revenue move together. */
        _value(raw) {
            var n = Number(raw);
            return isFinite(n) ? Math.round(n * 100) / 100 : 0;
        },

        _currency() { return (QumraConfig.defaults && QumraConfig.defaults.currency) || 'SAR'; },

        /* a cart line -> a GA4 item */
        _item(line, index) {
            var pd = (line && line.productData) || {};
            var it = {
                item_id: String(pd._id || pd.slug || pd.handle || line._id || ''),
                item_name: String(pd.title || ''),
                price: this._value(line.price),
                quantity: Number(line.quantity) || 1
            };
            if (typeof index === 'number') it.index = index;
            var opts = line.variantData && line.variantData.options;
            if (Array.isArray(opts) && opts.length) {
                it.item_variant = opts.map(function (o) { return o.value || o.label || o; }).join(' / ');
            }
            return it;
        },

        _items(lines) {
            var self = this;
            return (lines || []).map(function (l, i) { return self._item(l, i); });
        },

        send(name, params) {
            if (this._debug) {
                console.log('%c[GA4] ' + name + (this._live ? '' : '  (debug only — not sent)'),
                    'color:#C97B8E;font-weight:700', params);
            }
            if (!this._live) return;
            try { window.gtag('event', name, params); } catch (e) { /* never break the store */ }
        },

        /* ---- the events ---- */

        viewItem() {
            var p = window.__LAMSA_VIEW_ITEM__;
            if (!p || !p.item_id) return;
            this.send('view_item', {
                currency: this._currency(),
                value: this._value(p.price),
                items: [{
                    item_id: String(p.item_id),
                    item_name: String(p.item_name || ''),
                    price: this._value(p.price),
                    quantity: 1
                }]
            });
        },

        addToCart(productId, quantity, data) {
            var lines = (data && data.items) || [];
            var line = lines.filter(function (l) {
                var pd = l.productData || {};
                return pd._id === productId || l.productId === productId;
            })[0];
            if (!line) return;
            /* the payload is the cart AFTER the add, so the line's quantity is the
               new running total — GA4 wants how many were just added. */
            var it = this._item(line);
            it.quantity = Number(quantity) || 1;
            this.send('add_to_cart', {
                currency: this._currency(),
                value: this._value(it.price * it.quantity),
                items: [it]
            });
        },

        removeFromCart(itemId) {
            var line = this._prev.filter(function (l) { return l._id === itemId; })[0];
            if (!line) return;
            var it = this._item(line);
            this.send('remove_from_cart', {
                currency: this._currency(),
                value: this._value(it.price * it.quantity),
                items: [it]
            });
        },

        viewCart(data) {
            var lines = (data && data.items) || this._prev;
            if (!lines.length) return;
            this.send('view_cart', {
                currency: this._currency(),
                value: this._value(data && data.totalPrice),
                items: this._items(lines)
            });
        },

        beginCheckout() {
            if (!this._prev.length) return;
            this.send('begin_checkout', {
                currency: this._currency(),
                value: this._value(this._cartTotal),
                items: this._items(this._prev)
            });
        },

        /* ---- wiring: everything hangs off events the theme already fires ---- */
        init() {
            var self = this;

            /* keep a snapshot so a removal can still name what was removed */
            EventBus.on('cart:updated', function (data) {
                self._prev = (data && data.items) || [];
                self._cartTotal = data && data.totalPrice;
            });

            EventBus.on('cart:item-added', function (e) {
                self.addToCart(e.productId, e.quantity, e.data);
            });

            /* fires BEFORE _prev is refreshed, which is exactly why it can still
               describe the line that is on its way out */
            EventBus.on('cart:item-removed', function (e) { self.removeFromCart(e.itemId); });

            EventBus.on('modal:open', function (e) { if (e && e.name === 'cart') self.viewCart(null); });

            /* checkout is a plain link in both the drawer and the cart page, so
               one delegated listener covers every entry point present or future */
            document.addEventListener('click', function (ev) {
                var a = ev.target && ev.target.closest && ev.target.closest('a[href*="/checkout"]');
                if (a) self.beginCheckout();
            }, true);

            if (self._debug) {
                console.log('%c[GA4] watching', 'color:#C97B8E;font-weight:700', {
                    sending: self._live,
                    reason: self._live ? 'gtag loaded' : 'no gtag — set a Measurement ID and publish to send for real',
                    currency: self._currency()
                });
            }

            self.viewItem();
            if (document.querySelector('[data-cart-page]')) {
                CartManager.get().then(function (d) { self.viewCart(d); }).catch(function () {});
            }
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
    /* =========================================================================
       LamsaStock · one source for every stock number the shopper reads
       -------------------------------------------------------------------------
       Used by the PDP (widgets/product-detail) and Quick View. Rules, all
       measured against the real store payloads:

       · No variants → limited only when trackQuantity && !allowBackorder,
         judged on product.quantity.
       · Variants    → judged on the SELECTED variant only; the parent quantity
         is ignored. A variant is limited unless allowBackorder — variant-level
         trackQuantity:false is NOT unlimited: the cart accepts it but the
         order is refused with order.product_out_of_stock.
       · isAvailable === false from the server always wins.

       Two numbers, never mixed up:
         available(): max(0, limit − inCart)   → every sentence + the add guard
         maxQty():    max(1, limit − inCart)   → the quantity stepper ONLY
       The floor of 1 keeps the stepper usable; fed to a guard or a sentence
       it lets "1 > 1 → false" through on every click.

       state() is exhaustive and exclusive — exactly one line renders:
         'out'     the store has none            → button disabled
         'incart'  available === 0               → button disabled
         'low'     1 … threshold left            → button enabled
         'in'      null (no cap) or > threshold  → button enabled
       ====================================================================== */
    const LamsaStock = {
        /* limit = the shelf count, or null when there is no cap */
        limit(product, variant) {
            if (variant) {
                if (variant.isAvailable === false) return 0;
                return variant.allowBackorder ? null : Math.max(0, Number(variant.quantity) || 0);
            }
            if (product.isAvailable === false) return 0;
            if (product.trackQuantity && !product.allowBackorder) {
                return Math.max(0, Number(product.quantity) || 0);
            }
            return null;
        },

        /* units of this exact line already in the cart */
        inCart(lines, productId, variantId) {
            return (lines || []).reduce(function (sum, l) {
                var pid = String(l.productId || (l.productData && l.productData._id) || '');
                if (pid !== String(productId)) return sum;
                var vid = l.variantId ? String(l.variantId) : null;
                if ((variantId ? String(variantId) : null) !== vid) return sum;
                return sum + (Number(l.quantity) || 0);
            }, 0);
        },

        available(limit, inCart) { return limit === null ? null : Math.max(0, limit - inCart); },
        maxQty(limit, inCart) { return limit === null ? null : Math.max(1, limit - inCart); },

        state(limit, inCart, threshold) {
            if (limit !== null && limit <= 0) return 'out';
            var avail = this.available(limit, inCart);
            if (avail === 0) return 'incart';
            if (avail !== null && avail <= threshold) return 'low';
            return 'in';
        }
    };

    /* =========================================================================
       LamsaSwatch: colour options often arrive with a name and no colour, which
       painted every dot the same. A real colour value wins; otherwise the shade
       name is looked up, word by word («وردي نيود» → وردي). A name we don't know
       becomes a labelled pill on buttons and is dropped on cards.
       ====================================================================== */
    const LamsaSwatch = {
        names: {
            'احمر': '#C0392B', 'red': '#C0392B', 'وردي': '#E8A0B4', 'زهري': '#E8A0B4', 'روز': '#D98BA0', 'pink': '#E8A0B4', 'rose': '#D98BA0',
            'نيود': '#D9A98F', 'nude': '#D9A98F', 'بيج': '#E3CFB4', 'beige': '#E3CFB4', 'كريمي': '#F3E7D3', 'cream': '#F3E7D3',
            'بني': '#7B4B32', 'brown': '#7B4B32', 'شوكولاته': '#5A3522', 'كراميل': '#B5763F', 'caramel': '#B5763F',
            'خوخي': '#F2B8A0', 'peach': '#F2B8A0', 'كورال': '#EE7F6B', 'coral': '#EE7F6B', 'برتقالي': '#E67E22', 'orange': '#E67E22',
            'عنابي': '#7B1E3A', 'burgundy': '#7B1E3A', 'نبيتي': '#7B1E3A', 'بنفسجي': '#7D4FA3', 'purple': '#7D4FA3', 'موف': '#A98BBF', 'mauve': '#A98BBF',
            'اسود': '#1E1A1C', 'black': '#1E1A1C', 'ابيض': '#FFFFFF', 'white': '#FFFFFF', 'رمادي': '#9A9A9F', 'gray': '#9A9A9F', 'grey': '#9A9A9F',
            'ازرق': '#2F6DB5', 'blue': '#2F6DB5', 'كحلي': '#1F2F54', 'navy': '#1F2F54', 'اخضر': '#3F8F5F', 'green': '#3F8F5F', 'زيتي': '#6B7A3A', 'olive': '#6B7A3A',
            'اصفر': '#EBC944', 'yellow': '#EBC944', 'ذهبي': '#C9A24B', 'gold': '#C9A24B', 'فضي': '#BFC3C7', 'silver': '#BFC3C7'
        },
        _key(word) {
            return String(word).toLowerCase().trim().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^ال/, '');
        },
        color(label, value) {
            if (value && window.CSS && CSS.supports && CSS.supports('color', value)) return value;
            var words = String(label || '').split(/[\s\-_\/]+/);
            for (var i = 0; i < words.length; i++) {
                var hit = this.names[this._key(words[i])];
                if (hit) return hit;
            }
            return '';
        },
        paint(root) {
            var self = this;
            (root || document).querySelectorAll('[data-swatch]').forEach(function (el) {
                var c = self.color(el.getAttribute('data-swatch'), el.getAttribute('data-swatch-value'));
                if (c) { el.style.setProperty('--lamsa-swatch', c); return; }
                if (el.tagName === 'BUTTON') {
                    el.classList.add('lamsa-swatch--named');
                    el.textContent = el.getAttribute('data-swatch');
                } else {
                    el.hidden = true;
                }
            });
        }
    };

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
        card: LamsaCard,
        cartItem: LamsaCartItem,
        stock: LamsaStock,
        swatch: LamsaSwatch
    };

    // ===== Global Exports =====
    window.Qumra = Qumra;
    /* The single JS product-card renderer — every widget that renders products
       from JSON must call LamsaCard.build() / .mount() instead of its own HTML. */
    window.LamsaCard = LamsaCard;
    window.LamsaStock = LamsaStock;
    /* Same rule for cart lines. */
    window.LamsaCartItem = LamsaCartItem;

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

            init() {
                (config.items || []).forEach(i => {
                    this.quantities[i.id] = i.qty;
                    this.activeItems.push(i.id);
                });

                window.addEventListener('cart:updated', (e) => {
                    this.updating = null;
                    this.removingId = null;
                    this.confirmRemoveId = null;
                    if (e.detail && e.detail.items) {
                        this.activeItems = e.detail.items.map(i => i._id);
                        e.detail.items.forEach(item => {
                            this.quantities[item._id] = item.quantity;
                        });
                    } else {
                        this.activeItems = [];
                    }
                });
            },

            increment(id) {
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
                translations: cfg.translations || LamsaCard._t || {},
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
                    var newCount = wrapper && wrapper.querySelector('#products-count-data');
                    var sidebarCount = document.querySelector('#products-count');
                    if (newCount && sidebarCount) {
                        sidebarCount.innerHTML = newCount.innerHTML;
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
                                ' <span class="font-bold text-primary">&quot;' + LamsaCard.esc(self.searchQuery) + '&quot;</span></p>';
                            if (totalItems !== undefined) {
                                countHtml += '<p class="text-xs text-tertiary mt-1">' + Utils.countText(totalItems) + '</p>';
                            }
                        } else {
                            countHtml = '<p class="text-sm text-secondary">' + Utils.countText(totalItems) + '</p>';
                        }
                        countEl.innerHTML = countHtml;
                    }

                    if (products.length > 0) {
                        var gridClass = cs.gridClass || 'md:grid-cols-2 lg:grid-cols-3';
                        var html = '<div class="grid grid-cols-2 gap-x-4 gap-y-9 md:gap-x-6 md:gap-y-12 ' + gridClass + '">';
                        products.forEach(function (product) {
                            html += self._buildProductCard(product);
                        });
                        html += '</div>';

                        if (pagination && pagination.totalPages > 1) {
                            html += self._buildPagination(pagination);
                        }

                        wrapper.innerHTML = html;
                        LamsaSwatch.paint(wrapper);

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
                            emptyTitle = (tr.noResults || '') + ' &quot;' + LamsaCard.esc(self.searchQuery) + '&quot;';
                            emptyText = tr.tryDifferent || '';
                        } else {
                            emptyIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>';
                            emptyTitle = tr.noProducts || '';
                            emptyText = tr.noResults || '';
                        }
                        wrapper.innerHTML =
                            '<div class="lamsa-empty">' +
                            '<span class="lamsa-empty-icon">' +
                            '<svg width="36" height="36" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + emptyIcon + '</svg>' +
                            '</span>' +
                            '<h3 class="m-0">' + emptyTitle + '</h3>' +
                            '<p class="lamsa-text-sm m-0 max-w-md mx-auto">' + emptyText + '</p>' +
                            '<a href="/" class="lamsa-btn lamsa-btn--soft lamsa-btn--sm mt-1">' + (tr.home || '') + '</a>' +
                            '</div>';
                    }
                },

                /* Delegates to LamsaCard — the single JS card renderer.
                   Do not inline card markup here again. */
                _buildProductCard(product) {
                    return LamsaCard.build(product, this.cardSettings || {});
                },

                _buildPagination(pagination) {
                    var cell = 'lamsa-btn-icon lamsa-btn-icon--outline';
                    var arrow = function (dir) {
                        return '<svg class="rtl-flip" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" d="' +
                            (dir === 'prev' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6') + '"/></svg>';
                    };
                    var tr = LamsaCard._t || {};
                    var h = '<nav class="flex items-center justify-center gap-2 flex-wrap mt-12" aria-label="pagination">';

                    if (pagination.currentPage > 1) {
                        h += '<button type="button" @click.prevent="goToPage(' + (pagination.currentPage - 1) + ')" class="' + cell +
                            '" aria-label="' + LamsaCard.esc(tr.prev || '') + '">' + arrow('prev') + '</button>';
                    } else {
                        h += '<span class="' + cell + '" style="opacity:.35">' + arrow('prev') + '</span>';
                    }

                    for (var i = 1; i <= pagination.totalPages; i++) {
                        if (i === pagination.currentPage) {
                            h += '<span class="lamsa-btn-icon font-num" style="background: var(--color-accent); color: #fff;" aria-current="page">' + i + '</span>';
                        } else if (i === 1 || i === pagination.totalPages ||
                                   (i >= pagination.currentPage - 1 && i <= pagination.currentPage + 1)) {
                            h += '<button type="button" @click.prevent="goToPage(' + i + ')" class="' + cell + ' font-num">' + i + '</button>';
                        } else if (i === pagination.currentPage - 2 || i === pagination.currentPage + 2) {
                            h += '<span class="w-5 text-center" style="color: var(--color-text-tertiary);">…</span>';
                        }
                    }

                    if (pagination.hasNextPage) {
                        h += '<button type="button" @click.prevent="goToPage(' + (pagination.currentPage + 1) + ')" class="' + cell +
                            '" aria-label="' + LamsaCard.esc(tr.next || '') + '">' + arrow('next') + '</button>';
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
                           JSON search API, which renders through LamsaCard. */
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
        Alpine.data('productCard', (productId, slug) => ({
            productId: productId,
            slug: slug || '',
            _resolved: null,
            cartLoading: false,
            cartSuccess: false,
            wishlistLoading: false,

            get inWishlist() {
                return Alpine.store('wishlist').has(this.productId);
            },

            /* Listing payloads say nothing about variants, so look once before
               adding: a product with options goes to Quick View to be chosen —
               never a blind add (that books a parent line at the parent price).
               Returns true when it is safe to add directly. */
            async _canQuickAdd() {
                if (!this.slug) return true;
                if (!this._resolved) {
                    try {
                        var res = await ProductManager.get(this.slug);
                        this._resolved = (res && (res.data || res.product)) || res || {};
                    } catch (e) { this._resolved = {}; }
                }
                var p = this._resolved;
                var hasOptions = (p.options && p.options.length) || (p.variants && p.variants.length);
                if (hasOptions) {
                    this.$dispatch('quick-view', { slug: this.slug });
                    return false;
                }
                if (LamsaStock.limit(p, null) === 0) {
                    Toast.error(QumraConfig.messages.outOfStock);
                    return false;
                }
                return true;
            },

            async addToCart() {
                if (this.cartLoading) return;
                this.cartLoading = true;
                try {
                    if (!(await this._canQuickAdd())) return;
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
                    if (!(await this._canQuickAdd())) { this.cartLoading = false; return; }
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

        // --- /blogs: every article, newest first ---
        /* The platform sends /blogs only the list of categories, so the articles
           are read in the browser: /blogs/all when it has them, else each category
           page. Cards come out of those pages as they are, so ui/article-card.njk
           stays the one card. A theme preview is `?theme=<id>`: fetched bare, a
           page renders with the live theme. */
        Alpine.data('lamsaBlogsFeed', (cfg) => ({
            loading: true,
            count: 0,

            init() {
                var self = this;
                var handles = (cfg && cfg.handles) || [];
                var theme = new URLSearchParams(location.search).get('theme');
                var MAX_PAGES = 5;

                function page(path, n) {
                    var qs = new URLSearchParams();
                    if (n > 1) qs.set('page', n);
                    if (theme) qs.set('theme', theme);
                    var tail = qs.toString();
                    return fetch(path + (tail ? '?' + tail : ''), { credentials: 'same-origin' })
                        .then(function (r) { return r.ok ? r.text() : ''; })
                        .then(function (html) { return new DOMParser().parseFromString(html, 'text/html'); })
                        .catch(function () { return null; });
                }
                function cards(doc) {
                    return doc ? [].slice.call(doc.querySelectorAll('[data-lamsa-blog-pages] a.lamsa-acard')) : [];
                }
                function load(path) {
                    return page(path, 1).then(function (doc) {
                        var holder = doc && doc.querySelector('[data-lamsa-blog-pages]');
                        var pages = Math.min(Number(holder && holder.getAttribute('data-lamsa-blog-pages')) || 1, MAX_PAGES);
                        var rest = [];
                        for (var i = 2; i <= pages; i++) rest.push(page(path, i));
                        return Promise.all(rest).then(function (docs) {
                            return docs.reduce(function (all, d) { return all.concat(cards(d)); }, cards(doc));
                        });
                    });
                }

                load('/blogs/all').then(function (list) {
                    if (list.length || !handles.length) return list;
                    return Promise.all(handles.map(function (h) { return load('/blogs/' + encodeURIComponent(h)); }))
                        .then(function (groups) { return groups.reduce(function (a, b) { return a.concat(b); }, []); });
                }).then(function (list) {
                    var seen = {};
                    var unique = list.filter(function (el) {
                        var href = el.getAttribute('href');
                        if (seen[href]) return false;
                        seen[href] = true;
                        return true;
                    }).sort(function (a, b) {
                        return String(b.getAttribute('data-date') || '').localeCompare(String(a.getAttribute('data-date') || ''));
                    });
                    self.count = unique.length;
                    self.loading = false;
                    /* Alpine picks up the x-data on the card dates by itself */
                    var grid = self.$refs.grid;
                    grid.innerHTML = unique.map(function (el) { return el.outerHTML; }).join('');
                    grid.classList.toggle('is-feature', unique.length % ((cfg && cfg.cols) || 3) === 1);
                    grid.classList.toggle('is-feature-mid', unique.length % ((cfg && cfg.midCols) || 2) === 1);
                });
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

                        LamsaSwatch.paint(container);

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

    // ===== Colour swatches =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { LamsaSwatch.paint(); });
    } else {
        LamsaSwatch.paint();
    }

    // ===== Analytics boot =====
    /* After the managers and EventBus exist. Safe with no Measurement ID set:
       gtag is undefined and every send() returns early. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { Analytics.init(); });
    } else {
        Analytics.init();
    }

    // ===== Scroll Reveal (IntersectionObserver) =====
    // Skip entirely inside builder preview (iframe) so widgets stay visible
    if (window.self === window.top) {
        document.documentElement.classList.add('reveal-init');

        var _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
            document.documentElement.classList.contains('lamsa-no-motion');

        function _observeReveal(el) {
            if (el.classList.contains('is-visible')) return;
            if (_reducedMotion) { el.classList.add('is-visible'); return; }
            /* Already scrolled past (restored scroll position, anchor jump):
               show it now rather than leave a blank band above the reader. */
            if (el.getBoundingClientRect().bottom < 0) { el.classList.add('is-visible'); return; }
            _revealIO.observe(el);
        }

        var _revealIO = _reducedMotion ? null : new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    _revealIO.unobserve(entry.target);
                }
            });
        /* Fires a quarter-screen BEFORE the section arrives, so the motion has
           finished by the time it is on screen — at `threshold: 0.15` a fast
           scroll showed empty sections until 15% of them was already visible. */
        }, { threshold: 0, rootMargin: '0px 0px 25% 0px' });

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
