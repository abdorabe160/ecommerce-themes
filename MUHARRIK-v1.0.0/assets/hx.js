/* ==========================================================================
   NEW THEME · SHARED SCRIPTS  (prefix: hx)
   Loaded right after main.js, before Alpine boots. Uses main.js globals:
   window.formatPrice / formatMoney, Qumra.search, Alpine `productCard`.
   ========================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isRtl(el) {
    return getComputedStyle(el || document.documentElement).direction === 'rtl';
  }
  function money(v) { return window.formatPrice ? window.formatPrice(v) : String(v); }
  function moneyRaw(v) { return window.formatMoney ? window.formatMoney(v) : String(v); }

  /* ------------------------------------------------------------------------
     HxCard — the AJAX twin of ui/hx-card.njk.
     ⚠️ Same markup, same order. Change one, change the other.
     `o` mirrors the locals the njk card takes (see the header there).
     ------------------------------------------------------------------------ */
  var ICON_EYE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>';
  var ICON_BAG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path stroke-linejoin="round" d="M4.5 7.5h15l-1.1 12a1.5 1.5 0 0 1-1.5 1.35H7.1a1.5 1.5 0 0 1-1.5-1.35L4.5 7.5Z"/><path stroke-linecap="round" d="M8.75 10V6.75a3.25 3.25 0 0 1 6.5 0V10"/></svg>';
  var ICON_OK = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 12.5 9.5 18 20 6.5"/></svg>';
  var ICON_BOLT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.5L13.5 2Z"/></svg>';
  var STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L10 14.9l-5.2 2.8 1-5.9L1.5 7.7l5.9-.8L10 1.5Z"/></svg>';

  function stars(avg) {
    var pct = Math.max(0, Math.min(100, (Number(avg) || 0) / 5 * 100));
    var row = STAR + STAR + STAR + STAR + STAR;
    return '<span class="hx-stars" style="--hx-stars:' + pct + '%"><span class="hx-stars-bg">' + row +
      '</span><span class="hx-stars-fg">' + row + '</span></span>';
  }

  var ICON_CMP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M8 20h8M5 7h14M12 4.5 5 7M12 4.5 19 7"/><path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0L5 7ZM19 7l-2.5 6a2.5 2.5 0 0 0 5 0L19 7Z"/></svg>';
  var ICON_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" d="M6 18 18 6M6 6l12 12"/></svg>';

  /* The quick-add panel. ⚠️ Mirrored in ui/hx-card.njk (block "quick add"). */
  function qaHTML(t) {
    return '<div class="hx-qa" x-show="qaOpen" x-cloak x-transition.opacity.duration.200ms @keydown.escape.window="qaOpen = false">' +
      '<button type="button" class="hx-qa-close" @click="qaOpen = false" aria-label="' + esc(t.close) + '">' + ICON_X + '</button>' +
      '<template x-if="qaReady"><div class="hx-qa-body">' +
        '<p class="hx-qa-title" x-text="qaTitle"></p>' +
        '<p class="hx-qa-prices"><span class="hx-card-price" :class="hasDiscount() && \'is-sale\'" x-text="displayPrice()"></span>' +
        '<s class="hx-card-was" x-show="hasDiscount()" x-text="displayComparePrice()"></s></p>' +
        '<template x-for="g in qaGroups" :key="g.name"><div class="hx-qa-opt">' +
          '<p class="hx-opt-name"><span x-text="g.name"></span>: <b x-text="selectedLabels[g.name] || \'\'"></b></p>' +
          '<div class="hx-opt-vals"><template x-for="v in g.values" :key="v.id">' +
            '<button type="button" class="hx-opt" :class="{ \'is-swatch\': v.image || v.color, \'is-active\': selectedOptions[g.name] === v.id, \'is-off\': valueDisabled(g.name, v.id) }"' +
            ' :disabled="valueDisabled(g.name, v.id)" @click="selectOption(g.name, v.id, v.label)" :title="v.label" :aria-label="v.label">' +
              '<img x-show="v.image" :src="v.image || \'\'" alt=""/><i x-show="!v.image && v.color" :style="v.color ? \'background:\' + v.color : \'\'"></i>' +
              '<span x-show="!v.image && !v.color" x-text="v.label"></span>' +
            '</button></template></div>' +
        '</div></template>' +
        '<p class="hx-qa-err" x-show="formError" x-text="formError" role="alert"></p>' +
        '<button type="button" class="hx-qa-add" @click="qaAdd()" :disabled="addingToCart || isOutOfStock">' +
          '<span x-show="addingToCart" class="hx-spin"></span>' +
          '<span x-show="addedSuccess && !addingToCart">' + ICON_OK + '</span>' +
          '<span x-show="!addingToCart && !addedSuccess" x-text="isOutOfStock ? \'' + esc(t.outOfStock) + '\' : \'' + esc(t.addToCart) + '\'"></span>' +
        '</button>' +
        '<a :href="qaUrl" class="hx-qa-full">' + esc(t.fullDetails) + '</a>' +
      '</div></template>' +
    '</div>';
  }

  var HxCard = {
    MAX_IMAGES: 4,
    LOW_STOCK_AT: Number(window.__QUMRA_CONFIG__ && window.__QUMRA_CONFIG__.lowStockAt) || 3,

    build: function (p, o) {
      o = o || {};
      var t = o.t || {};
      var slug = p.slug || p.handle || p._id;
      var url = '/products/' + encodeURIComponent(slug);
      var title = esc(p.title);
      /* MUHARRIK kicker — first collection title, guarded (twin of ui/hx-card.njk) */
      var kc = (p.collections || []).filter(function (c) { return c && c.title; })[0];
      var kicker = kc ? esc(kc.title) : '';
      var price = Number(p.pricing && p.pricing.price) || 0;
      var was = Number(p.pricing && p.pricing.compareAtPrice) || 0;
      var onSale = was > price;
      var pct = onSale ? Math.floor((was - price) / was * 100) : 0;
      var qty = Number(p.quantity) || 0;
      /* Sold out only when known; twin of the note in ui/hx-card.njk. */
      var vList = p.variants || [];
      var vOk = vList.some(function (v) {
        var a = v && v.inventoryLevel && v.inventoryLevel.available;
        return v && (v.allowBackorder || v.trackQuantity === false || Number(v.quantity) > 0 || Number(a) > 0);
      });
      var hasOpts = (p.options || []).length > 0;
      var knownSimple = (p.options || p.variants || p.variantsCount === 0) && !hasOpts && !vList.length && !p.variantsCount;
      var sellable = !!p.allowBackorder || p.trackQuantity === false || qty > 0 || vOk;
      var knownOut = !sellable && (knownSimple || vList.length > 0);
      var stockUnknown = !sellable && !knownOut;
      var inStock = !knownOut;
      var low = !p.allowBackorder && qty > 0 && qty <= HxCard.LOW_STOCK_AT;
      var imgs = (p.images || []).filter(function (i) { return i && i.fileUrl; }).slice(0, o.hoverImages === false ? 1 : HxCard.MAX_IMAGES);
      var n = imgs.length;

      var h = '<article class="hx-card' + (inStock ? '' : ' is-soldout') + '" x-data="hxCard(\'' + esc(p._id) + '\', \'' + esc(slug) + '\')" @mouseleave="img = 0">';
      h += '<div class="hx-card-frame mh-hud">';
      h += '<a href="' + url + '" class="hx-card-media" aria-label="' + title + '">';
      if (n) {
        imgs.forEach(function (im, i) {
          h += '<img src="' + esc(im.fileUrl) + '" alt="' + (i ? '' : title) + '" loading="' + (i ? 'lazy' : 'eager') + '" class="hx-card-img"' +
            ' :class="{ \'is-on\': img === ' + i + ' }"' + (i ? '' : ' data-first') + '/>';
        });
      } else {
        h += '<span class="hx-card-noimg" aria-hidden="true"></span>';
      }
      if (n > 1) {
        h += '<span class="hx-card-zones" aria-hidden="true">';
        for (var z = 0; z < n; z++) h += '<span @mouseenter="img = ' + z + '"></span>';
        h += '</span>';
      }
      h += '</a>';
      if (n > 1) {
        h += '<div class="hx-card-dots" aria-hidden="true">';
        for (var d = 0; d < n; d++) h += '<span :class="{ \'is-on\': img === ' + d + ' }"></span>';
        h += '</div>';
      }

      var badges = '';
      if (onSale && o.saleBadge) badges += '<span class="hx-badge-tag is-sale">' + String(o.saleBadge) + '</span>';
      if (low && o.lowBadge) badges += '<span class="hx-badge-tag is-low">' + String(o.lowBadge) + '</span>';
      if (badges) h += '<div class="hx-card-badges">' + badges + '</div>';

      if (o.quickView !== false || (o.atc !== false && inStock) || o.compare !== false) {
        h += '<div class="hx-card-actions">';
        if (o.quickView !== false) {
          h += '<button type="button" class="hx-card-act" aria-label="' + esc(t.quickView) + '" title="' + esc(t.quickView) +
            '" @click.prevent="$dispatch(\'quick-view\', { slug: \'' + esc(slug) + '\' })">' + ICON_EYE + '</button>';
        }
        if (o.compare !== false && !o.demo) {
          var cp = esc(JSON.stringify({ id: p._id, slug: slug, title: p.title, price: price, was: was, img: (imgs[0] && imgs[0].fileUrl) || '' }));
          h += '<button type="button" class="hx-card-act hx-card-cmp" data-cmp="' + cp + '" :class="{ \'is-on\': $store.hxCompare && $store.hxCompare.has(\'' + esc(p._id) + '\') }"' +
            ' @click.prevent="$store.hxCompare.toggle(JSON.parse($el.dataset.cmp))" aria-label="' + esc(t.compare || '') + '" title="' + esc(t.compare || '') + '">' + ICON_CMP + '</button>';
        }
        if (o.atc !== false && inStock) {
          h += '<button type="button" class="hx-card-act hx-card-atc" aria-label="' + esc(t.addToCart) + '" title="' + esc(t.addToCart) +
            '" @click.prevent="quickAdd()" :disabled="qaLoading" :class="{ \'is-busy\': qaLoading }">' +
            '<span x-show="!qaLoading">' + ICON_BAG + '</span><span x-show="qaLoading" x-cloak class="hx-spin"></span></button>';
        }
        h += '</div>';
      }
      h += '</div>';

      h += '<div class="hx-card-info">';
      if (kicker) h += '<p class="hx-card-kicker">' + kicker + '</p>';
      h += '<a href="' + url + '" class="hx-card-name">' + title + '</a>';
      if (o.rating !== false) {
        h += '<div class="hx-card-rating">' + stars(p.averageRating) + '<span class="hx-card-count">(' + (Number(p.reviewsCount) || 0) + ')</span></div>';
      }
      var priceKnown = !!p.pricing && p.pricing.price !== null && p.pricing.price !== undefined && p.pricing.price !== '';
      h += '<div class="hx-card-prices"><span class="hx-card-price' + (onSale ? ' is-sale' : '') + '">' + (priceKnown ? money(price) : '') + '</span>';
      if (onSale) {
        h += '<s class="hx-card-was">' + moneyRaw(was) + '</s>';
        if (pct > 0) h += '<span class="hx-card-off">-' + pct + '%</span>';
      }
      h += '</div>';
      if (o.thumbs !== false && n > 1) {
        h += '<div class="hx-card-thumbs">';
        imgs.forEach(function (im, i) {
          h += '<button type="button" class="hx-card-thumb" :class="{ \'is-on\': img === ' + i + ' }" @mouseenter="img = ' + i +
            '" @focus="img = ' + i + '" @click.prevent="img = ' + i + '" aria-label="' + esc(t.image) + ' ' + (i + 1) +
            '"><img src="' + esc(im.fileUrl) + '" alt="" loading="lazy"/></button>';
        });
        h += '</div>';
      }
      if (o.stock !== false) {
        var st = window.__hxStock || {};
        var label = !inStock ? t.outOfStock : (stockUnknown ? '' : (qty > 0 ? String((low ? st.low : st['in']) || t.inStock).replace('{count}', qty) : t.inStock));
        h += '<p class="hx-card-stock' + (inStock ? '' : ' is-out') + (low ? ' is-low' : '') + (stockUnknown ? ' is-pending' : '') + '" data-hx-stock="' + esc(slug) +
          '" data-low-badge="' + esc(o.lowBadge || '') + '"><i></i><span>' + esc(label) + '</span></p>';
      }
      if (onSale && o.note) h += '<p class="hx-card-note">' + ICON_BOLT + '<span>' + String(o.note) + '</span></p>';
      h += '</div>';
      if (o.atc !== false && inStock) h += qaHTML(t);
      h += '</article>';
      return h;
    }
  };

  /* ------------------------------------------------------------------------
     HxRail — a native scroll-snap carousel with prev/next arrows.
     Markup: [data-hx-rail] root › [data-hx-track] + [data-hx-prev]/[data-hx-next]
     RTL: scrollLeft runs 0 → negative in an RTL box, so "next" is always the
     reading direction and the button states use the absolute offset.
     ------------------------------------------------------------------------ */
  var HxRail = {
    init: function (root) {
      if (!root || root.__hxRail) return;
      root.__hxRail = true;
      var track = root.querySelector('[data-hx-track]');
      var prev = root.querySelector('[data-hx-prev]');
      var next = root.querySelector('[data-hx-next]');
      if (!track) return;

      function step() { return Math.max(track.clientWidth * 0.9, 200); }
      function dir() { return isRtl(track) ? -1 : 1; }
      function update() {
        var max = track.scrollWidth - track.clientWidth;
        var pos = Math.abs(track.scrollLeft);
        root.classList.toggle('is-static', max <= 2);
        if (prev) prev.disabled = pos <= 2;
        if (next) next.disabled = pos >= max - 2;
      }
      if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step() * dir(), behavior: 'smooth' }); });
      if (next) next.addEventListener('click', function () { track.scrollBy({ left: step() * dir(), behavior: 'smooth' }); });
      track.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      root.__hxRailUpdate = update;
      update();
    },
    refresh: function (root) { if (root && root.__hxRailUpdate) root.__hxRailUpdate(); }
  };

  /* ------------------------------------------------------------------------
     HxCountdown — fills [data-hx-cd] boxes: d / h / m / s.
     mode 'daily' → counts to the next local midnight (always running).
     mode 'date'  → counts to `end` ("YYYY-MM-DD HH:MM"); hides `hideEl` once over.
     ------------------------------------------------------------------------ */
  var HxCountdown = {
    init: function (el) {
      if (!el || el.__hxCd) return;
      el.__hxCd = true;
      var mode = el.getAttribute('data-mode') || 'daily';
      var endStr = (el.getAttribute('data-end') || '').trim().replace(' ', 'T');
      var end = mode === 'date' ? new Date(endStr) : null;
      var box = {
        d: el.querySelector('[data-hx-cd="d"]'), h: el.querySelector('[data-hx-cd="h"]'),
        m: el.querySelector('[data-hx-cd="m"]'), s: el.querySelector('[data-hx-cd="s"]')
      };
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      function target() {
        if (end && !isNaN(end)) return end;
        var t = new Date(); t.setHours(24, 0, 0, 0); return t;
      }
      function tick() {
        var left = Math.max(0, Math.floor((target() - new Date()) / 1000));
        if (mode === 'date' && left === 0) { el.hidden = true; clearInterval(timer); return; }
        var d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600),
            m = Math.floor(left % 3600 / 60), s = left % 60;
        if (box.d) box.d.textContent = pad(d);
        if (box.h) box.h.textContent = pad(h);
        if (box.m) box.m.textContent = pad(m);
        if (box.s) box.s.textContent = pad(s);
        el.classList.toggle('has-days', d > 0);
      }
      var timer = setInterval(tick, 1000);
      tick();
    }
  };

  /* ------------------------------------------------------------------------
     hxCard — the card's Alpine component (both twins use it).
     · `img`       which picture shows (hover zones / thumbs)
     · quickAdd()  the bag button: resolves the product (a listed product has
                   no options), adds it straight away when it has none, else
                   opens the white panel OVER the card with its options. The
                   buy logic is main.js HayatVariants — the same engine as the
                   product page and the quick view — merged in on first open.
     ------------------------------------------------------------------------ */
  function mapProduct(p) {
    var price = (p.pricing && p.pricing.price) || 0;
    var cmp = (p.pricing && p.pricing.compareAtPrice) || 0;
    var groups = (p.options || []).filter(function (o) { return o && (o.values || []).length; }).map(function (o) {
      return { name: o.name, values: o.values.map(function (v) {
        return { id: String(v._id), label: v.label, image: (v.image && v.image.fileUrl) || '',
          color: (v.type === 'color' && v.value) ? String(v.value) : '' };
      }) };
    });
    var variants = (p.variants || []).map(function (v) {
      var vp = v.pricing || {};
      var avail = v.inventoryLevel && v.inventoryLevel.available;
      return {
        /* the variant's own price, even 0 — that is what the cart charges
           (measured: a variant priced 0 goes into the cart at 0) */
        id: v._id, price: (vp.price === undefined || vp.price === null) ? price : Number(vp.price), compareAtPrice: vp.compareAtPrice || cmp,
        quantity: v.quantity || 0, available: (avail === undefined || avail === null) ? (v.quantity || 0) : avail,
        trackQuantity: v.trackQuantity !== false, allowBackorder: !!v.allowBackorder, options: v.options || []
      };
    });
    return { productId: p._id, sku: p.sku || '', price: price, compareAtPrice: cmp, quantity: p.quantity || 0,
      trackQuantity: !!p.trackQuantity, allowBackorder: !!p.allowBackorder, groups: groups, variants: variants };
  }

  function registerAlpine() {
    if (!window.Alpine || window.__hxAlpineReady) return;
    window.__hxAlpineReady = true;

    Alpine.data('hxCard', function (productId, slug) {
      return {
        img: 0,
        qaOpen: false,
        qaLoading: false,
        qaReady: false,
        qaGroups: [],
        qaTitle: '',
        qaUrl: '/products/' + encodeURIComponent(slug || ''),

        async quickAdd() {
          if (this.qaLoading) return;
          if (this.qaReady) { this.qaOpen = true; return; }
          this.qaLoading = true;
          try {
            var res = await Qumra.product.get(slug);
            var p = (res && (res.data || res.product)) || res || {};
            var cfg = mapProduct(p);
            var strings = window.__hxVariantStrings || {};
            cfg.strings = strings;
            this.qaTitle = p.title || '';
            if (!cfg.groups.length && !cfg.variants.length) {
              /* the list payload can't say whether this sells: no blind POST
                 when the full record says nothing is left */
              var left = Number(p.available != null ? p.available : p.quantity) || 0;
              if (!p._id || p.isAvailable === false || (left <= 0 && !p.allowBackorder)) { window.location.href = this.qaUrl; return; }
              this.qaLoading = false;
              await Qumra.cart.add(productId, 1);
              return;
            }
            Object.assign(this, window.HayatVariants(cfg));
            this.qaGroups = cfg.groups;
            this.initVariants();
            /* Like the reference, open with the first available value of each
               option already chosen. */
            var self = this;
            cfg.groups.forEach(function (g) {
              var v = g.values.filter(function (x) { return !self.valueDisabled(g.name, x.id); })[0];
              if (v) self.selectOption(g.name, v.id, v.label);
            });
            this.qaReady = true;
            this.qaOpen = true;
          } catch (e) {
            window.location.href = this.qaUrl;
          } finally {
            this.qaLoading = false;
          }
        },

        async qaAdd() {
          if (typeof this._add !== 'function') return;
          var ok = await this._add();
          if (ok) {
            this.addedSuccess = true;
            var self = this;
            setTimeout(function () { self.addedSuccess = false; self.qaOpen = false; }, 1200);
          }
        }
      };
    });
  }
  if (window.Alpine) registerAlpine();
  document.addEventListener('alpine:init', registerAlpine);

  /* ------------------------------------------------------------------------
     HxUpsell — fills the cart's "you'll love this too" list when the merchant
     picked nothing. ⚠️ Item markup mirrors ui/cart.njk (.hx-ups-item).
     ------------------------------------------------------------------------ */
  var HxUpsell = {
    build: function (p, t) {
      var slug = p.slug || p.handle || p._id;
      var url = '/products/' + encodeURIComponent(slug);
      var img = (p.images && p.images[0] && p.images[0].fileUrl) || '';
      var price = Number(p.pricing && p.pricing.price) || 0;
      var was = Number(p.pricing && p.pricing.compareAtPrice) || 0;
      var sale = was > price;
      return '<div class="hx-ups-item" x-data="productCard(\'' + esc(p._id) + '\', \'' + url + '\')">' +
        '<a href="' + url + '" class="hx-ups-media" @click="$store.modal.close()">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="lazy"/>' : '') + '</a>' +
        '<div class="hx-ups-body"><a href="' + url + '" class="hx-ups-name" @click="$store.modal.close()">' + esc(p.title) + '</a>' +
        '<p class="hx-ups-price"><span class="' + (sale ? 'is-sale' : '') + '">' + moneyRaw(price) + '</span>' + (sale ? '<s>' + moneyRaw(was) + '</s>' : '') + '</p></div>' +
        '<button type="button" class="hx-ups-add" @click="addToCart()" :disabled="cartLoading" aria-label="' + esc(t.addToCart) + '">' +
        '<span x-show="!cartLoading && !cartSuccess"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg></span>' +
        '<span x-show="cartLoading" x-cloak class="hx-spin"></span>' +
        '<span x-show="cartSuccess && !cartLoading" x-cloak>' + ICON_OK + '</span></button></div>';
    },
    fill: function () {
      var list = document.querySelector('[data-hx-ups-fill]');
      if (!list || list.__hxDone || !window.HayatAuto) return;
      list.__hxDone = true;
      var t = { addToCart: list.getAttribute('data-atc') || '' };
      HayatAuto.take(6).then(function (items) {
        if (!items || !items.length) { var a = list.closest('.hx-ups'); if (a) a.hidden = true; return; }
        list.innerHTML = items.map(function (p) { return HxUpsell.build(p, t); }).join('');
      });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { HxUpsell.fill(); });
  else HxUpsell.fill();

  /* ------------------------------------------------------------------------
     HxLoop — steps a row one item along every `interval` seconds, forever:
     slide by one item, then move that item to the end and reset (so the row
     never runs out). Swipe on touch steps either way. Stops when everything
     already fits, on hover / focus (optional), off-screen, in a background
     tab, and for reduced motion.
     Markup: [data-hx-loop] viewport › [data-hx-loop-track] › items
     ------------------------------------------------------------------------ */
  var HxLoop = {
    init: function (vp) {
      if (!vp || vp.__hxLoop) return;
      vp.__hxLoop = true;
      var track = vp.querySelector('[data-hx-loop-track]');
      if (!track) return;
      var auto = vp.getAttribute('data-autoplay') !== 'false';
      var ms = Math.max(1500, (Number(vp.getAttribute('data-interval')) || 4) * 1000);
      var pauseHover = vp.getAttribute('data-pause') !== 'false';
      var reduce = document.documentElement.classList.contains('hx-no-anim') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      var busy = false, hovered = false, visible = true, timer = null;
      var DUR = 600;

      function dir() { return isRtl(track) ? 1 : -1; }   /* reading direction */
      function step() {
        var a = track.children[0], b = track.children[1];
        if (!a) return 0;
        return b ? Math.abs(b.getBoundingClientRect().left - a.getBoundingClientRect().left) : a.offsetWidth;
      }
      function fits() { return track.scrollWidth <= vp.clientWidth + 2; }
      function set(x, anim) {
        track.style.transition = anim ? 'transform ' + DUR + 'ms cubic-bezier(.45,.05,.25,1)' : 'none';
        track.style.transform = x ? 'translateX(' + x + 'px)' : '';
      }
      function next() {
        if (busy || fits()) return;
        busy = true;
        set(step() * dir(), true);
        setTimeout(function () {
          track.appendChild(track.children[0]);
          set(0, false);
          busy = false;
        }, DUR + 20);
      }
      function prev() {
        if (busy || fits()) return;
        busy = true;
        track.insertBefore(track.lastElementChild, track.children[0]);
        set(step() * dir(), false);
        void track.offsetWidth;
        set(0, true);
        setTimeout(function () { busy = false; }, DUR + 20);
      }
      function tick() { if (!hovered && visible && !document.hidden) next(); }
      function start() { if (auto && !reduce && !timer) timer = setInterval(tick, ms); }

      vp.classList.toggle('is-static', fits());
      window.addEventListener('resize', function () { vp.classList.toggle('is-static', fits()); });
      if (pauseHover) {
        vp.addEventListener('mouseenter', function () { hovered = true; });
        vp.addEventListener('mouseleave', function () { hovered = false; });
      }
      vp.addEventListener('focusin', function () { hovered = true; });
      vp.addEventListener('focusout', function () { hovered = false; });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(vp);
      }
      var x0 = null, y0 = null;
      vp.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; hovered = true; }, { passive: true });
      vp.addEventListener('touchend', function (e) {
        hovered = false;
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        /* a swipe against the reading direction moves forward */
        if ((dx < 0) === (dir() < 0)) next(); else prev();
      }, { passive: true });
      vp.__hxLoopApi = { next: next, prev: prev };
      start();
    }
  };
  /* ------------------------------------------------------------------------
     HxFill — fills a [data-hx-fill] product track once: from its collection
     (data-col) or else the newest products (HayatAuto, a fresh run per
     caller). Demo cards in it stay hidden until the answer is in, and stay
     if nothing comes back. `done` runs after either outcome.
     ------------------------------------------------------------------------ */
  var HxFill = {
    run: function (track, cardOpts, done) {
      if (!track || track.__hxFill) return;
      track.__hxFill = true;
      var limit = Number(track.getAttribute('data-limit')) || 12;
      var colId = track.getAttribute('data-col');
      var get = colId
        ? fetch('/ajax/search/products?q=&collectionId=' + encodeURIComponent(colId), { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : {}; })
            .then(function (d) { return (d && (d.products || d.data)) || []; })
            .catch(function () { return []; })
        : (track.getAttribute('data-sort')
            ? fetch('/ajax/search/products?q=&sort=' + encodeURIComponent(track.getAttribute('data-sort')), { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : {}; })
                .then(function (d) { return (d && (d.products || d.data)) || []; })
                .catch(function () { return []; })
            : (window.HayatAuto ? HayatAuto.take(limit) : Promise.resolve([])));
      function settle() { track.classList.add('is-settled'); if (done) done(); }
      var guard = setTimeout(settle, 5000);
      get.then(function (list) {
        clearTimeout(guard);
        if (list && list.length) {
          track.innerHTML = list.slice(0, limit).map(function (p) { return HxCard.build(p, cardOpts); }).join('');
        }
        settle();
      });
    }
  };
  /* ------------------------------------------------------------------------
     HxStock — the real stock count beside "in stock".
     A listed product's `quantity` covers the product row only; with variants
     the stock lives on them, and only the full product (/ajax/product)
     carries the total (`available`). So each card on screen fetches it once
     (cached per slug, 3 at a time) and rewrites its line:
       available > 3   → "in stock · N"
       1..3            → "only N left" (+ the low-stock badge if enabled)
       0 + backorder   → "in stock" (sellable, no count to show)
       0, no backorder → "out of stock"
     ------------------------------------------------------------------------ */
  var HxStock = {
    LOW: 3,
    cache: {},
    queue: [],
    active: 0,
    get: function (slug) {
      if (!HxStock.cache[slug]) {
        HxStock.cache[slug] = new Promise(function (resolve) {
          HxStock.queue.push(function () {
            HxStock.active++;
            Qumra.product.get(slug).then(function (res) {
              var p = (res && (res.data || res.product)) || res || {};
              resolve(p);
            }).catch(function () { resolve(null); }).finally(function () {
              HxStock.active--; HxStock.pump();
            });
          });
          HxStock.pump();
        });
      }
      return HxStock.cache[slug];
    },
    pump: function () {
      while (HxStock.active < 3 && HxStock.queue.length) HxStock.queue.shift()();
    },
    /* cart lines — what this shopper already holds. Qumra only lowers stock
       at checkout, so "25 left" must become 21 once 4 sit in the cart (the
       product page does the same, main.js → cartQty). */
    lines: [],
    inCart: function (pid) {
      return HxStock.lines.reduce(function (n, l) { return l.productId === pid ? n + (Number(l.quantity) || 0) : n; }, 0);
    },
    refresh: function () {
      document.querySelectorAll('[data-hx-stock]').forEach(function (el) { if (el.__hxP) HxStock.apply(el, el.__hxP); });
    },
    apply: function (el, p) {
      if (!p || !p._id) return;   /* no record = still unknown, say nothing */
      el.__hxP = p;
      el.classList.remove('is-pending');
      var st = window.__hxStock || {};
      var avail = Number(p.available != null ? p.available : p.quantity) || 0;
      if (avail > 0) avail = Math.max(0, avail - HxStock.inCart(p._id || p.id));
      var tracked = !!p.trackQuantity || (p.variants || []).some(function (v) { return v.trackQuantity; });
      var sellable = avail > 0 || p.allowBackorder || (!tracked && p.isAvailable !== false);
      /* everything left is already in this cart */
      var allInCart = !sellable && HxStock.inCart(p._id || p.id) > 0;
      var span = el.querySelector('span');
      var low = avail > 0 && avail <= HxStock.LOW;
      el.classList.toggle('is-out', !sellable);
      el.classList.toggle('is-low', low);
      /* the card's look and its bag follow the real answer, not the list payload */
      var holder = el.closest('.hx-card');
      if (holder) {
        holder.classList.toggle('is-soldout', !sellable);
        var bag = holder.querySelector('.hx-card-atc');
        if (bag) bag.hidden = !sellable;
      }
      if (!span) return;
      if (allInCart) span.textContent = st.all_in_cart || st.out || '';
      else if (!sellable) span.textContent = st.out || '';
      else if (avail > 0) span.textContent = String(low ? st.low : st['in']).replace('{count}', avail);
      else span.textContent = st.plain || '';
      /* low-stock badge, when the section has one */
      var badgeText = el.getAttribute('data-low-badge');
      var card = el.closest('.hx-card');
      if (low && badgeText && card && !card.querySelector('.hx-badge-tag.is-low')) {
        var frame = card.querySelector('.hx-card-frame');
        var box = card.querySelector('.hx-card-badges');
        if (!box && frame) { box = document.createElement('div'); box.className = 'hx-card-badges'; frame.appendChild(box); }
        if (box) { var b = document.createElement('span'); b.className = 'hx-badge-tag is-low'; b.textContent = badgeText; box.appendChild(b); }
      }
    },
    watch: function () {
      var els = document.querySelectorAll('[data-hx-stock]:not([data-hx-stock-seen])');
      if (!els.length) return;
      var io = HxStock._io || (HxStock._io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          var el = e.target;
          HxStock.get(el.getAttribute('data-hx-stock')).then(function (p) { HxStock.apply(el, p); });
        });
      }, { rootMargin: '200px' }) : null);
      els.forEach(function (el) {
        el.setAttribute('data-hx-stock-seen', '');
        if (io) io.observe(el);
        else HxStock.get(el.getAttribute('data-hx-stock')).then(function (p) { HxStock.apply(el, p); });
      });
    }
  };
  /* cards arrive late (AJAX fills, tab switches) — re-scan on DOM changes */
  function stockBoot() {
    if (!window.Qumra || !Qumra.product) return;
    var setLines = function (c) { HxStock.lines = (c && c.items) || []; HxStock.refresh(); };
    if (Qumra.cart && Qumra.cart.get) Qumra.cart.get().then(setLines).catch(function () {});
    window.addEventListener('cart:updated', function (e) {
      var d = e.detail || {};
      if (d.items) setLines(d); else if (Qumra.cart && Qumra.cart.get) Qumra.cart.get().then(setLines).catch(function () {});
    });
    HxStock.watch();
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(HxStock.watch, 120); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stockBoot);
  else stockBoot();
  window.HxStock = HxStock;

  /* ------------------------------------------------------------------------
     HxLineOpts — "Size: XL" under each cart line (drawer + cart page).
     Neither the server's cart nor /ajax/cart carries the chosen options —
     only variantId — so the product is read (HxStock's cache) and the
     variant's option labels are written into the row's .hy-citem-opts.
     ------------------------------------------------------------------------ */
  var HxLineOpts = {
    lines: [],
    label: function (v) {
      return (v.options || []).map(function (o) {
        var name = (o.option && o.option.name) || '';
        var val = o.label || o.name || o.value || '';
        return { name: name, val: val, color: (o.option && o.option.type === 'color') ? (o.value || '') : '' };
      }).filter(function (x) { return x.val; });
    },
    paint: function () {
      HxLineOpts.lines.forEach(function (l) {
        /* the add/update payload leaves productData.slug null, so the drawer
           builds its links as a bare "/products/" — resolve the slug by
           productId and repair them, then read the variant's options */
        var slug = l.productData && l.productData.slug;
        (slug ? Promise.resolve(slug) : HxLineOpts.slugOf(l.productId)).then(function (sl) {
          if (!sl) return null;
          document.querySelectorAll('[data-cart-item="' + l._id + '"] a[href]').forEach(function (a) {
            if (/\/products\/?$/.test(a.getAttribute('href'))) a.setAttribute('href', HxPosts.prefix() + '/products/' + encodeURIComponent(sl));
          });
          return l.variantId ? HxStock.get(sl) : null;
        }).then(function (p) {
          if (!p) return;
          var v = (p.variants || []).find(function (x) { return String(x._id) === String(l.variantId); });
          if (!v) return;
          var opts = HxLineOpts.label(v);
          if (!opts.length) return;
          var html = opts.map(function (o) {
            return '<span class="hy-citem-opt">' + esc(o.name) + (o.name ? ': ' : '') +
              (o.color ? '<i class="hy-citem-dot" style="background:' + esc(o.color) + '"></i>' : '') +
              '<b>' + esc(o.val) + '</b></span>';
          }).join('');
          document.querySelectorAll('[data-cart-item="' + l._id + '"]').forEach(function (row) {
            var box = row.querySelector('.hy-citem-opts');
            if (box && box.getAttribute('data-hx-opts') === String(l.variantId)) return;
            if (!box) {
              box = document.createElement('div'); box.className = 'hy-citem-opts';
              var head = row.querySelector('.hy-citem-head');
              if (head) head.insertAdjacentElement('afterend', box); else return;
            }
            box.setAttribute('data-hx-opts', String(l.variantId));
            box.innerHTML = html;
          });
        });
      });
    },
    /* productId → slug, from the listing (one request, cached) */
    slugOf: function (pid) {
      if (!HxLineOpts._map) {
        HxLineOpts._map = fetch('/ajax/search/products?q=', { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .then(function (d) { var m = {}; ((d && (d.products || d.data)) || []).forEach(function (x) { m[x._id] = x.slug; }); return m; })
          .catch(function () { return {}; });
      }
      return HxLineOpts._map.then(function (m) { return m[pid] || null; });
    },
    set: function (c) { HxLineOpts.lines = (c && c.items) || []; HxLineOpts.paint(); }
  };
  function linesBoot() {
    if (!window.Qumra || !Qumra.cart || !Qumra.cart.get) return;
    Qumra.cart.get().then(HxLineOpts.set).catch(function () {});
    window.addEventListener('cart:updated', function (e) {
      var d = e.detail || {};
      /* the drawer re-renders its rows after the event — paint once it has */
      var go = function (c) { setTimeout(function () { HxLineOpts.set(c); }, 80); };
      if (d.items) go(d); else Qumra.cart.get().then(go).catch(function () {});
    });
  }
  /* rows get rebuilt (drawer refresh, qty change) — repaint after each; the
     data-hx-opts guard stops our own write from looping */
  function linesWatch() {
    var t = null;
    new MutationObserver(function (ms) {
      if (!ms.some(function (m) { return [].some.call(m.addedNodes, function (n) { return n.nodeType === 1 && (n.matches('[data-cart-item]') || n.querySelector && n.querySelector('[data-cart-item]')); }); })) return;
      clearTimeout(t); t = setTimeout(HxLineOpts.paint, 60);
    }).observe(document.body, { childList: true, subtree: true });
  }
  function linesStart() { linesBoot(); linesWatch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', linesStart);
  else linesStart();
  window.HxLineOpts = HxLineOpts;

  /* ------------------------------------------------------------------------
     HxMini — compact product tiles (widgets/deal-panels). ⚠️ Markup mirrors
     the `mini` macro there. Fills [data-hx-mini] from its collection or a
     sort; demo tiles stay if nothing comes back.
     ------------------------------------------------------------------------ */
  var HxMini = {
    build: function (p) {
      var slug = p.slug || p.handle || p._id;
      var img = (p.images && p.images[0] && p.images[0].fileUrl) || '';
      var price = Number(p.pricing && p.pricing.price) || 0;
      var was = Number(p.pricing && p.pricing.compareAtPrice) || 0;
      return '<a href="/products/' + encodeURIComponent(slug) + '" class="hx-dp-item">' +
        '<span class="hx-dp-media">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy"/>' : '') + '</span>' +
        '<span class="hx-dp-price">' + money(price) + (was > price ? ' <s>' + moneyRaw(was) + '</s>' : '') + '</span>' +
        '<span class="hx-dp-name">' + esc(p.title) + '</span></a>';
    },
    fill: function (el) {
      if (!el || el.__hxMini) return;
      el.__hxMini = true;
      var limit = Number(el.getAttribute('data-limit')) || 4;
      var col = el.getAttribute('data-col');
      var url = '/ajax/search/products?q=' + (col ? '&collectionId=' + encodeURIComponent(col) : '&sort=' + encodeURIComponent(el.getAttribute('data-sort') || 'created-desc'));
      fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) {
          var list = (d && (d.products || d.data)) || [];
          if (list.length) el.innerHTML = list.slice(0, limit).map(HxMini.build).join('');
        })
        .catch(function () {});
    }
  };
  /* ------------------------------------------------------------------------
     HxPosts — the latest articles for widgets/blog-posts.
     /blogs (or /blogs/<handle>) → each blog page → the .hy-post cards that
     ui/article-card.njk renders there. Keeps the demo cards if none.
     ⚠️ Card markup mirrors the `card` macro in the widget.
     ------------------------------------------------------------------------ */
  var HxPosts = {
    prefix: function () {
      var seg = (location.pathname.split('/')[1] || '').toLowerCase();
      var lang = (document.documentElement.lang || '').toLowerCase();
      return (/^[a-z]{2}$/.test(seg) && seg === lang) ? '/' + seg : '';
    },
    get: function (path) {
      var theme = new URLSearchParams(location.search).get('theme');
      var url = HxPosts.prefix() + path + (theme ? (path.indexOf('?') > -1 ? '&' : '?') + 'theme=' + encodeURIComponent(theme) : '');
      return fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (h) { return new DOMParser().parseFromString(h, 'text/html'); })
        .catch(function () { return null; });
    },
    fill: function (el) {
      if (!el || el.__hxPosts) return;
      el.__hxPosts = true;
      var limit = Number(el.getAttribute('data-limit')) || 4;
      var handle = el.getAttribute('data-blog');
      var blogs = handle ? Promise.resolve(['/blogs/' + encodeURIComponent(handle)])
        : HxPosts.get('/blogs').then(function (doc) {
            if (!doc) return [];
            var seen = {}, out = [];
            doc.querySelectorAll('main a[href*="/blogs/"]').forEach(function (a) {
              var h = a.getAttribute('href').replace(/^\/[a-z]{2}(?=\/blogs\/)/, '');
              if (/^\/blogs\/[^/?#]+$/.test(h) && !seen[h]) { seen[h] = 1; out.push(h); }
            });
            return out.slice(0, 8);
          });
      blogs.then(function (list) {
        return Promise.all(list.map(HxPosts.get));
      }).then(function (docs) {
        var seen = {}, posts = [];
        docs.forEach(function (doc) {
          if (!doc) return;
          doc.querySelectorAll('a.hy-post[href*="/articles/"], .hx-bg-card').forEach(function (a) {
            var link = a.matches('a') ? a : a.querySelector('.hx-bg-title a');
            if (!link || (link.getAttribute('href') || '').indexOf('/articles/') < 0) return;
            var href = link.getAttribute('href').replace(/^\/[a-z]{2}(?=\/articles\/)/, '');
            if (seen[href]) return; seen[href] = 1;
            var img = a.querySelector('.hy-post-media img, .hx-bg-media img');
            var time = a.querySelector('time');
            var ex = a.querySelector('.hy-post-excerpt, .hx-bg-excerpt');
            var cat = a.querySelector('.hx-bg-cat'), au = a.querySelector('.hx-bg-author');
            posts.push({ url: HxPosts.prefix() + href, img: img ? img.getAttribute('src') : '',
              title: (a.querySelector('.hy-post-title, .hx-bg-title') || {}).textContent || '',
              date: time ? time.getAttribute('datetime') : '', excerpt: ex ? ex.textContent : '',
              cat: cat ? cat.textContent.trim() : '', author: au ? au.textContent.trim() : '' });
          });
        });
        if (!posts.length) return;
        posts.sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
        var read = el.getAttribute('data-read') || '';
        var showDate = el.getAttribute('data-date') !== 'off', showEx = el.getAttribute('data-excerpt') !== 'off';
        if (el.getAttribute('data-card') === 'bg') {
          var showCat = el.getAttribute('data-cat') !== 'off';
          el.innerHTML = posts.slice(0, limit).map(function (p) {
            return '<article class="hx-bg-card">' +
              '<a href="' + esc(p.url) + '" class="hx-bg-media" tabindex="-1" aria-hidden="true">' + (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy"/>' : '<span class="hx-bg-noimg"></span>') + '</a>' +
              (showCat && p.cat ? '<p class="hx-bg-cat">' + esc(p.cat) + '</p>' : '') +
              '<h2 class="hx-bg-title"><a href="' + esc(p.url) + '">' + esc(p.title.trim()) + '</a></h2>' +
              ((p.author || (showDate && p.date)) ? '<p class="hx-bg-meta">' + (p.author ? '<span class="hx-bg-author"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path stroke-linecap="round" d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>' + esc(p.author) + '</span>' : '') +
                (p.author && showDate && p.date ? '<span class="hx-bg-dot" aria-hidden="true">·</span>' : '') +
                (showDate && p.date ? '<time datetime="' + esc(p.date) + '" data-hy-date>' + esc(p.date.slice(0, 10)) + '</time>' : '') + '</p>' : '') +
              (showEx && p.excerpt ? '<p class="hx-bg-excerpt">' + esc(p.excerpt.trim()) + '</p>' : '') +
              '</article>';
          }).join('');
          if (window.HayatLocaliseDates) window.HayatLocaliseDates(el);
          return;
        }
        el.innerHTML = posts.slice(0, limit).map(function (p) {
          return '<article class="hx-bp-card">' +
            '<a href="' + esc(p.url) + '" class="hx-bp-media" tabindex="-1" aria-hidden="true">' + (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy"/>' : '') + '</a>' +
            '<h3 class="hx-bp-title"><a href="' + esc(p.url) + '">' + esc(p.title.trim()) + '</a></h3>' +
            (showDate && p.date ? '<time class="hx-bp-date" datetime="' + esc(p.date) + '" data-hy-date>' + esc(p.date.slice(0, 10)) + '</time>' : '') +
            (showEx && p.excerpt ? '<p class="hx-bp-excerpt">' + esc(p.excerpt.trim()) + '</p>' : '') +
            (read ? '<a href="' + esc(p.url) + '" class="hx-bp-more">' + esc(read) + '</a>' : '') +
            '</article>';
        }).join('');
        if (window.HayatLocaliseDates) window.HayatLocaliseDates(el);
      });
    }
  };
  /* ------------------------------------------------------------------------
     COMPARE — Alpine store `hxCompare` (up to 5 products, kept in
     localStorage 'hx-compare'). Cards toggle with toggle(p); the drawer and
     the comparison table live in ui/hx-compare.njk (included by the layout).
     The table's rows are read from the full product (/ajax/product).
     ------------------------------------------------------------------------ */
  function registerCompare() {
    if (!window.Alpine || window.__hxCmpReady) return;
    window.__hxCmpReady = true;
    var KEY = 'hx-compare', MAX = 5;
    function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; } }
    Alpine.store('hxCompare', {
      items: load(),
      max: MAX,
      full: {},
      loading: false,
      warn: false,
      save() { try { localStorage.setItem(KEY, JSON.stringify(this.items)); } catch (e) {} },
      has(id) { return this.items.some(function (x) { return x.id === id; }); },
      toggle(p) {
        if (this.has(p.id)) { this.remove(p.id); return; }
        if (this.items.length >= MAX) { this.warn = true; var s = this; setTimeout(function () { s.warn = false; }, 2200); Alpine.store('modal').open('compare'); return; }
        this.items.push(p); this.save();
        Alpine.store('modal').open('compare');
      },
      remove(id) { this.items = this.items.filter(function (x) { return x.id !== id; }); this.save(); if (!this.items.length) Alpine.store('modal').close(); },
      clear() { this.items = []; this.save(); Alpine.store('modal').close(); },
      open() {
        var self = this; Alpine.store('modal').open('compare-table');
        var need = this.items.filter(function (x) { return !self.full[x.id]; });
        if (!need.length) return;
        this.loading = true;
        Promise.all(need.map(function (x) {
          return Qumra.product.get(x.slug).then(function (r) { return (r && (r.data || r.product)) || r || null; }).catch(function () { return null; })
            .then(function (p) { self.full[x.id] = p || {}; });
        })).then(function () { self.full = Object.assign({}, self.full); self.loading = false; });
      },
      desc(id) { var p = this.full[id] || {}; var d = document.createElement('div'); d.innerHTML = p.description || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) || '-'; },
      rating(id) { var p = this.full[id] || {}; return Number(p.averageRating) || 0; },
      reviews(id) { var p = this.full[id] || {}; return Number(p.reviewsCount) || 0; },
      brand(id) { var p = this.full[id] || {}; var c = (p.collections || []).filter(function (x) { return x && x.title; })[0]; return c ? c.title : '-'; },
      brandUrl(id) { var p = this.full[id] || {}; var c = (p.collections || []).filter(function (x) { return x && x.handle; })[0]; return c ? '/shop/' + c.handle : ''; },
      options(id) {
        var p = this.full[id] || {};
        var out = (p.options || []).filter(function (o) { return o && (o.values || []).length; })
          .map(function (o) { return o.name + ': ' + o.values.map(function (v) { return v.label; }).join('، '); });
        return out.length ? out : ['-'];
      },
      stock(id) { var p = this.full[id] || {}; if (!p._id) return '-'; var n = Number(p.available != null ? p.available : p.quantity) || 0; var st = window.__hxStock || {}; return n > 0 ? String(st['in'] || '').replace('{count}', n) : (p.allowBackorder || p.isAvailable ? (st.plain || '') : (st.out || '')); },
      money(v) { return window.formatPrice ? window.formatPrice(v) : v; },
      moneyRaw(v) { return window.formatMoney ? window.formatMoney(v) : v; }
    });
  }
  if (window.Alpine) registerCompare();
  document.addEventListener('alpine:init', registerCompare);

  window.HxPosts = HxPosts;
  window.HxMini = HxMini;
  window.HxFill = HxFill;
  window.HxLoop = HxLoop;
  window.HxUpsell = HxUpsell;
  window.HxCard = HxCard;
  window.HxRail = HxRail;
  window.HxCountdown = HxCountdown;
})();
