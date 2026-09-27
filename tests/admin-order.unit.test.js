// Catalog ordering helpers (milestone 1U) — zero-dependency unit tests.
//
//   node --test tests/admin-order.unit.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'admin/js/sortable.js'), 'utf8');
function load() {
  const window = { innerHeight: 800 };
  vm.runInNewContext(SRC, { window, console });
  return window.AdminSortable;
}
const S0 = load();
// Results cross the VM realm boundary — normalize to plain JSON before deepEqual.
const J = (v) => JSON.parse(JSON.stringify(v));
const S = {
  sortRows: (r) => J(S0.sortRows(r)), nextOrder: S0.nextOrder, plan: (r) => J(S0.plan(r)),
  persist: async (...a) => J(await S0.persist(...a)),
};

test('compare: sort_order ASC, NULL/legacy last, then created_at, then id', () => {
  const rows = [
    { id: 'n', sort_order: null, created_at: '2026-01-01' },
    { id: 'b', sort_order: 2, created_at: '2026-01-03' },
    { id: 'a', sort_order: 2, created_at: '2026-01-02' },
    { id: 'z', sort_order: 0, created_at: '2026-01-09' },
    { id: 'y', sort_order: 1, created_at: '2026-01-01' },
    { id: 'x', sort_order: 1, created_at: '2026-01-01' },
  ];
  assert.deepEqual(S.sortRows(rows).map((r) => r.id), ['z', 'x', 'y', 'a', 'b', 'n']);
  assert.deepEqual(rows.map((r) => r.id), ['n', 'b', 'a', 'z', 'y', 'x'], 'input not mutated');
});

test('nextOrder appends after the current max (ties, gaps, NULLs, empty)', () => {
  assert.equal(S.nextOrder([]), 0);
  assert.equal(S.nextOrder([{ sort_order: 0 }, { sort_order: 0 }]), 1);
  assert.equal(S.nextOrder([{ sort_order: 3 }, { sort_order: 9 }, { sort_order: null }]), 10);
  assert.equal(S.nextOrder([{ sort_order: null }]), 0);
});

test('plan renumbers the ordered group 0..n-1 and only lists changed rows', () => {
  const ordered = [{ id: 'c', sort_order: 2 }, { id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }];
  assert.deepEqual(S.plan(ordered), [
    { id: 'c', from: 2, to: 0 }, { id: 'a', from: 0, to: 1 }, { id: 'b', from: 1, to: 2 },
  ]);
  assert.deepEqual(S.plan([{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }]), []);
  assert.deepEqual(S.plan([{ id: 'a', sort_order: null }]), [{ id: 'a', from: null, to: 0 }]);
});

function fakeDb(failIds) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        update(p) {
          return {
            eq(k, id) {
              calls.push({ table, id, sort_order: p.sort_order });
              const fail = failIds.includes(id) && calls.filter((c) => c.id === id).length === 1;
              return Promise.resolve({ error: fail ? { message: 'boom' } : null });
            },
          };
        },
      };
    },
  };
}

test('persist writes one update per change; no-op plan writes nothing', async () => {
  const db = fakeDb([]);
  assert.deepEqual(await S.persist(db, 'products', []), { ok: true });
  assert.equal(db.calls.length, 0);
  const r = await S.persist(db, 'products', [{ id: 'a', from: 0, to: 1 }, { id: 'b', from: 1, to: 0 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(db.calls, [
    { table: 'products', id: 'a', sort_order: 1 }, { table: 'products', id: 'b', sort_order: 0 },
  ]);
});

test('persist failure rolls back the writes that DID land', async () => {
  const db = fakeDb(['b']);
  const r = await S.persist(db, 'categories', [{ id: 'a', from: 0, to: 1 }, { id: 'b', from: 1, to: 0 }]);
  assert.equal(r.ok, false);
  // a: 0→1 landed, then rolled back to 0. b failed and is not retried.
  assert.deepEqual(db.calls.map((c) => c.id + ':' + c.sort_order), ['a:1', 'b:0', 'a:0']);
});
