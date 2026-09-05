// =================================================================
//  Admin — Live Preview Controller  (generic, editor-agnostic)
//
//  Extracted verbatim from admin/js/settings.js (milestone 1I-A) with
//  NO behaviour change. Owns the double-buffered public-page <iframe>
//  preview: frame lifecycle, navigation generations, the
//  READY / DATA / APPLIED / ERROR handshake, scale-to-fit geometry,
//  the Page / Device / Language / Theme / View controls, Expand,
//  same-origin + known-source + navigation-generation message
//  validation, PREVIEW_NAVIGATE / FOCUS transport (semantic targets only —
//  never selectors), and the Location-image direct-edit transport + sequencing.
//
//  It does NOT know how a restaurant draft is built, how branding
//  object-URLs are produced, or how to focus an editor card. Editors
//  pass a ready-made draft to setDraft() and subscribe with on().
//
//  Load AFTER auth.js (uses the global showToast) and BEFORE the
//  editor script that calls window.LivePreview.mount(...).
//
//  Usage:
//    const preview = window.LivePreview.mount({
//      root:         document.getElementById('live-preview'),
//      expandTarget: document.querySelector('.settings-layout'),
//      expandClass:  'is-preview-expanded',
//    });
//    preview.on('stat-click', ({ previewId }) => ...);
//    preview.setDraft(restaurantDraftObject);
// =================================================================

window.LivePreview = (function () {
  'use strict';

  // Whitelisted preview targets. The iframe src is only ever built from
  // this map after validating the key — never from a raw postMessage string.
  const DEFAULT_PAGES = {
    home:     '../index.html',
    menu:     '../products.html',
    location: '../location.html',
    contact:  '../contact.html',
  };
  // Simulated CSS viewport width. Desktop = 1024: the smallest width at which
  // the public stylesheet's real desktop layout is fully active (its
  // breakpoints are 768px and 1024px), so downscaling into the preview panel
  // is gentle and text/images stay legible.
  const DEFAULT_VIEWPORT = { desktop: 1024, mobile: 390 };

  function mount(opts) {
    opts = opts || {};
    const root   = opts.root || document;
    const PAGES  = opts.pages || DEFAULT_PAGES;
    const VP     = opts.viewport || DEFAULT_VIEWPORT;
    const ORIGIN = window.location.origin;
    // Injected notice callback. Falls back to an ambient global only if nothing
    // was supplied, so the host can keep the controller free of that dependency.
    const TOAST  = (typeof opts.toast === 'function')
      ? opts.toast
      : (typeof showToast === 'function' ? showToast : function () {});

    // ── Preview display state — admin-only. NEVER persisted, NEVER dirty. ──
    let _page   = (opts.initialState && opts.initialState.page)   || 'home';    // requested page (selector reflects it now)
    let _device = (opts.initialState && opts.initialState.device) || 'desktop'; // 'desktop' | 'mobile'
    let _lang   = (opts.initialState && opts.initialState.lang)   || 'en';      // 'en' | 'ar' — authoritative
    let _theme  = (opts.initialState && opts.initialState.theme)  || 'dark';    // 'dark' | 'light' — authoritative
    let _zoom   = (opts.initialState && opts.initialState.zoom)   || 'fit';     // 'fit' | '100'
    let _expanded = false;
    let _pendingFocus = null;          // { kind, target?, id?, highlight?, behavior? } — fired once the next page is ready
    let _focusRaf = 0;                 // rAF handle: coalesces rapid focus requests to one send per frame
    let _focusQueued = null;

    // ── Double-buffered frames ──────────────────────────────────────────
    let _stage    = root.querySelector ? root.querySelector('#lp-stage')    : document.getElementById('lp-stage');
    let _viewport = root.querySelector ? root.querySelector('#lp-viewport') : document.getElementById('lp-viewport');
    let _frames   = Array.prototype.slice.call(
      (root.querySelectorAll ? root : document).querySelectorAll('.preview-frame'));
    let _activeFrame   = null;                 // frame currently shown (null until first promotion)
    let _incomingFrame = _frames[0] || null;   // frame loading a page during a switch / first load
    // Monotonic navigation generation. Baked into each preview URL as
    // `?previewNav=N`; the child reads it from its OWN url at boot and stamps
    // every message with it, so a stale document (whose slot was re-navigated)
    // can never be mistaken for the current pending navigation — the iframe
    // contentWindow identity alone is NOT sufficient (it survives same-origin
    // src changes). Not a timestamp: a plain incrementing integer.
    let _navId       = 1;
    let pendingNav   = _frames[0] ? { id: _navId, page: _page, frame: _frames[0] } : null;
    let _activeNavId = 0;
    let _activePage  = _page;            // the page ACTUALLY rendered/visible (can briefly lag _page)
    let _previewReady = false;           // the pending frame has posted a matching PREVIEW_READY
    let _activeReady  = false;           // the active frame has rendered a draft at least once
    let _sendQueued   = false;

    // Layout-driven re-scale. The Preview stage width can change WITHOUT a
    // window resize: Expand hides the editor column, the narrow Edit|Preview
    // switch, a future shell resizing the editor pane. A ResizeObserver on the
    // stage catches every one AFTER layout has settled, so applyScale() never
    // runs against a stale pre-reflow width (the Expand geometry bug).
    let _ro          = null;
    let _scalePending = false;
    let _seenStageW  = -1;
    let _seenStageH  = -1;

    // ── Draft (opaque to the controller — the editor owns its shape) ────
    let _draft = null;
    let _firstDraftSent = false;

    // ── Location-image direct-edit transport state ─────────────────────
    let _locEditActive  = false;
    let _locEditPending = false;
    let _locEditSeed    = null;

    // ── Tiny event emitter ────────────────────────────────────────────
    let _handlers = {};
    function on(name, fn) {
      (_handlers[name] || (_handlers[name] = [])).push(fn);
      return function off() { _offOne(name, fn); };
    }
    function _offOne(name, fn) {
      const a = _handlers[name];
      if (!a) return;
      const i = a.indexOf(fn);
      if (i !== -1) a.splice(i, 1);
    }
    function _emit(name, data) {
      (_handlers[name] || []).slice().forEach(function (fn) {
        try { fn(data); } catch (e) { console.error('[live-preview] handler error for "' + name + '":', e); }
      });
    }

    // ── Listener bookkeeping so destroy() is complete ─────────────────
    const _teardown = [];
    function _bind(el, ev, fn, o) {
      el.addEventListener(ev, fn, o);
      _teardown.push(function () { el.removeEventListener(ev, fn, o); });
    }

    function _reducedMotion() {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // Preview URL for a page + navigation generation. The child reads
    // `previewNav` from this at boot; it is the ONLY source of the
    // document's generation. PREVIEW_DATA never redefines it.
    function _src(page, navId) {
      return PAGES[page] + '?adminPreview=1&previewNav=' + navId;
    }

    function _syncSeg(attr, value) {
      const scope = root.querySelectorAll ? root : document;
      scope.querySelectorAll('.lp-seg__btn[' + attr + ']').forEach(function (btn) {
        const on2 = btn.getAttribute(attr) === value;
        btn.classList.toggle('is-active', on2);
        btn.setAttribute('aria-pressed', on2 ? 'true' : 'false');
      });
    }

    function _syncControls() {
      if (_stage) {
        _stage.dataset.device = _device;
        _stage.dataset.zoom   = _zoom;
        _stage.dataset.theme  = _theme;   // themed loading surface (no white flash)
      }
      _syncSeg('data-page',   _page);
      _syncSeg('data-device', _device);
      _syncSeg('data-lang',   _lang);
      _syncSeg('data-theme',  _theme);
      _syncSeg('data-zoom',   _zoom);
    }

    // Geometry model (scale-to-fit without pre-transform clipping):
    //   .preview-frame — the REAL website document. Rendered at the full
    //     unscaled virtual viewport (targetW × tall: 1024 desktop / 390
    //     mobile), then CSS-scaled from its own top-left. The document keeps
    //     believing its viewport is targetW wide, so the real desktop
    //     breakpoint is used.
    //   #lp-viewport  — sized to the SCALED, on-screen rectangle
    //     (targetW*scale × availH). `overflow: hidden` only trims each frame's
    //     invisible scaled-away layout overflow, so #lp-stage gets no phantom
    //     scrollbars. It carries NO transform — that lives on the frames.
    //   #lp-stage     — the visible Admin preview area; the only scroll
    //     boundary.
    // Both frames get identical width/height/transform → an exact crossfade
    // stack. Reads _device, _zoom and the live stage size, so it is correct
    // after resize, Expand, mode switch and page navigation.
    function applyScale() {
      if (!_stage || !_viewport || !_frames.length) return;
      const targetW = VP[_device] || 1024;
      const availW  = Math.max(_stage.clientWidth  || targetW, 1);
      const availH  = Math.max(_stage.clientHeight || Math.round(availW * 1.4), 240);

      const scale = (_zoom === '100')
        ? 1
        : Math.max(Math.min(1, availW / targetW), 0.25);

      const fw = targetW + 'px';                        // unscaled virtual width
      const fh = Math.round(availH / scale) + 'px';     // unscaled virtual height (tall)
      const tf = scale === 1 ? 'none' : ('scale(' + scale + ')');
      _frames.forEach(function (f) {
        f.style.width     = fw;
        f.style.height    = fh;
        f.style.transform = tf;                         // scale the document itself
      });
      _viewport.style.width     = Math.round(targetW * scale) + 'px';   // on-screen rectangle
      _viewport.style.height    = Math.round(availH) + 'px';
      _viewport.style.transform = 'none';               // never transform the viewport box
      _stage.dataset.scale = scale.toFixed(3);
      _stage.dataset.zoom  = _zoom;
      _seenStageW = _stage.clientWidth;                 // raw dims this pass measured
      _seenStageH = _stage.clientHeight;
    }

    // Deferred re-scale for size changes that aren't a window resize (Expand,
    // narrow pane switch, shell editor resize). rAF-coalesced; a no-op when the
    // stage size is unchanged, so a scrollbar toggle can never oscillate.
    function _scheduleScale() {
      if (_scalePending) return;
      _scalePending = true;
      requestAnimationFrame(function () {
        _scalePending = false;
        if (!_stage) return;
        const w = _stage.clientWidth, h = _stage.clientHeight;
        if (w === _seenStageW && h === _seenStageH) return;
        applyScale();
      });
    }

    function refresh() { _syncControls(); applyScale(); }

    // ── Draft transport ──────────────────────────────────────────────
    function _sendNow(frame, navId) {
      if (!_draft || !frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage(
        { type: 'PREVIEW_DATA', nav: navId, payload: { restaurant: _draft, lang: _lang, theme: _theme } },
        ORIGIN);
    }
    // Ordinary draft update → refresh the ACTIVE frame in place (no reload,
    // no double buffer). Coalesced to one send per animation frame.
    function _flushActive() {
      if (_sendQueued) return;
      _sendQueued = true;
      requestAnimationFrame(function () {
        _sendQueued = false;
        if (_draft && _activeFrame && _activeReady) _sendNow(_activeFrame, _activeNavId);
      });
    }
    function setDraft(d) {
      _draft = d;
      // The one post-init catch-up: a frame may have posted PREVIEW_READY
      // before the editor produced its first draft. Seed it once, now.
      if (!_firstDraftSent) {
        _firstDraftSent = true;
        if (pendingNav && _previewReady) _sendNow(pendingNav.frame, pendingNav.id);
      }
      _flushActive();
    }

    // Normalise a focus descriptor. Accepts { type|kind:'section', target } or
    // { type|kind:'stat', id }. The controller only ever transports these two
    // shapes + a boolean `highlight` + an optional scroll `behavior`. It never
    // sees or forwards a CSS selector — the child resolves `target`/`id`
    // against its own whitelist.
    function _normFocus(d) {
      if (!d || typeof d !== 'object') return null;
      const kind = (d.type === 'stat' || d.kind === 'stat') ? 'stat' : 'section';
      const hi = d.highlight !== false;
      if (kind === 'stat') {
        const id = String(d.id == null ? '' : d.id).trim();
        return id ? { kind: 'stat', id: id, highlight: hi, behavior: d.behavior } : null;
      }
      const t = String(d.target == null ? '' : d.target).trim();
      return t ? { kind: 'section', target: t, highlight: hi, behavior: d.behavior } : null;
    }
    // Send PREVIEW_FOCUS to the ACTIVE frame, coalesced to one per animation
    // frame so rapid context switches (tab-tab-tab across fields) never fire a
    // burst of highlight flashes — the last request wins.
    function _applyFocus(nd) {
      if (!nd) return;
      _focusQueued = nd;
      if (_focusRaf) return;
      _focusRaf = requestAnimationFrame(function () {
        _focusRaf = 0;
        const d = _focusQueued;
        _focusQueued = null;
        if (!d || !_activeFrame || !_activeFrame.contentWindow) return;
        _activeFrame.contentWindow.postMessage({
          type: 'PREVIEW_FOCUS',
          kind: d.kind,
          target: d.target,
          id: d.id,
          highlight: d.highlight,
          behavior: d.behavior,
        }, ORIGIN);
      });
    }
    // Public: focus/scroll/highlight a known semantic target on the ACTIVE page,
    // or defer it until the pending navigation applies. Editors call this with
    // { type:'section', target } or { type:'stat', id } — never a selector.
    function focus(d) {
      const nd = _normFocus(d);
      if (!nd) return;
      if (pendingNav) { _pendingFocus = nd; return; }
      _applyFocus(nd);
    }
    // Back-compat: scroll only, no highlight.
    function scrollTo(target, o) {
      o = o || {};
      focus({ type: 'section', target: target, highlight: false, behavior: o.behavior });
    }

    // Change the previewed public page (double-buffered). `page` is validated
    // against PAGES; the iframe src is only ever built from that map. ACTIVE
    // stays visible and interactive; the OTHER slot loads `page` invisibly,
    // runs the full handshake, then crossfades in (completeNavigation). Every
    // preview display setting is untouched.
    // opts.focus → { type:'section', target } | { type:'stat', id } fired once
    // the page is ready (or now, if it is already active). opts.scrollTo (str)
    // is the legacy scroll-only form.
    function showPage(page, o) {
      o = o || {};
      const nd = o.focus ? _normFocus(o.focus)
        : (o.scrollTo ? _normFocus({ type: 'section', target: o.scrollTo, highlight: false }) : null);
      if (!PAGES[page] || _frames.length < 2) return;
      if (pendingNav && pendingNav.page === page) {          // already loading it
        if (nd) _pendingFocus = nd;
        return;
      }
      if (!pendingNav && page === _activePage) {             // already showing it
        if (nd) _applyFocus(nd);
        return;
      }
      // Navigating away from Location ends an open image-edit session — the
      // editor keeps its composition draft; the edit overlay just goes away
      // with the iframe.
      if (_locEditActive && page !== 'location') {
        _locEditActive = false; _locEditPending = false;
        _emit('locedit-end', { reason: 'nav-away' });
      }
      // A queued immediate focus was for the page we're now leaving — drop it;
      // the deferred `_pendingFocus` for the new page supersedes it.
      if (_focusRaf) { try { cancelAnimationFrame(_focusRaf); } catch (e) {} _focusRaf = 0; _focusQueued = null; }
      _pendingFocus = nd;
      _page = page;                            // requested page — selector reflects it now
      _syncSeg('data-page', _page);
      const incoming = (_activeFrame === _frames[0]) ? _frames[1] : _frames[0];
      _navId += 1;
      pendingNav     = { id: _navId, page: page, frame: incoming };
      _incomingFrame = incoming;
      _previewReady  = false;
      incoming.classList.remove('is-active', 'is-leaving');
      incoming.setAttribute('aria-hidden', 'true');
      if (_stage) _stage.dataset.theme = _theme;
      applyScale();                            // pre-size so it appears at the right dimensions
      incoming.src = _src(page, _navId);
      _notifyState();                          // requested page changed
    }

    // Incoming frame is ready (matched PREVIEW_APPLIED): promote it over the
    // current ACTIVE frame with a short crossfade, then recycle the old frame.
    function completeNavigation() {
      if (!pendingNav) return;
      const incoming = pendingNav.frame;
      const outgoing = (_activeFrame && _activeFrame !== incoming) ? _activeFrame : null;

      applyScale();                            // both frames sized identically — no jump
      _activeFrame  = incoming;
      _activeNavId  = pendingNav.id;
      _activePage   = pendingNav.page;
      _activeReady  = true;
      _incomingFrame = null;
      _previewReady  = false;
      const doFocus = _pendingFocus;
      _pendingFocus = null;
      pendingNav = null;

      incoming.classList.remove('is-leaving');
      incoming.classList.add('is-active');     // opacity 0 → 1 (or instant, reduced motion)
      incoming.removeAttribute('aria-hidden');

      // Frame is active now; position + highlight after the page settles —
      // unless a Location image edit is about to take over (its overlay owns
      // the visual; a contextual highlight would just fight the crop editor).
      if (doFocus && !(_locEditPending && _activePage === 'location')) {
        _applyFocus({ kind: doFocus.kind, target: doFocus.target, id: doFocus.id, highlight: doFocus.highlight, behavior: 'auto' });
      }

      // "Edit Image" was pressed while off the Location page — the page is now
      // ready and the draft has been sent; tell the child to enter edit mode.
      if (_locEditPending && _activePage === 'location') {
        _locEditPending = false;
        requestAnimationFrame(function () {
          _postToActive({ type: 'PREVIEW_LOCATION_EDIT', on: true, seed: _locEditSeed || {} });
          _emit('locedit-ready');
        });
      } else if (_locEditPending) {
        _locEditPending = false; _locEditActive = false;
        _emit('locedit-end', { reason: 'nav-abandoned' });   // navigated elsewhere → abandon
      }

      if (!outgoing) return;                   // first load — nothing to fade out

      if (_reducedMotion()) { _park(outgoing); return; }
      outgoing.classList.remove('is-active');
      outgoing.classList.add('is-leaving');    // opacity 1 → 0
      const done = function () {
        outgoing.removeEventListener('transitionend', done);
        clearTimeout(safety);
        _park(outgoing);
      };
      const safety = setTimeout(done, 260);    // cleanup only — not the readiness signal
      outgoing.addEventListener('transitionend', done);
    }

    // Take a faded-out frame fully out of play and stop its document so no
    // hidden public page keeps running. It is reused as the next incoming slot.
    // Bails if the frame has since been re-tasked (rapid navigation) so a stale
    // crossfade cleanup can never blank a frame that is now loading a new page.
    function _park(f) {
      if (!f || f === _activeFrame || f === _incomingFrame) return;
      if (pendingNav && f === pendingNav.frame) return;
      f.classList.remove('is-active', 'is-leaving');
      f.setAttribute('aria-hidden', 'true');
      try { f.src = 'about:blank'; } catch (e) {}
    }

    // Incoming page could not load / initialise. Keep the working ACTIVE page
    // visible; put the page selector back to it; surface a small notice.
    function _fail() {
      if (!pendingNav) return;
      const dead = pendingNav.frame;
      pendingNav = null;
      _incomingFrame = null;
      _previewReady = false;
      _pendingFocus = null;
      _park(dead);
      _page = _activePage;
      _syncSeg('data-page', _page);
      _emit('error', { page: dead && dead.dataset ? dead.dataset.slot : null });
      TOAST('Preview page could not be loaded.', 'error');
    }

    function _postToActive(msg) {
      if (_activeFrame && _activeFrame.contentWindow) {
        _activeFrame.contentWindow.postMessage(msg, ORIGIN);
      }
    }

    // Two frame contentWindows may exist during a transition — and a slot's
    // contentWindow identity SURVIVES a same-origin src change, so source alone
    // cannot tell a stale document from the fresh one in the same slot. Every
    // child message therefore carries `nav` (the generation from its boot URL);
    // READY / APPLIED / ERROR are only acted on when `msg.nav` still matches the
    // navigation they claim to belong to.
    function _onMessage(e) {
      if (e.origin !== ORIGIN) return;
      const src = e.source;
      const fromActive   = !!(_activeFrame   && src === _activeFrame.contentWindow);
      const fromIncoming = !!(_incomingFrame && src === _incomingFrame.contentWindow);
      if (!fromActive && !fromIncoming) return;
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      const isPending = fromIncoming && pendingNav && _incomingFrame === pendingNav.frame;
      const navMatchesPending = isPending && msg.nav === pendingNav.id;

      if (msg.type === 'PREVIEW_READY') {
        if (navMatchesPending) {
          _previewReady = true;
          _sendNow(pendingNav.frame, pendingNav.id);   // no-op until the editor has set a draft
        } else if (fromActive && msg.nav === _activeNavId) {
          _sendNow(_activeFrame, _activeNavId);         // active re-announced (rare)
        }
        // stale READY (msg.nav ≠ current generation) → ignored: no PREVIEW_DATA sent
      } else if (msg.type === 'PREVIEW_APPLIED') {
        if (navMatchesPending) completeNavigation();
        // stale / mismatched APPLIED → ignore; that frame is recycled on the next nav
      } else if (msg.type === 'PREVIEW_ERROR') {
        if (navMatchesPending) _fail();
        // a stale generation's error must NOT cancel the newer incoming navigation
      } else if (msg.type === 'PREVIEW_STAT_CLICK') {
        if (fromActive) _emit('stat-click', { previewId: msg.previewId });
      } else if (msg.type === 'PREVIEW_NAVIGATE') {
        // Same-site nav link clicked inside the ACTIVE preview. Validated
        // against the page allow-list; arbitrary paths are ignored.
        if (fromActive && PAGES[msg.page]) { _emit('navigate', { page: msg.page }); showPage(msg.page); }
      } else if (msg.type === 'PREVIEW_THEME_CHANGE') {
        // Real in-iframe theme button — keep the parent Theme control in sync.
        // The child already applied it, so no re-send.
        if (fromActive && (msg.theme === 'dark' || msg.theme === 'light')) {
          _theme = msg.theme;
          _syncControls();
          if (_stage) _stage.dataset.theme = _theme;
          _emit('theme-change', { theme: _theme });
          _notifyState();
        }
      } else if (msg.type === 'PREVIEW_LANGUAGE_CHANGE') {
        // Real in-iframe language toggle — keep the parent Language control in
        // sync. Child already applied it; no re-send.
        if (fromActive && (msg.lang === 'ar' || msg.lang === 'en')) {
          _lang = msg.lang;
          _syncControls();
          _emit('language-change', { lang: _lang });
          _notifyState();
        }
      } else if (msg.type === 'PREVIEW_LOCATION_COMPOSE') {
        // Owner dragged / zoomed / resized the real Location image. Validate
        // the numbers here and hand the editor a clean, range-checked object.
        if (!fromActive) return;
        const nx = Number(msg.position_x), ny = Number(msg.position_y), nz = Number(msg.zoom);
        const out = {};
        if (isFinite(nx)) out.position_x = Math.min(100, Math.max(0, Math.round(nx)));
        if (isFinite(ny)) out.position_y = Math.min(100, Math.max(0, Math.round(ny)));
        if (isFinite(nz)) out.zoom       = Math.min(1.6, Math.max(1, nz));
        if (msg.height === 'short' || msg.height === 'standard' || msg.height === 'tall') out.height = msg.height;
        _emit('locedit-compose', out);
      } else if (msg.type === 'PREVIEW_LOCATION_EDIT_DONE') {
        if (fromActive) _emit('locedit-done');
      } else if (msg.type === 'PREVIEW_LOCATION_EDIT_CANCEL') {
        if (fromActive) _emit('locedit-cancel');
      }
    }

    // Announce the current display state (page/device/lang/theme/zoom/expanded)
    // so a host can persist it. UI-only — no restaurant data, no navigation.
    function _notifyState() { _emit('state', getState()); }

    // ── Display-control setters (also driven by the in-panel buttons) ──
    function setDevice(v) {
      if (v !== 'desktop' && v !== 'mobile') return;
      _device = v; _syncControls(); applyScale(); _flushActive(); _notifyState();
    }
    function setLanguage(v) {
      if (v !== 'en' && v !== 'ar') return;
      _lang = v; _syncControls(); applyScale(); _flushActive(); _notifyState();   // re-send draft WITH the new lang
    }
    function setTheme(v) {
      if (v !== 'dark' && v !== 'light') return;
      _theme = v;
      if (_stage) _stage.dataset.theme = _theme;
      _syncControls(); applyScale(); _flushActive(); _notifyState();
    }
    function setViewMode(v) {
      if (v !== 'fit' && v !== '100') return;
      _zoom = v; _syncControls(); applyScale(); _flushActive(); _notifyState();
    }

    function setExpanded(on2) {
      _expanded = !!on2;
      if (opts.expandTarget && opts.expandClass) {
        opts.expandTarget.classList.toggle(opts.expandClass, _expanded);
      }
      if (_expandBtn) {
        _expandBtn.textContent = _expanded ? 'Back to editor' : 'Expand';
        _expandBtn.setAttribute('aria-pressed', String(_expanded));
      }
      // The editor column appears/disappears → the stage reflows to a new
      // width. The ResizeObserver catches the settled size; this is just the
      // snappy first pass. Without a ResizeObserver, wait two frames so the
      // grid has fully reflowed before measuring.
      if (_ro) _scheduleScale();
      else requestAnimationFrame(function () { requestAnimationFrame(applyScale); });
      _emit('expand', { expanded: _expanded });
      _notifyState();
    }

    // ── Location-image direct-edit capability (explicitly named) ───────
    function startLocationImageEdit(seed) {
      _locEditSeed = seed || {};
      if (_locEditActive && !_locEditPending && _activePage === 'location' && !pendingNav) {
        _postToActive({ type: 'PREVIEW_LOCATION_EDIT', on: true, seed: _locEditSeed });   // re-seed an open editor
        return;
      }
      _locEditActive = true;
      if (_activePage !== 'location' || pendingNav) {
        _locEditPending = true;
        showPage('location');   // child edit-start fires from completeNavigation
        return;
      }
      _postToActive({ type: 'PREVIEW_LOCATION_EDIT', on: true, seed: _locEditSeed });
      _emit('locedit-ready');
    }
    function updateLocationImageEdit(seed) {
      _locEditSeed = seed || _locEditSeed;
      if (_locEditActive && !_locEditPending && _activePage === 'location' && !pendingNav) {
        _postToActive({ type: 'PREVIEW_LOCATION_EDIT', on: true, seed: _locEditSeed });
      }
    }
    function stopLocationImageEdit() {
      const wasActive = _locEditActive;
      _locEditActive = false;
      _locEditPending = false;
      if (wasActive) _postToActive({ type: 'PREVIEW_LOCATION_EDIT', on: false });
    }

    function getState() {
      return {
        page: _page, activePage: _activePage, navigating: !!pendingNav,
        device: _device, lang: _lang, theme: _theme, zoom: _zoom, expanded: _expanded,
      };
    }

    function destroy() {
      if (_ro) { try { _ro.disconnect(); } catch (e) {} _ro = null; }
      if (_focusRaf) { try { cancelAnimationFrame(_focusRaf); } catch (e) {} _focusRaf = 0; }
      _focusQueued = null; _pendingFocus = null;
      _teardown.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
      try { _frames.forEach(function (f) { f.src = 'about:blank'; }); } catch (e) {}
      _handlers = {};
      _draft = null;
    }

    // ── Wire the in-panel controls (scoped to root) ───────────────────
    let _expandBtn = null;
    function _wireControls() {
      const scope = root.querySelectorAll ? root : document;
      scope.querySelectorAll('.lp-seg__btn[data-page]').forEach(function (b) {
        _bind(b, 'click', function () { showPage(b.dataset.page); });
      });
      scope.querySelectorAll('.lp-seg__btn[data-device]').forEach(function (b) {
        _bind(b, 'click', function () { setDevice(b.dataset.device); });
      });
      scope.querySelectorAll('.lp-seg__btn[data-lang]').forEach(function (b) {
        _bind(b, 'click', function () { setLanguage(b.dataset.lang); });
      });
      scope.querySelectorAll('.lp-seg__btn[data-theme]').forEach(function (b) {
        _bind(b, 'click', function () { setTheme(b.dataset.theme); });
      });
      scope.querySelectorAll('.lp-seg__btn[data-zoom]').forEach(function (b) {
        _bind(b, 'click', function () { setViewMode(b.dataset.zoom); });
      });
      _expandBtn = (root.querySelector ? root : document).querySelector('#lp-expand');
      if (_expandBtn) _bind(_expandBtn, 'click', function () { setExpanded(!_expanded); });
    }

    // ── Boot ─────────────────────────────────────────────────────────
    if (_stage) _stage.dataset.theme = _theme;   // themed first-load surface (behind the frames)

    // Per-frame load-failure watchers.
    _frames.forEach(function (f) {
      _bind(f, 'error', function () {
        if (pendingNav && pendingNav.frame === f) _fail();
      });
    });

    // Register the handshake listener + resize sync.
    _bind(window, 'message', _onMessage);
    _bind(window, 'resize', _scheduleScale);

    // Re-scale whenever the stage itself changes size — Expand toggling the
    // editor column, the narrow Edit|Preview switch, or (later) the shell
    // resizing the editor pane never fire `window resize`, so a plain rAF
    // after the class change can measure a stale width. The observer fires
    // AFTER layout has settled. One per controller; disconnected in destroy().
    if (typeof ResizeObserver === 'function' && _stage) {
      _ro = new ResizeObserver(function () { _scheduleScale(); });
      _ro.observe(_stage);
    }

    _wireControls();
    _syncControls();

    // Kick off the first-load navigation through the SAME generation mechanism
    // as every page switch (no special / unstamped first-load path).
    if (_frames[0]) _frames[0].src = _src(_page, _navId);
    applyScale();

    return {
      showPage: showPage,
      setDraft: setDraft,
      setDevice: setDevice,
      setLanguage: setLanguage,
      setTheme: setTheme,
      setViewMode: setViewMode,
      setExpanded: setExpanded,
      expand: setExpanded,
      refresh: refresh,
      applyScale: applyScale,
      scrollTo: scrollTo,
      focus: focus,
      startLocationImageEdit: startLocationImageEdit,
      updateLocationImageEdit: updateLocationImageEdit,
      stopLocationImageEdit: stopLocationImageEdit,
      on: on,
      off: _offOne,
      getState: getState,
      destroy: destroy,
    };
  }

  return { mount: mount };
})();
