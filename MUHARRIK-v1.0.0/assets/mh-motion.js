/*!
 * mh-motion.js — MUHARRIK scroll motion system (step 3)
 * ============================================================================
 * Needs GSAP 3.12 + ScrollTrigger loaded BEFORE this file (both `defer`, from
 * cdnjs, see layouts/layout.njk). Widgets declare motion with data attributes
 * only; this file owns every scroll listener.
 *
 * ATTRIBUTES (the contract, MUHARRIK-BRIEF-3 "Motion contract")
 *   data-mh-reveal="up|fade|left|right|scale|clip|clip-x"
 *       plays once when the element enters the viewport.
 *       optional data-mh-delay="0.15"  data-mh-duration="0.9"
 *   data-mh-stagger[="0.08"]   on a container: its [data-mh-item] descendants
 *       (or its direct children when there are none) reveal in sequence. The
 *       type comes from the item's own data-mh-reveal, else the container's
 *       data-mh-reveal, else "up". The container itself is not animated.
 *   data-mh-split               headline: WORDS slide up out of a mask, one by
 *       one. Words only (Arabic joins would break on letters); spaces, <br>
 *       and inline children (<em>, .mh-hl) are kept. Original text is kept for
 *       AT via aria-label on the headline + aria-hidden on the pieces.
 *   data-mh-parallax="-0.2"    translateY scrubbed with scroll; the value is
 *       the speed (fraction of the distance the element travels). Negative =
 *       moves up faster than the page.
 *   data-mh-zoom                image scrubs scale 1.15 → 1 while its section
 *       (closest <section>, else parent) passes the viewport.
 *   data-mh-count="12500"      counts up once on enter, formatted with
 *       Intl.NumberFormat(html lang). The element holds ONLY the digits;
 *       data-mh-prefix / data-mh-suffix are printed only when present
 *       (prefer sibling spans). data-mh-decimals, optional data-mh-locale.
 *   data-mh-progress            sets --mh-p (0→1) on the element as it crosses
 *       the viewport (top hits bottom edge → bottom hits top edge).
 *   data-mh-pin                 section with [data-mh-step] children.
 *       ≥1024px: pins for steps×100vh, scrubbed; sets --mh-p (0→1) and
 *       data-step="n" (1-BASED) on the section, .is-active on the current
 *       step. <1024px: no pin; a step is .is-active while its middle is in
 *       view, and data-step follows.
 *   --header-h                  set on :root (px) from the sticky header row's
 *       real height via ResizeObserver; runs even without GSAP.
 *   data-mh-hscroll             section with a [data-mh-track] child.
 *       ≥1024px: pins and translates the track by (trackWidth − box width),
 *       scrubbed; in RTL the track moves the other way. <1024px: a native
 *       overflow-x scroll-snap row (CSS in mh-motion.css).
 *   data-mh-velocity            on .mh-marquee: the CSS marquee speeds up with
 *       scroll velocity (playbackRate on the track's animation) and the strip
 *       skews slightly, easing back to rest.
 *
 * GLOBAL EXTRAS
 *   .mh-scrollbar — a 2px accent page-progress bar fixed at the top (injected).
 *   .hx-sec-h / .mh-head inside #hy-main get a gentle "up" reveal when they
 *   carry no data-mh-* of their own and no .mh-reveal class.
 *
 * SAFETY
 *   Hidden initial states exist ONLY under html.mh-motion, which this file
 *   adds after GSAP + ScrollTrigger are confirmed and reduced motion is off.
 *   If GSAP is missing, or prefers-reduced-motion is on, nothing is hidden,
 *   nothing moves, and counters print their final value.
 *
 * RE-INIT
 *   A debounced MutationObserver initialises only NEW nodes (Theme Editor
 *   re-renders, Alpine, AJAX grids) and kills triggers whose elements left
 *   the DOM. ScrollTrigger.refresh() runs after images load, after
 *   document.fonts.ready and after each batch.
 *
 * API
 *   window.MHMotion = {
 *     enabled,            // true when animating (GSAP present, no reduced motion)
 *     init(root),         // scan a subtree (default document) for new elements
 *     refresh(),          // debounced ScrollTrigger.refresh()
 *     kill(root),         // tear down triggers inside a subtree
 *     version
 *   }
 * ============================================================================
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var html = document.documentElement;
  var DESKTOP = '(min-width: 1024px)';
  var MOBILE = '(max-width: 1023.98px)';
  var ATTRS = ['reveal', 'stagger', 'split', 'parallax', 'zoom', 'count', 'progress', 'pin', 'hscroll', 'velocity'];
  var SELECTOR = ATTRS.map(function (a) { return '[data-mh-' + a + ']'; }).join(',');
  // Places where ScrollTrigger positions make no sense (fixed overlays, drawers).
  var SKIP_IN = '.hx-drawer,.hx-overlay,.hy-qv-modal,.taqa-overlay,dialog,[role="dialog"],#toast-container,.swiper-slide-duplicate';

  var reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var gsap = window.gsap;
  var ST = window.ScrollTrigger;
  var enabled = !!(gsap && ST && !reducedMQ.matches && !html.classList.contains('hx-no-anim'));

  var isRTL = function () { return html.getAttribute('dir') === 'rtl'; };
  var num = function (v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; };
  var seen = new WeakSet();           // elements already processed
  var registry = new Map();           // element -> cleanup fn
  var refreshTimer = 0, scanTimer = 0;
  var pendingRoots = [];

  /* ----------------------------------------------------------------------
     Number formatting (shared by live and static modes)
  ---------------------------------------------------------------------- */
  function formatter(el) {
    var d = Math.max(0, Math.min(6, parseInt(el.getAttribute('data-mh-decimals') || '0', 10) || 0));
    var loc = el.getAttribute('data-mh-locale') || html.lang || undefined;
    var f;
    try { f = new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch (e) { f = new Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
    var pre = el.getAttribute('data-mh-prefix') || '';
    var suf = el.getAttribute('data-mh-suffix') || '';
    return function (v) { return pre + f.format(v) + suf; };
  }
  function countStatic(root) {
    q(root, '[data-mh-count]').forEach(function (el) {
      if (seen.has(el)) return; seen.add(el);
      el.textContent = formatter(el)(num(el.getAttribute('data-mh-count'), 0));
    });
  }

  function q(root, sel) {
    var out = [];
    if (root.nodeType === 1 && root.matches && root.matches(sel)) out.push(root);
    if (root.querySelectorAll) out.push.apply(out, root.querySelectorAll(sel));
    return out;
  }
  function inOverlay(el) { return !!el.closest(SKIP_IN); }
  function register(el, kill) {
    var prev = registry.get(el);
    if (prev) { registry.set(el, function () { prev(); kill(); }); } else { registry.set(el, kill); }
  }
  function killTriggers(items) {
    items.forEach(function (t) { try { t && t.kill && t.kill(); } catch (e) { /* noop */ } });
  }

  /* ----------------------------------------------------------------------
     STATIC MODE — GSAP missing or reduced motion: show everything
  ---------------------------------------------------------------------- */
  function staticMode() {
    html.classList.remove('mh-motion');
    html.classList.add('mh-motion-off');
    countStatic(document);
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) {
        for (var i = 0; i < m.addedNodes.length; i++) {
          var n = m.addedNodes[i]; if (n.nodeType === 1) countStatic(n);
        }
      });
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    window.MHMotion = {
      enabled: false, version: VERSION,
      init: function (root) { countStatic(root || document); },
      refresh: function () {}, kill: function () {}
    };
  }

  /* ----------------------------------------------------------------------
     --header-h: the real height of the header row that sticks (.hx-main),
     kept on :root by a ResizeObserver. Widgets fall back to their own px.
     Runs in both modes (it is layout, not motion).
  ---------------------------------------------------------------------- */
  function trackHeaderHeight() {
    var head = document.querySelector('.hx-header .hx-main') || document.querySelector('.hx-header');
    if (!head) return;
    var apply = function () {
      var h = Math.round(head.getBoundingClientRect().height);
      if (h > 0) html.style.setProperty('--header-h', h + 'px');
    };
    apply();
    if ('ResizeObserver' in window) new ResizeObserver(apply).observe(head);
    else window.addEventListener('resize', apply);
  }
  if (document.body) trackHeaderHeight(); else document.addEventListener('DOMContentLoaded', trackHeaderHeight);

  if (!enabled) { staticMode(); return; }

  /* ----------------------------------------------------------------------
     LIVE MODE
  ---------------------------------------------------------------------- */
  gsap.registerPlugin(ST);
  ST.config({ ignoreMobileResize: true });
  // ⚠️ style.css sets `html { scroll-behavior: smooth }` (for #anchor links).
  // ScrollTrigger measures by jumping the scroll position during a refresh;
  // with smooth scrolling that jump does not happen, so every start/end was
  // computed as if the page sat at the top: off by the current scroll. That
  // is what made sections overlap / go black mid-page. Turn smoothing off
  // only for the duration of each refresh, then restore it.
  // Toggling it only around ST.refresh() is not enough: a trigger CREATED
  // while the page is mid-scroll (reload with scroll restoration, a section
  // re-rendered by the editor) measures without a refresh event. So while the
  // motion system runs, CSS smooth scrolling stays off and in-page #anchor
  // links get their smooth glide from JS instead.
  html.style.scrollBehavior = 'auto';
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="#"]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var url; try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.pathname !== location.pathname || !url.hash || url.hash === '#') return;
    var target; try { target = document.querySelector(decodeURIComponent(url.hash)); } catch (err) { return; }
    if (!target) return;
    e.preventDefault();
    var off = parseFloat(getComputedStyle(html).getPropertyValue('--header-h')) || 0;
    window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - off, behavior: 'smooth' });
    if (history.replaceState) history.replaceState(null, '', url.hash);
  });

  var EASE = 'power3.out';

  function willChange(el, on) {
    var list = Array.isArray(el) ? el : [el];
    list.forEach(function (n) { n.classList.toggle('mh-animating', !!on); });
  }
  function done(el) {
    el.classList.remove('mh-animating');
    el.classList.add('mh-done');
    gsap.set(el, { clearProps: 'transform,opacity,clipPath,willChange' });
  }

  // from/to vectors for each reveal type
  function revealVars(type) {
    var rtl = isRTL();
    switch (type) {
      case 'fade':   return { from: { opacity: 0.55 }, to: { opacity: 1 } };
      case 'left':   return { from: { x: rtl ? 48 : -48 }, to: { x: 0 } };
      case 'right':  return { from: { x: rtl ? -48 : 48 }, to: { x: 0 } };
      case 'scale':  return { from: { scale: 0.92 }, to: { scale: 1 } };
      case 'clip':   return { from: { clipPath: 'inset(0 0 25% 0)' }, to: { clipPath: 'inset(0 0 0% 0)' } };
      case 'clip-x': return { from: { clipPath: rtl ? 'inset(0 0 0 25%)' : 'inset(0 25% 0 0)' }, to: { clipPath: rtl ? 'inset(0 0 0 0%)' : 'inset(0 0% 0 0)' } };
      default:       return { from: { y: 40 }, to: { y: 0 } };
    }
  }

  // one-shot trigger: plays `play()` once when `el` enters; jumps to the end
  // when the page is already scrolled past it (restored scroll, anchors).
  function once(el, start, play, jump) {
    var fired = false;
    var fire = function (self, deferKill) {
      if (fired) return; fired = true;
      if (jump && self.scroll() >= self.end) jump(); else play();
      if (deferKill) setTimeout(function () { self.kill(); }, 0); else self.kill();
    };
    var st = ST.create({
      trigger: el, start: start || 'top 112%', once: true, fastScrollEnd: true,
      onEnter: function (self) { fire(self, false); },
      // A refresh (lazy image, font, editor re-render) can move the start
      // above the current scroll without a crossing; never leave it hidden.
      onRefresh: function (self) { if (self.scroll() >= self.start) fire(self, true); }
    });
    if (!fired && st.scroll() >= st.start) fire(st, true);
    return st;
  }

  /* ---- reveal ---- */
  function initReveal(el, type, opts) {
    opts = opts || {};
    var v = revealVars(type || el.getAttribute('data-mh-reveal') || 'up');
    var delay = num(el.getAttribute('data-mh-delay'), opts.delay || 0);
    var dur = num(el.getAttribute('data-mh-duration'), opts.duration || 0.9);
    var tw = gsap.fromTo(el, v.from, Object.assign({}, v.to, {
      duration: dur, delay: delay, ease: EASE, paused: true,
      onStart: function () { willChange(el, true); },
      onComplete: function () { done(el); }
    }));
    gsap.set(el, v.from);
    if (opts.noTrigger) return tw;
    var st = once(el, 'top 112%', function () { tw.play(); }, function () { tw.progress(1); });
    register(el, function () { killTriggers([st, tw]); });
    return tw;
  }

  /* ---- stagger ---- */
  function initStagger(c) {
    var items = Array.prototype.slice.call(c.querySelectorAll('[data-mh-item]')).filter(function (i) {
      // belongs to this container, not to a nested stagger container
      return i.closest('[data-mh-stagger]') === c;
    });
    if (!items.length) items = Array.prototype.slice.call(c.children);
    if (!items.length) return;
    var gap = num(c.getAttribute('data-mh-stagger'), 0.08);
    var baseType = c.getAttribute('data-mh-reveal') || 'up';
    var baseDelay = num(c.getAttribute('data-mh-delay'), 0);
    var tweens = items.map(function (it, i) {
      seen.add(it);
      return initReveal(it, it.getAttribute('data-mh-reveal') || baseType, { noTrigger: true, delay: baseDelay + i * gap });
    });
    var st = once(c, 'top 112%',
      function () { tweens.forEach(function (t) { t.play(); }); },
      function () { tweens.forEach(function (t) { t.progress(1); }); });
    register(c, function () { killTriggers([st].concat(tweens)); });
  }

  /* ---- split (words only) ---- */
  function splitWords(el) {
    // Plain text with <br> read as a space, so the aria-label keeps word gaps.
    var original = '';
    (function read(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var k = node.childNodes[i];
        if (k.nodeType === 3) original += k.nodeValue;
        else if (k.nodeType === 1) { if (k.tagName === 'BR') original += ' '; else read(k); }
      }
    })(el);
    original = original.replace(/\s+/g, ' ').trim();
    if (!original) return [];
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', original);
    var inners = [];
    function wrapText(textNode) {
      var text = textNode.nodeValue;
      if (!text.trim()) return;
      var frag = document.createDocumentFragment();
      var parts = text.split(/(\s+)/);
      parts.forEach(function (p) {
        if (!p) return;
        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
        var outer = document.createElement('span');
        outer.className = 'mh-w'; outer.setAttribute('aria-hidden', 'true');
        var inner = document.createElement('span');
        inner.className = 'mh-wi'; inner.textContent = p;
        outer.appendChild(inner); frag.appendChild(outer); inners.push(inner);
      });
      textNode.parentNode.replaceChild(frag, textNode);
    }
    function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (k) {
        if (k.nodeType === 3) wrapText(k);
        else if (k.nodeType === 1 && k.tagName !== 'BR' && !k.classList.contains('mh-w')) walk(k);
      });
    }
    walk(el);
    return inners;
  }
  function initSplit(el) {
    var inners = el.classList.contains('mh-split-ready') ? Array.prototype.slice.call(el.querySelectorAll('.mh-wi')) : splitWords(el);
    el.classList.add('mh-split-ready');
    if (!inners.length) { el.classList.add('mh-done'); return; }
    var delay = num(el.getAttribute('data-mh-delay'), 0);
    var tw = gsap.fromTo(inners, { yPercent: 115 }, {
      yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.045, delay: delay, paused: true,
      onStart: function () { willChange(inners, true); },
      onComplete: function () { willChange(inners, false); el.classList.add('mh-done'); gsap.set(inners, { clearProps: 'transform,willChange' }); }
    });
    gsap.set(inners, { yPercent: 115 });
    var st = once(el, 'top 112%', function () { tw.play(); }, function () { tw.progress(1); });
    register(el, function () { killTriggers([st, tw]); });
  }

  /* ---- parallax ---- */
  function initParallax(el) {
    var speed = num(el.getAttribute('data-mh-parallax'), -0.2);
    var dist = function () { return speed * (window.innerHeight + el.offsetHeight); };
    var tw = gsap.fromTo(el, { y: function () { return -dist() / 2; } }, {
      y: function () { return dist() / 2; }, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true,
        onToggle: function (self) { willChange(el, self.isActive); } }
    });
    register(el, function () { killTriggers([tw.scrollTrigger, tw]); gsap.set(el, { clearProps: 'transform,willChange' }); });
  }

  /* ---- zoom ---- */
  function initZoom(el) {
    var sec = el.closest('section') || el.parentElement || el;
    gsap.set(el, { transformOrigin: '50% 50%' });
    var tw = gsap.fromTo(el, { scale: 1.15 }, {
      scale: 1, ease: 'none',
      scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true,
        onToggle: function (self) { willChange(el, self.isActive); } }
    });
    register(el, function () { killTriggers([tw.scrollTrigger, tw]); gsap.set(el, { clearProps: 'transform,willChange' }); });
  }

  /* ---- count ---- */
  function initCount(el) {
    var target = num(el.getAttribute('data-mh-count'), 0);
    var fmt = formatter(el);
    var obj = { v: 0 };
    el.textContent = fmt(0);
    var tw = gsap.to(obj, { v: target, duration: 1.8, ease: 'power2.out', paused: true,
      onUpdate: function () { el.textContent = fmt(obj.v); },
      onComplete: function () { el.textContent = fmt(target); el.classList.add('mh-done'); } });
    var st = once(el, 'top bottom-=8', function () { tw.play(); }, function () { tw.progress(1); });
    register(el, function () { killTriggers([st, tw]); el.textContent = fmt(target); });
  }

  /* ---- progress (--mh-p) ---- */
  function initProgress(el) {
    var spec = (el.getAttribute('data-mh-progress') || '').split('|');
    el.style.setProperty('--mh-p', '0');
    var st = ST.create({
      trigger: el, start: spec[0] && spec[0].trim() ? spec[0].trim() : 'top bottom',
      end: spec[1] && spec[1].trim() ? spec[1].trim() : 'bottom top', scrub: true,
      onUpdate: function (self) { el.style.setProperty('--mh-p', self.progress.toFixed(4)); }
    });
    register(el, function () { killTriggers([st]); el.style.removeProperty('--mh-p'); });
  }

  /* ---- pin (scroll-telling) ---- */
  function initPin(sec) {
    var steps = Array.prototype.slice.call(sec.querySelectorAll('[data-mh-step]')).filter(function (s) {
      return s.closest('[data-mh-pin]') === sec;
    });
    var n = Math.max(1, steps.length);
    sec.style.setProperty('--mh-p', '0');
    sec.setAttribute('data-step', '1');
    // data-step is 1-BASED (markup ships data-step="1" + .is-active on step 1)
    function activate(i) {
      i = Math.max(0, Math.min(n - 1, i));
      sec.setAttribute('data-step', String(i + 1));
      steps.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
    }
    var mm = gsap.matchMedia();
    mm.add(DESKTOP, function () {
      // No ScrollTrigger pin (its pin-spacer is measured once and goes stale as
      // images, the sticky header and the overlapping finder change the page
      // above, which made sections overlap and left black screens). Instead the
      // section is made (steps x 100vh) tall and its first child is CSS-sticky;
      // ScrollTrigger only READS progress, it never moves anything.
      activate(0);
      sec.classList.add('mh-pin-sticky');
      sec.style.setProperty('--mh-steps', String(n));
      var st = ST.create({
        trigger: sec, start: 'top top', end: 'bottom bottom', invalidateOnRefresh: true,
        onUpdate: function (self) {
          var p = self.progress;
          sec.style.setProperty('--mh-p', p.toFixed(4));
          activate(Math.min(n - 1, Math.floor(p * n * 0.999)));
        },
        onToggle: function (self) { sec.classList.toggle('is-pinned', self.isActive); }
      });
      return function () { sec.classList.remove('is-pinned', 'mh-pin-sticky'); sec.style.removeProperty('--mh-steps'); st.kill(); };
    });
    mm.add(MOBILE, function () {
      sec.style.setProperty('--mh-p', '0');
      var secST = ST.create({ trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true,
        onUpdate: function (self) { sec.style.setProperty('--mh-p', self.progress.toFixed(4)); } });
      var list = steps.map(function (s, i) {
        return ST.create({
          trigger: s, start: 'top 65%', end: 'bottom 35%',
          onToggle: function (self) {
            s.classList.toggle('is-active', self.isActive);
            if (self.isActive) sec.setAttribute('data-step', String(i + 1));
          }
        });
      });
      if (steps.length && window.scrollY < 10) steps[0].classList.add('is-active');
      return function () { killTriggers(list.concat([secST])); steps.forEach(function (s) { s.classList.remove('is-active'); }); };
    });
    register(sec, function () { try { mm.revert(); } catch (e) { /* noop */ } removeOrphanSpacer(sec); });
  }

  /* ---- hscroll ---- */
  function initHscroll(sec) {
    // A native horizontal rail at every width (no pin: see initPin). The page
    // never jumps, nothing overlaps; the shopper scrolls the rail with a
    // trackpad / shift-wheel / swipe, or drags it with the mouse. --mh-p follows
    // the rail's own scroll position so readouts keep working.
    var track = sec.querySelector('[data-mh-track]');
    if (!track) return;
    sec.classList.add('mh-hscroll', 'mh-hscroll-native');
    var max = function () { return Math.max(1, track.scrollWidth - track.clientWidth); };
    var onScroll = function () {
      var p = Math.min(1, Math.abs(track.scrollLeft) / max());
      sec.style.setProperty('--mh-p', p.toFixed(4));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    // mouse drag-to-scroll (pointer: fine only; touch already swipes natively)
    var down = false, startX = 0, startLeft = 0, moved = false;
    var onDown = function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; moved = false; startX = e.clientX; startLeft = track.scrollLeft;
    };
    var onMove = function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 4) { moved = true; track.classList.add('is-dragging'); }
      if (moved) { track.scrollLeft = startLeft - dx; e.preventDefault(); }
    };
    var onUp = function () { down = false; setTimeout(function () { track.classList.remove('is-dragging'); }, 0); };
    var onClick = function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    track.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    track.addEventListener('click', onClick, true);
    register(sec, function () {
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      track.removeEventListener('click', onClick, true);
      sec.classList.remove('mh-hscroll-native');
    });
  }


  /* ---- velocity marquee ---- */
  function initVelocity(mq) {
    // EVERY track of the strip must share one rate: a marquee is two copies of
    // the same run laid end to end, and speeding up only the first lets the
    // copies drift apart until their words overlap.
    var tracks = mq.querySelectorAll('.mh-marquee-track');
    var track = tracks[0] || mq.firstElementChild;
    if (!track) return;
    if (!tracks.length) tracks = [track];
    // Performance: the strips are huge outlined type, so skewing them repaints
    // every glyph on every scroll frame. Skew is opt-in (data-mh-velocity="skew");
    // by default only the playback rate changes, which stays on the compositor.
    // The rate is retargeted only when it moves by > 0.15, not on every frame.
    var useSkew = (mq.getAttribute('data-mh-velocity') || '').indexOf('skew') > -1;
    var state = { rate: 1, skew: 0 };
    var lastTarget = 1;
    var apply = function () {
      if (useSkew) gsap.set(mq, { skewX: state.skew });
      for (var t = 0; t < tracks.length; t++) {
        var anims = tracks[t].getAnimations ? tracks[t].getAnimations() : [];
        for (var i = 0; i < anims.length; i++) anims[i].playbackRate = state.rate;
      }
    };
    var settle = function () {
      lastTarget = 1;
      gsap.to(state, { rate: 1, skew: 0, duration: 1.4, ease: 'power2.out', overwrite: true, onUpdate: apply });
    };
    var settleTimer = null;
    var st = ST.create({
      trigger: mq, start: 'top bottom', end: 'bottom top',
      onUpdate: function (self) {
        var v = self.getVelocity();
        var rate = 1 + Math.min(1.8, Math.abs(v) / 1400);
        if (Math.abs(rate - lastTarget) > 0.15) {
          lastTarget = rate;
          gsap.to(state, { rate: rate, skew: useSkew ? gsap.utils.clamp(-5, 5, v / 500) : 0, duration: 0.45, ease: 'power2.out', overwrite: true, onUpdate: apply });
        }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, 140);
      },
      onLeave: settle, onLeaveBack: settle
    });
    register(mq, function () { killTriggers([st]); gsap.killTweensOf(state); state.rate = 1; state.skew = 0; apply(); gsap.set(mq, { clearProps: 'transform' }); });
  }

  /* ---- orphaned pin-spacer (Theme Editor replaced the pinned node) ---- */
  function removeOrphanSpacer(el) {
    document.querySelectorAll('.pin-spacer').forEach(function (sp) {
      if (sp.children.length === 0 || (!el.isConnected && sp.contains(el))) {
        if (!sp.firstElementChild || !sp.firstElementChild.isConnected) { try { sp.remove(); } catch (e) { /* noop */ } }
      }
    });
  }

  /* ---- page scroll progress bar ---- */
  function initScrollbar() {
    if (document.querySelector('.mh-scrollbar')) return;
    var bar = document.createElement('div');
    bar.className = 'mh-scrollbar'; bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    gsap.set(bar, { scaleX: 0, transformOrigin: isRTL() ? '100% 50%' : '0% 50%' });
    ST.create({ start: 0, end: 'max', onUpdate: function (self) { gsap.set(bar, { scaleX: self.progress }); } });
  }

  /* ----------------------------------------------------------------------
     INIT — scan a subtree; each element is processed once
  ---------------------------------------------------------------------- */
  function hasMotionAttr(el) {
    for (var i = 0; i < el.attributes.length; i++) if (el.attributes[i].name.indexOf('data-mh-') === 0) return true;
    return false;
  }
  function init(root) {
    root = root || document;
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    var jobs = [];
    q(root, SELECTOR).forEach(function (el) {
      if (seen.has(el)) return;
      if (inOverlay(el)) { seen.add(el); el.classList.add('mh-done'); if (el.hasAttribute('data-mh-count')) el.textContent = formatter(el)(num(el.getAttribute('data-mh-count'), 0)); return; }
      jobs.push(el);
    });
    // default heading reveal
    var main = document.getElementById('hy-main');
    q(root, '.hx-sec-h,.mh-head').forEach(function (el) {
      if (seen.has(el) || hasMotionAttr(el) || el.classList.contains('mh-reveal') || inOverlay(el)) return;
      if (main && !main.contains(el)) return;
      if (el.closest('[data-mh-stagger],[data-mh-split],.mh-head') !== (el.classList.contains('mh-head') ? el : null)) return;
      el.setAttribute('data-mh-reveal', 'up');
      el.setAttribute('data-mh-auto', '');
      jobs.push(el);
    });
    if (!jobs.length) return 0;
    // Stagger containers first so their items are claimed before the reveal pass.
    jobs.sort(function (a, b) { return (b.hasAttribute('data-mh-stagger') ? 1 : 0) - (a.hasAttribute('data-mh-stagger') ? 1 : 0); });
    jobs.forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      try {
        if (el.hasAttribute('data-mh-stagger')) initStagger(el);
        else if (el.hasAttribute('data-mh-split')) initSplit(el);
        else if (el.hasAttribute('data-mh-reveal')) initReveal(el);
        if (el.hasAttribute('data-mh-parallax')) initParallax(el);
        if (el.hasAttribute('data-mh-zoom')) initZoom(el);
        if (el.hasAttribute('data-mh-count')) initCount(el);
        if (el.hasAttribute('data-mh-progress')) initProgress(el);
        if (el.hasAttribute('data-mh-pin')) initPin(el);
        if (el.hasAttribute('data-mh-hscroll')) initHscroll(el);
        if (el.hasAttribute('data-mh-velocity') && el.classList.contains('mh-marquee')) initVelocity(el);
      } catch (e) {
        // never leave a node hidden because one effect threw
        el.classList.add('mh-done'); gsap.set(el, { clearProps: 'transform,opacity,clipPath' });
        if (window.console) console.warn('[mh-motion] failed on', el, e);
      }
    });
    scheduleRefresh();
    return jobs.length;
  }

  function kill(root) {
    root = root || document;
    registry.forEach(function (fn, el) {
      if (root === document || root === el || (root.contains && root.contains(el))) { try { fn(); } catch (e) { /* noop */ } registry.delete(el); }
    });
  }
  function gc() {
    registry.forEach(function (fn, el) {
      if (!el.isConnected) { try { fn(); } catch (e) { /* noop */ } registry.delete(el); }
    });
    document.querySelectorAll('.pin-spacer').forEach(function (sp) {
      if (!sp.firstElementChild) { try { sp.remove(); } catch (e) { /* noop */ } }
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { try { ST.refresh(); } catch (e) { /* noop */ } }, 120);
  }
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      var roots = pendingRoots; pendingRoots = [];
      gc();
      roots.forEach(function (r) { if (r.isConnected) init(r); });
    }, 90);
  }

  /* ----------------------------------------------------------------------
     BOOT
  ---------------------------------------------------------------------- */
  function boot() {
    try {
      html.classList.add('mh-motion');
      initScrollbar();
      init(document);
    } catch (e) {
      html.classList.remove('mh-motion');
      if (window.console) console.warn('[mh-motion] disabled:', e);
      staticMode();
      return;
    }

    var mo = new MutationObserver(function (list) {
      var any = false;
      list.forEach(function (m) {
        if (m.removedNodes.length) any = true;
        for (var i = 0; i < m.addedNodes.length; i++) {
          var n = m.addedNodes[i];
          if (n.nodeType !== 1) continue;
          if (n.classList.contains('mh-w') || n.classList.contains('pin-spacer') || n.classList.contains('mh-scrollbar')) continue;
          pendingRoots.push(n); any = true;
        }
      });
      if (any) scheduleScan();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Layout settles: fonts, images (load does not bubble; capture catches it), window load.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRefresh);
    document.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'IMG') scheduleRefresh(); }, true);
    window.addEventListener('load', scheduleRefresh);
    window.addEventListener('pageshow', scheduleRefresh);

    // ANY height change of the page content (lazy images without a load event
    // yet, Alpine/AJAX filling a rail, the finder rendering its options, the
    // sticky header switching) moves every trigger below it. Watching the main
    // column's size catches all of them; stale start/end values are what made
    // the scroll-telling section jump straight to its last step.
    if ('ResizeObserver' in window) {
      var mainEl = document.getElementById('hy-main') || document.body;
      var lastH = 0;
      new ResizeObserver(function (entries) {
        var h = Math.round(entries[0].contentRect.height);
        if (Math.abs(h - lastH) > 2) { lastH = h; scheduleRefresh(); }
      }).observe(mainEl);
    }

    // Reduced motion switched on while browsing: show everything, stop moving.
    var onReduce = function (e) {
      if (!e.matches) return;
      mo.disconnect();
      kill(document);
      document.querySelectorAll('.mh-animating').forEach(function (n) { n.classList.remove('mh-animating'); });
      gsap.set(document.querySelectorAll('[data-mh-reveal],[data-mh-item],.mh-wi,[data-mh-parallax],[data-mh-zoom]'), { clearProps: 'transform,opacity,clipPath' });
      ST.getAll().forEach(function (t) { t.kill(); });
      staticMode();
    };
    if (reducedMQ.addEventListener) reducedMQ.addEventListener('change', onReduce);
    else if (reducedMQ.addListener) reducedMQ.addListener(onReduce);

    window.MHMotion = {
      enabled: true, version: VERSION,
      init: function (root) { gc(); return init(root || document); },
      refresh: scheduleRefresh,
      kill: kill
    };
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
