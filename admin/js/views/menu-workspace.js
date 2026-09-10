// =================================================================
//  Admin Shell — Menu workspace  (milestone 1J)
//
//  A thin parent view that composes the two existing editor modules —
//  window.AdminViews.menu (Menu Items) and window.AdminViews.categories —
//  under one top-level shell route (#menu). It owns the workspace header
//  (title + description + the [ Menu Items | Categories ] editor tabs) and
//  exactly ONE mounted child at a time. It does NOT contain any CRUD logic
//  of its own; the child modules are unchanged.
//
//  Lifecycle: mount(ctx, root) / unmount() / isDirty(). Plus setSection() /
//  getSection() for the shell: subsection navigation flows through the shell
//  hash + the ONE shared unsaved-changes guard (admin-shell.js), never a
//  second confirm dialog here.
//
//  The persistent Live Preview belongs to the shell (ctx.preview) and is
//  never re-created when the subsection changes — both children only ever
//  call ctx.preview.showPage('menu'), a no-op once Menu is already shown.
// =================================================================

window.AdminViews = window.AdminViews || {};

window.AdminViews['menu-workspace'] = (function () {
  'use strict';

  var SECTIONS = {
    items:      { module: 'menu',       label: 'Menu Items' },
    categories: { module: 'categories', label: 'Categories' },
  };

  var ctx = null, root = null;
  var tabsEl = null, bodyEl = null;
  var activeSection = null;    // 'items' | 'categories'
  var activeChild = null;      // the child module API currently mounted
  var childToken = 0;          // guards a slow async child mount() against a newer swap / unmount
  var teardownFns = [];

  function normSection(s) { return (s === 'categories') ? 'categories' : 'items'; }

  function on(target, type, fn) {
    if (!target) return;
    target.addEventListener(type, fn);
    teardownFns.push(function () { try { target.removeEventListener(type, fn); } catch (e) {} });
  }

  function markup() {
    return [
      '<div class="menu-workspace">',
      '  <div class="menu-workspace__head">',
      '    <h1 class="menu-workspace__title">Menu</h1>',
      '    <p class="menu-workspace__desc">Manage the items and categories on your public menu.</p>',
      '  </div>',
      '  <div class="menu-tabs" role="tablist" aria-label="Menu section">',
      '    <button type="button" class="menu-tab" data-section="items" role="tab" aria-selected="false">Menu Items</button>',
      '    <button type="button" class="menu-tab" data-section="categories" role="tab" aria-selected="false">Categories</button>',
      '  </div>',
      '  <div class="menu-workspace__body" id="menu-workspace-body"></div>',
      '</div>',
    ].join('\n');
  }

  function syncTabs() {
    if (!tabsEl) return;
    tabsEl.querySelectorAll('.menu-tab[data-section]').forEach(function (b) {
      var isOn = b.dataset.section === activeSection;
      b.classList.toggle('is-active', isOn);
      b.setAttribute('aria-selected', isOn ? 'true' : 'false');
    });
  }

  function childApiFor(section) {
    var def = SECTIONS[section] || SECTIONS.items;
    return (window.AdminViews && window.AdminViews[def.module]) || null;
  }

  function showChildError() {
    if (!bodyEl) return;
    bodyEl.replaceChildren();
    var d = document.createElement('div');
    d.className = 'acard admin-view-error';
    d.textContent = 'This section failed to load. Reload the page to try again.';
    bodyEl.appendChild(d);
  }

  async function mountChild(section) {
    section = normSection(section);
    var api = childApiFor(section);
    activeSection = section;
    activeChild = api;
    syncTabs();
    if (!bodyEl) return;
    bodyEl.replaceChildren();
    if (!api || typeof api.mount !== 'function') { showChildError(); return; }

    var myToken = childToken;
    try {
      await api.mount(ctx, bodyEl);
      if (myToken !== childToken && typeof api.unmount === 'function') {
        try { api.unmount(); } catch (e) {}   // a newer swap / an unmount superseded us
      }
    } catch (e) {
      console.error('[menu-workspace] child mount failed:', section, e);
      if (myToken === childToken) showChildError();
    }
  }

  function unmountChild() {
    var dying = activeChild;
    activeChild = null;
    if (dying && typeof dying.unmount === 'function') {
      try { dying.unmount(); } catch (e) { console.error('[menu-workspace] child unmount error:', e); }
    }
  }

  // ── Public: the shell drives subsection changes ────────────────────
  // The shell has ALREADY cleared its ONE unsaved-changes confirm before
  // calling this — do the mechanical child swap only, never prompt here.
  async function setSection(next) {
    next = normSection(next);
    if (next === activeSection) return;
    childToken++;
    unmountChild();
    await mountChild(next);
  }
  function getSection() { return activeSection; }

  // ── Unsaved-changes contract — delegate to the active child ────────
  function isDirty() {
    if (!activeChild || typeof activeChild.isDirty !== 'function') return false;
    try { return !!activeChild.isDirty(); } catch (e) { return false; }
  }

  function onTabClick(e) {
    var btn = e.target.closest && e.target.closest('button[data-section]');
    if (!btn) return;
    var next = normSection(btn.dataset.section);
    if (next === activeSection) return;
    // Route the switch through the shell's ONE hash pipeline + dirty guard.
    // The shell detects the same-route section change and calls setSection().
    window.location.hash = '#menu&section=' + next;
  }

  async function mount(_ctx, _root) {
    ctx = _ctx;
    root = _root;
    childToken++;
    teardownFns = [];

    root.innerHTML = markup();
    tabsEl = root.querySelector('.menu-tabs');
    bodyEl = root.querySelector('#menu-workspace-body');
    on(tabsEl, 'click', onTabClick);

    await mountChild(normSection(ctx && ctx.menuSection));
  }

  function unmount() {
    childToken++;
    teardownFns.forEach(function (fn) { try { fn(); } catch (e) {} });
    teardownFns = [];
    unmountChild();
    activeSection = null;
    tabsEl = null;
    bodyEl = null;
    ctx = null;
    root = null;
  }

  return {
    mount: mount,
    unmount: unmount,
    isDirty: isDirty,
    setSection: setSection,
    getSection: getSection,
  };
})();
