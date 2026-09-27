// =================================================================
//  Admin — drag-to-reorder + order persistence helpers  (milestone 1U)
//
//  Tiny, dependency-free. Pointer Events cover mouse, touch and pen with one
//  code path; the drag handle carries `touch-action: none` (admin.css) so a
//  touch drag never scrolls the page instead. Keyboard users get ArrowUp /
//  ArrowDown on the focused handle; every view also keeps visible ↑ / ↓
//  buttons as the non-drag fallback.
//
//  A drag only ever re-positions an item among siblings of the SAME group
//  (e.g. products of one category) — it can never move an item into another
//  group. Nothing is persisted while dragging: the caller gets ONE onDrop()
//  with the final order when the pointer is released.
//
//  Order model: rows carry an integer `sort_order`; the canonical comparator
//  is sort_order ASC (null/legacy last) → created_at ASC → id ASC, so ties and
//  legacy rows still render deterministically. A reorder renumbers the ONE
//  affected group 0..n-1 and writes only the rows whose value changed.
// =================================================================

window.AdminSortable = (function () {
  'use strict';

  // ── Ordering ────────────────────────────────────────────────────
  function num(v) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return isFinite(n) ? n : Infinity;       // null / legacy → last
  }
  function compare(a, b) {
    var d = num(a && a.sort_order) - num(b && b.sort_order);
    if (d) return d;
    var ca = String((a && a.created_at) || ''), cb = String((b && b.created_at) || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    var ia = String((a && a.id) || ''), ib = String((b && b.id) || '');
    return ia < ib ? -1 : (ia > ib ? 1 : 0);
  }
  function sortRows(rows) { return (rows || []).slice().sort(compare); }

  // Next sort_order at the END of a group (max + 1; 0 for an empty group).
  function nextOrder(rows) {
    var max = -1;
    (rows || []).forEach(function (r) {
      var n = num(r && r.sort_order);
      if (n !== Infinity && n > max) max = n;
    });
    return max + 1;
  }

  // Renumber an ordered group 0..n-1 → only the rows whose value changes.
  function plan(orderedRows) {
    return orderedRows
      .map(function (r, i) { return { id: r.id, from: r.sort_order, to: i }; })
      .filter(function (c) { return c.from !== c.to; });
  }

  // Persist a plan with one UPDATE per changed row (in parallel). If any write
  // fails, the rows that DID succeed are written back to their previous value
  // (best effort), so the database never keeps a half-applied order.
  async function persist(db, table, changes) {
    if (!changes.length) return { ok: true };
    var results = await Promise.all(changes.map(function (c) {
      return Promise.resolve(db.from(table).update({ sort_order: c.to }).eq('id', c.id))
        .then(function (r) { return { c: c, error: r && r.error }; },
              function (e) { return { c: c, error: e || new Error('update failed') }; });
    }));
    var failed = results.filter(function (r) { return r.error; });
    if (!failed.length) return { ok: true };
    var landed = results.filter(function (r) { return !r.error; });
    await Promise.all(landed.map(function (r) {
      return Promise.resolve(db.from(table).update({ sort_order: r.c.from == null ? null : r.c.from }).eq('id', r.c.id))
        .catch(function () {});
    }));
    return { ok: false, error: failed[0].error };
  }

  // ── Drag interaction ───────────────────────────────────────────
  //  opts: {
  //    item:     selector of a sortable element (direct children of container)
  //    handle:   selector of the drag handle inside an item
  //    id:       function (itemEl) → id string
  //    group:    function (itemEl) → group key (drag never leaves its group)
  //    disabled: function () → true to refuse starting a drag
  //    onDrop:   function (groupKey, orderedIds, movedId) — only if changed
  //    onKey:    function (itemEl, dir)  — ArrowUp (-1) / ArrowDown (+1) on a handle
  //  }
  function attach(container, opts) {
    var drag = null;
    var EDGE = 56, STEP = 14;

    function siblingsOf(el) {
      var key = opts.group(el);
      return Array.prototype.filter.call(container.querySelectorAll(opts.item), function (n) {
        return opts.group(n) === key;
      });
    }
    function ids(list) { return list.map(opts.id); }

    function onDown(e) {
      var h = e.target.closest && e.target.closest(opts.handle);
      if (!h || !container.contains(h)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (h.disabled || (opts.disabled && opts.disabled())) return;
      var el = h.closest(opts.item);
      if (!el) return;
      var sibs = siblingsOf(el);
      if (sibs.length < 2) return;
      e.preventDefault();
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      drag = { el: el, handle: h, pointerId: e.pointerId, group: opts.group(el), before: ids(sibs), y: e.clientY, raf: 0 };
      el.classList.add('is-dragging');
      container.classList.add('is-sorting');
    }

    function place(y) {
      var sibs = siblingsOf(drag.el);
      var others = sibs.filter(function (n) { return n !== drag.el; });
      var target = null;
      for (var i = 0; i < others.length; i++) {
        var r = others[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { target = others[i]; break; }
      }
      if (target) {
        if (drag.el.nextElementSibling !== target) target.parentNode.insertBefore(drag.el, target);
      } else {
        var last = others[others.length - 1];
        if (last && last.nextElementSibling !== drag.el) last.parentNode.insertBefore(drag.el, last.nextSibling);
      }
    }

    function autoScroll() {
      if (!drag) return;
      var y = drag.y, dy = 0;
      if (y < EDGE) dy = -STEP; else if (y > window.innerHeight - EDGE) dy = STEP;
      if (dy) { window.scrollBy(0, dy); place(y); }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function onMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      drag.y = e.clientY;
      place(e.clientY);
      if (!drag.raf) drag.raf = requestAnimationFrame(autoScroll);
    }

    function finish(e, cancelled) {
      if (!drag || (e && e.pointerId !== drag.pointerId)) return;
      var d = drag;
      drag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      try { d.handle.releasePointerCapture(d.pointerId); } catch (err) {}
      d.el.classList.remove('is-dragging');
      container.classList.remove('is-sorting');
      var sibs = siblingsOf(d.el);
      var after = ids(sibs);
      if (cancelled) {
        // Put the DOM back exactly as it was.
        var byId = {};
        sibs.forEach(function (n) { byId[opts.id(n)] = n; });
        var anchor = sibs[sibs.length - 1].nextSibling, parent = sibs[0].parentNode;
        d.before.forEach(function (id) { parent.insertBefore(byId[id], anchor); });
        return;
      }
      if (after.join('\u0000') !== d.before.join('\u0000')) opts.onDrop(d.group, after, opts.id(d.el));
    }

    function onKey(e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      var h = e.target.closest && e.target.closest(opts.handle);
      if (!h || !container.contains(h) || h.disabled) return;
      e.preventDefault();
      if (opts.onKey) opts.onKey(h.closest(opts.item), e.key === 'ArrowUp' ? -1 : 1);
    }

    var up = function (e) { finish(e, false); };
    var cancel = function (e) { finish(e, true); };
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', cancel);
    container.addEventListener('keydown', onKey);
    return function detach() {
      if (drag) finish({ pointerId: drag.pointerId }, true);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', up);
      container.removeEventListener('pointercancel', cancel);
      container.removeEventListener('keydown', onKey);
    };
  }

  return { compare: compare, sortRows: sortRows, nextOrder: nextOrder, plan: plan, persist: persist, attach: attach };
})();
