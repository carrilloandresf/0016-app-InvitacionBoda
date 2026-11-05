const $ = selector => document.querySelector(selector);
const formatCop = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let state = { items: [], summary: { total: 0, paid: 0, pending: 0, percent: 0, count: 0 } };
let selectedId = null;
let toastTimer = null;

function toast(message) {
  const node = $('#finance-toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo guardar el cambio.');
  return body;
}

function update(data) {
  state = data;
  if (!state.items.some(item => item.id === selectedId)) selectedId = state.items[0]?.id ?? null;
  render();
}

function itemById(id) {
  return state.items.find(item => item.id === Number(id));
}

function progress(item) {
  return item.total ? Math.max(0, Math.min(100, item.paid / item.total * 100)) : 0;
}

function card(item) {
  const pct = progress(item);
  const paid = item.pending === 0;
  const action = paid ? 'Pagado' : 'Pendiente';
  const canRemove = item.payments.length === 0;
  return '<article class="expense-card' + (item.id === selectedId ? ' selected' : '') + '">' +
    '<div class="expense-card-top"><h3>' + escapeHtml(item.name) + '</h3><span class="expense-tag' + (paid ? ' paid' : '') + '">' + action + '</span></div>' +
    '<div class="expense-values"><div><span>Abonado</span><strong>' + formatCop(item.paid) + '</strong></div>' +
    '<div><span>Por pagar</span><strong class="owed">' + formatCop(item.pending) + '</strong></div></div>' +
    '<div class="expense-track" role="progressbar" aria-label="Progreso de ' + escapeHtml(item.name) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><span style="width:' + pct + '%"></span></div>' +
    '<div class="expense-card-footer"><span>Presupuesto: ' + formatCop(item.total) + '</span><span>' + pct.toFixed(1).replace('.', ',') + '% pagado</span></div>' +
    '<div class="expense-actions">' +
      '<button class="button button-primary" data-action="pay" data-id="' + item.id + '"' + (paid ? ' disabled' : '') + '>+ Abonar</button>' +
      '<button class="button button-ghost" data-action="history" data-id="' + item.id + '">Movimientos (' + item.payments.length + ')</button>' +
      '<button class="button button-ghost" data-action="edit" data-id="' + item.id + '">Editar</button>' +
      (canRemove ? '<button class="button button-ghost" data-action="remove" data-id="' + item.id + '">Eliminar</button>' : '') +
    '</div></article>';
}

function prettyDate(value) {
  if (!value) return 'Fecha no informada';
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? 'Fecha no informada' : new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

function paymentRow(payment, expense) {
  const status = payment.voided ? ' · Anulado' : '';
  const label = payment.note ? ' · ' + escapeHtml(payment.note) : '';
  const buttons = payment.voided
    ? '<span class="history-voided">Movimiento anulado</span>'
    : '<button class="button button-ghost" data-action="edit-payment" data-id="' + expense.id + '" data-payment-id="' + payment.id + '">Editar</button>' +
      '<button class="button button-ghost" data-action="void-payment" data-id="' + expense.id + '" data-payment-id="' + payment.id + '">Anular</button>';
  return '<article class="history-row' + (payment.voided ? ' voided' : '') + '">' +
    '<div class="history-row-main"><strong>' + formatCop(payment.amount) + '</strong>' +
      '<div class="history-meta">' + prettyDate(payment.paidOn) + label + status + '</div></div>' +
    '<div class="history-actions">' + buttons + '</div></article>';
}

function renderHistory() {
  const item = itemById(selectedId);
  const section = $('#history-section');
  section.hidden = !item;
  if (!item) return;
  $('#history-title').textContent = 'Movimientos · ' + item.name;
  $('#history-subtitle').textContent = formatCop(item.paid) + ' abonados de ' + formatCop(item.total) + ' · ' + formatCop(item.pending) + ' pendientes';
  $('#history-add').disabled = item.pending <= 0;
  $('#history-list').innerHTML = item.payments.length
    ? item.payments.map(payment => paymentRow(payment, item)).join('')
    : '<div class="finance-message">Todavía no hay abonos para este gasto.</div>';
}

function render() {
  $('#total-budget').textContent = formatCop(state.summary.total);
  $('#total-paid').textContent = formatCop(state.summary.paid);
  $('#total-pending').textContent = formatCop(state.summary.pending);
  $('#total-percent').textContent = state.summary.percent.toFixed(1).replace('.', ',') + '%';
  $('#total-progress-fill').style.width = Math.max(0, Math.min(100, state.summary.percent)) + '%';
  $('#total-progress').setAttribute('aria-valuenow', String(state.summary.percent));
  $('#finance-count').textContent = state.summary.count + ' conceptos registrados · ' +
    state.items.filter(item => item.pending === 0).length + ' totalmente pagados';
  const term = $('#expense-search').value.toLocaleLowerCase('es').trim();
  const rows = state.items.filter(item => item.name.toLocaleLowerCase('es').includes(term));
  $('#finance-loading').hidden = true;
  $('#finance-empty').hidden = rows.length > 0;
  $('#expense-grid').hidden = rows.length === 0;
  $('#expense-grid').innerHTML = rows.map(card).join('');
  renderHistory();
}

function openExpense(item = null) {
  $('#expense-form').reset();
  $('#expense-form-error').hidden = true;
  $('#expense-id').value = item?.id || '';
  $('#expense-name').value = item?.name || '';
  $('#expense-total').value = item?.total || '';
  $('#expense-dialog-title').textContent = item ? 'Editar presupuesto' : 'Nuevo gasto';
  $('#expense-submit').textContent = item ? 'Guardar cambios' : 'Crear gasto';
  $('#expense-dialog').showModal();
  $('#expense-name').focus();
}

function localToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function openPayment(expense, payment = null) {
  if (!expense || (!payment && expense.pending <= 0)) return;
  $('#payment-form').reset();
  $('#payment-form-error').hidden = true;
  $('#payment-expense-id').value = expense.id;
  $('#payment-id').value = payment?.id || '';
  $('#payment-dialog-title').textContent = payment ? 'Editar abono' : 'Registrar abono';
  $('#payment-context').textContent = expense.name + ' · Saldo disponible: ' + formatCop(expense.pending + (payment?.amount || 0));
  $('#payment-amount').value = payment?.amount || '';
  $('#payment-amount').max = expense.pending + (payment?.amount || 0);
  $('#payment-date').value = payment ? payment.paidOn || '' : localToday();
  $('#payment-note').value = payment?.note || '';
  $('#payment-submit').textContent = payment ? 'Actualizar abono' : 'Guardar abono';
  $('#payment-dialog').showModal();
  $('#payment-amount').focus();
}

async function saveForm(form, button, errorNode, requestFn, successMessage) {
  button.disabled = true;
  errorNode.hidden = true;
  try {
    const result = await requestFn();
    form.closest('dialog').close();
    update(result);
    toast(successMessage);
  } catch (e) {
    errorNode.textContent = e.message;
    errorNode.hidden = false;
  } finally {
    button.disabled = false;
  }
}

$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#expense-id').value;
  const payload = { name: $('#expense-name').value.trim(), total: Number($('#expense-total').value) };
  await saveForm($('#expense-form'), $('#expense-submit'), $('#expense-form-error'), async () => {
    const result = await api(id ? '/api/admin/expenses/' + id : '/api/admin/expenses', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    if (!id) selectedId = result.items[result.items.length - 1]?.id ?? selectedId;
    return result;
  }, id ? 'Presupuesto actualizado.' : 'Gasto agregado.');
});

$('#payment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const expenseId = $('#payment-expense-id').value, paymentId = $('#payment-id').value;
  const payload = {
    amount: Number($('#payment-amount').value),
    paidOn: $('#payment-date').value || null,
    note: $('#payment-note').value.trim()
  };
  await saveForm($('#payment-form'), $('#payment-submit'), $('#payment-form-error'), () =>
    api('/api/admin/expenses/' + expenseId + '/payments' + (paymentId ? '/' + paymentId : ''), {
      method: paymentId ? 'PUT' : 'POST', body: JSON.stringify(payload)
    }), paymentId ? 'Abono actualizado.' : 'Abono registrado.');
});

async function removeExpense(item) {
  if (!confirm('¿Eliminar el gasto "' + item.name + '"? Esta acción no se puede deshacer.')) return;
  try { update(await api('/api/admin/expenses/' + item.id, { method: 'DELETE' })); toast('Gasto eliminado.'); }
  catch (e) { toast(e.message); }
}

async function voidPayment(item, payment) {
  if (!confirm('¿Anular el abono de ' + formatCop(payment.amount) + ' para "' + item.name + '"? Quedará visible en el historial como anulado.')) return;
  try {
    update(await api('/api/admin/expenses/' + item.id + '/payments/' + payment.id, { method: 'DELETE' }));
    toast('Abono anulado. El saldo pendiente fue recalculado.');
  } catch (e) { toast(e.message); }
}

function handleAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = itemById(button.dataset.id);
  if (!item) return;
  const action = button.dataset.action;
  if (action === 'pay') openPayment(item);
  if (action === 'edit') openExpense(item);
  if (action === 'history') { selectedId = item.id; render(); $('#history-section').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (action === 'remove') void removeExpense(item);
  if (action === 'edit-payment' || action === 'void-payment') {
    const payment = item.payments.find(row => row.id === Number(button.dataset.paymentId));
    if (!payment || payment.voided) return;
    if (action === 'edit-payment') openPayment(item, payment);
    else void voidPayment(item, payment);
  }
}
$('#expense-grid').addEventListener('click', handleAction);
$('#history-list').addEventListener('click', handleAction);
$('#expense-search').addEventListener('input', render);
$('#new-expense').addEventListener('click', () => openExpense());
$('#history-add').addEventListener('click', () => openPayment(itemById(selectedId)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
$('#export-csv').addEventListener('click', () => {
  const rows = [['Concepto', 'Presupuesto COP', 'Total abonado COP', 'Pendiente COP', 'Valor del abono COP', 'Fecha', 'Detalle', 'Estado']];
  state.items.forEach(item => {
    const payments = item.payments.length ? item.payments : [null];
    payments.forEach(payment => rows.push([
      item.name, item.total, item.paid, item.pending, payment?.amount || '',
      payment?.paidOn || '', payment?.note || '', payment ? (payment.voided ? 'Anulado' : 'Vigente') : ''
    ]));
  });
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gastos-boda-felipe-sarita.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

api('/api/admin/expenses').then(update).catch(e => {
  $('#finance-loading').textContent = 'No se pudo cargar la información: ' + e.message;
  toast(e.message);
});
