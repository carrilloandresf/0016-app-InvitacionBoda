import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createExpenses } from '../expenses.mjs';

function setup() {
  const db = new DatabaseSync(':memory:');
  const service = createExpenses(db);
  const call = async (method, pathname, body) => {
    let response;
    const handled = await service.handle(
      { method }, {}, new URL(pathname, 'http://localhost'),
      async () => body,
      (_res, status, data) => { response = { status, data }; }
    );
    assert.equal(handled, true);
    return response;
  };
  return { db, service, call };
}

test('importa exactamente los pagos informados y no los repite', async () => {
  const { db, call } = setup();
  const first = (await call('GET', '/api/admin/expenses')).data;
  assert.deepEqual(first.summary, {
    total: 17126942, paid: 10980000, pending: 6146942, count: 4, percent: 64.1
  });
  assert.deepEqual(first.items.map(row => [row.name, row.paid, row.pending]), [
    ['Fotógrafo', 180000, 180000],
    ['Video', 300000, 250000],
    ['Hotel', 5500000, 4236942],
    ['Anillos', 5000000, 1480000]
  ]);
  const hotel = first.items.find(row => row.name === 'Hotel');
  assert.deepEqual(hotel.payments.map(row => row.amount).sort((a,b) => a-b), [2500000, 3000000]);
  assert.ok(first.items.every(row => row.payments.every(p => p.paidOn === null)));
  createExpenses(db);
  assert.deepEqual((await call('GET', '/api/admin/expenses')).data.summary, first.summary);
  db.close();
});

test('agrega conceptos, abona y bloquea sobrepagos', async () => {
  const { db, call } = setup();
  const added = await call('POST', '/api/admin/expenses', { name: '  Música  ', total: 800000 });
  assert.equal(added.status, 201);
  const music = added.data.items.find(row => row.name === 'Música');
  assert.ok(music);
  const base = '/api/admin/expenses/' + music.id;
  const payment = await call('POST', base + '/payments', { amount: 200000, paidOn: '2026-11-05', note: 'Anticipo' });
  assert.equal(payment.data.items.find(row => row.id === music.id).pending, 600000);
  await assert.rejects(
    call('POST', base + '/payments', { amount: 600001, paidOn: null, note: '' }),
    /supera el saldo pendiente/
  );
  assert.equal((await call('GET', '/api/admin/expenses')).data.items.find(row => row.id === music.id).paid, 200000);
  db.close();
});

test('corregir y anular pagos conserva los movimientos anteriores', async () => {
  const { db, call } = setup();
  const music = (await call('POST', '/api/admin/expenses', { name: 'Decoración', total: 500000 })).data.items.at(-1);
  const base = '/api/admin/expenses/' + music.id;
  const initial = (await call('POST', base + '/payments', { amount: 100000, paidOn: null, note: '' })).data.items.at(-1);
  const paymentId = initial.payments[0].id;
  const corrected = (await call('PUT', base + '/payments/' + paymentId, { amount: 120000, paidOn: '2026-11-06', note: 'Ajuste' })).data.items.at(-1);
  assert.equal(corrected.paid, 120000);
  assert.equal(corrected.payments.length, 2);
  assert.ok(corrected.payments.some(row => row.id === paymentId && row.voided));
  const active = corrected.payments.find(row => !row.voided);
  const voided = (await call('DELETE', base + '/payments/' + active.id)).data.items.at(-1);
  assert.equal(voided.paid, 0);
  assert.equal(voided.pending, 500000);
  assert.equal(voided.payments.filter(row => row.voided).length, 2);
  await assert.rejects(call('DELETE', base), /historial de pagos/);
  db.close();
});
