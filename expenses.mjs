// Control de gastos de la boda: importes enteros COP y registro auditable de abonos.
const SEED = 'gastos-iniciales-2026-11-05';
const CAP = 1_000_000_000_000;
const error = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const amount = (v) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > CAP) error('Indica un valor válido en pesos, sin decimales.'); return v; };
const name = (v) => { if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 100) error('El concepto debe tener entre 2 y 100 caracteres.'); return v.trim().replace(/\s+/g, ' '); };
const note = (v) => { if (v == null) return ''; if (typeof v !== 'string' || v.trim().length > 250) error('La nota no puede superar 250 caracteres.'); return v.trim(); };
const date = (v) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) error('Fecha inválida.');
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) error('Fecha inválida.');
  return v;
};
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function createExpenses(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS expense_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, total INTEGER NOT NULL CHECK(total > 0), position INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);' +
    "CREATE TABLE IF NOT EXISTS expense_payments (id INTEGER PRIMARY KEY, expense_id INTEGER NOT NULL REFERENCES expense_items(id) ON DELETE RESTRICT, amount INTEGER NOT NULL CHECK(amount > 0), paid_on TEXT, note TEXT NOT NULL DEFAULT '', voided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);" +
    'CREATE INDEX IF NOT EXISTS expense_payments_expense_idx ON expense_payments(expense_id);' +
    'CREATE TABLE IF NOT EXISTS expense_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);'
  );
  tx(db, () => {
    if (db.prepare('SELECT key FROM expense_meta WHERE key = ?').get(SEED)) return;
    const seed = [
      ['Fotógrafo', 360000, [180000]],
      ['Video', 550000, [300000]],
      ['Hotel', 9736942, [2500000, 3000000]],
      ['Anillos', 6480000, [5000000]]
    ];
    const addItem = db.prepare('INSERT INTO expense_items(name, total, position) VALUES(?, ?, ?)');
    const addPay = db.prepare('INSERT INTO expense_payments(expense_id, amount, paid_on, note) VALUES(?, ?, NULL, ?)');
    seed.forEach(([label, total, payments], position) => {
      const id = Number(addItem.run(label, total, position).lastInsertRowid);
      payments.forEach(value => addPay.run(id, value, 'Pago inicial: fecha no informada'));
    });
    db.prepare('INSERT INTO expense_meta(key, value) VALUES(?, ?)').run(SEED, '1');
  });
  const item = id => {
    const row = db.prepare('SELECT id, name, total FROM expense_items WHERE id = ?').get(id);
    if (!row) error('El gasto no existe.', 404);
    return row;
  };
  const paid = (id, exclude = -1) => Number(db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expense_payments WHERE expense_id = ? AND id != ? AND voided_at IS NULL').get(id, exclude).total);
  function snapshot() {
    const items = db.prepare('SELECT id, name, total, created_at AS createdAt FROM expense_items ORDER BY position, id').all().map(row => ({
      ...row, total: Number(row.total), paid: 0, pending: Number(row.total), payments: []
    }));
    const map = new Map(items.map(row => [row.id, row]));
    const payments = db.prepare('SELECT id, expense_id AS expenseId, amount, paid_on AS paidOn, note, voided_at AS voidedAt, created_at AS createdAt FROM expense_payments ORDER BY id DESC').all();
    for (const row of payments) {
      const entry = map.get(row.expenseId);
      if (!entry) continue;
      const payment = { ...row, amount: Number(row.amount), voided: row.voidedAt !== null };
      entry.payments.push(payment);
      if (!payment.voided) entry.paid += payment.amount;
    }
    const summary = { total: 0, paid: 0, pending: 0, count: items.length, percent: 0 };
    for (const row of items) {
      row.pending = row.total - row.paid;
      summary.total += row.total;
      summary.paid += row.paid;
      summary.pending += row.pending;
    }
    if (summary.total) summary.percent = Math.round(summary.paid / summary.total * 1000) / 10;
    return { items, summary };
  }
  async function handle(req, res, url, readJson, sendJson) {
    const path = url.pathname;
    if (path !== '/api/admin/expenses' && !path.startsWith('/api/admin/expenses/')) return false;
    const respond = (status = 200) => sendJson(res, status, snapshot());
    if (path === '/api/admin/expenses') {
      if (req.method === 'GET') respond();
      else if (req.method === 'POST') {
        const body = (await readJson(req)) || {};
        const label = name(body.name), total = amount(body.total);
        tx(db, () => {
          const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM expense_items').get().p;
          db.prepare('INSERT INTO expense_items(name, total, position) VALUES(?, ?, ?)').run(label, total, position);
        });
        respond(201);
      } else sendJson(res, 405, { error: 'Método no permitido.' });
      return true;
    }
    const expenseMatch = /^\/api\/admin\/expenses\/([1-9]\d*)$/.exec(path);
    if (expenseMatch) {
      const id = Number(expenseMatch[1]);
      if (req.method === 'PUT') {
        const body = (await readJson(req)) || {};
        const label = name(body.name), total = amount(body.total);
        tx(db, () => {
          item(id);
          if (total < paid(id)) error('El presupuesto no puede ser inferior al dinero abonado.');
          db.prepare('UPDATE expense_items SET name = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(label, total, id);
        });
        respond();
      } else if (req.method === 'DELETE') {
        tx(db, () => {
          item(id);
          if (db.prepare('SELECT id FROM expense_payments WHERE expense_id = ? LIMIT 1').get(id)) error('No puedes eliminar un gasto con historial de pagos.');
          db.prepare('DELETE FROM expense_items WHERE id = ?').run(id);
        });
        respond();
      } else sendJson(res, 405, { error: 'Método no permitido.' });
      return true;
    }
    const addMatch = /^\/api\/admin\/expenses\/([1-9]\d*)\/payments$/.exec(path);
    if (addMatch) {
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Método no permitido.' }); return true; }
      const id = Number(addMatch[1]);
      const body = (await readJson(req)) || {};
      const value = amount(body.amount), paidOn = date(body.paidOn), detail = note(body.note);
      tx(db, () => {
        const expense = item(id);
        if (value > expense.total - paid(id)) error('El abono supera el saldo pendiente.');
        db.prepare('INSERT INTO expense_payments(expense_id, amount, paid_on, note) VALUES(?, ?, ?, ?)').run(id, value, paidOn, detail);
      });
      respond(201);
      return true;
    }
    const payMatch = /^\/api\/admin\/expenses\/([1-9]\d*)\/payments\/([1-9]\d*)$/.exec(path);
    if (payMatch) {
      const id = Number(payMatch[1]), pid = Number(payMatch[2]);
      if (req.method === 'PUT') {
        const body = (await readJson(req)) || {};
        const value = amount(body.amount), paidOn = date(body.paidOn), detail = note(body.note);
        tx(db, () => {
          const expense = item(id);
          if (!db.prepare('SELECT id FROM expense_payments WHERE id = ? AND expense_id = ? AND voided_at IS NULL').get(pid, id)) error('No se encontró el pago vigente.', 404);
          if (value > expense.total - paid(id, pid)) error('El valor supera el saldo disponible.');
          db.prepare('UPDATE expense_payments SET amount = ?, paid_on = ?, note = ? WHERE id = ? AND expense_id = ?').run(value, paidOn, detail, pid, id);
        });
        respond();
      } else if (req.method === 'DELETE') {
        tx(db, () => {
          item(id);
          const changed = db.prepare('UPDATE expense_payments SET voided_at = CURRENT_TIMESTAMP WHERE id = ? AND expense_id = ? AND voided_at IS NULL').run(pid, id);
          if (!changed.changes) error('No se encontró el pago vigente.', 404);
        });
        respond();
      } else sendJson(res, 405, { error: 'Método no permitido.' });
      return true;
    }
    sendJson(res, 404, { error: 'Ruta no encontrada.' });
    return true;
  }
  return { handle };
}
