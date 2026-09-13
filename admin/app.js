const state = {
  invitations: [],
  summary: null,
  filter: '',
  settings: { receptionVisibility: 'auto', rsvpLockEnabled: true }
};

const elements = {
  list: document.querySelector('#invitation-list'),
  loading: document.querySelector('#loading'),
  empty: document.querySelector('#empty'),
  search: document.querySelector('#search'),
  dialog: document.querySelector('#invitation-dialog'),
  form: document.querySelector('#invitation-form'),
  formError: document.querySelector('#form-error'),
  familyName: document.querySelector('#family-name'),
  invitationId: document.querySelector('#invitation-id'),
  specialLodging: document.querySelector('#special-lodging'),
  guestFields: document.querySelector('#guest-fields'),
  dialogTitle: document.querySelector('#dialog-title'),
  saveButton: document.querySelector('#save-invitation'),
  toast: document.querySelector('#toast'),
  receptionVisibility: document.querySelector('#reception-visibility'),
  rsvpLock: document.querySelector('#rsvp-lock')
};

const labels = {
  meals: { p1: 'Murillo estofado', p2: 'Churrasco de pollo' },
  drinks: { b1: 'Soda de tamarindo y limonaria', b2: 'Soda de arándanos y moras' },
  guestTypes: { adult: 'Adulto', youth: 'Joven', child: 'Niño' }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'No fue posible completar la solicitud.');
  return data;
}

function setStat(id, value) {
  document.querySelector(id).textContent = String(value ?? 0);
}

function renderSummary() {
  const summary = state.summary || {};
  setStat('#stat-invitations', summary.invitations);
  setStat('#stat-attending', summary.attending);
  setStat('#stat-declined', summary.declined);
  setStat('#stat-pending', summary.pending);
  setStat('#stat-lodging', summary.lodging);
  setStat('#stat-p1', summary.meals?.p1);
  setStat('#stat-p2', summary.meals?.p2);
  setStat('#stat-child-menu', summary.meals?.child);
  setStat('#stat-liquor-yes', summary.liquor?.yes);
  setStat('#stat-liquor-no', summary.liquor?.no);
  setStat('#stat-b1', summary.drinks?.b1);
  setStat('#stat-b2', summary.drinks?.b2);
  setStat('#stat-cake', summary.cake);
}

function renderSettings() {
  const { receptionVisibility, rsvpLockEnabled } = state.settings;
  elements.receptionVisibility.querySelectorAll('.segmented-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === receptionVisibility);
  });
  elements.rsvpLock.checked = rsvpLockEnabled;
}

async function loadSettings() {
  try {
    state.settings = await request('/api/admin/settings');
    renderSettings();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateSettings(patch) {
  const previous = state.settings;
  state.settings = { ...state.settings, ...patch };
  renderSettings();
  try {
    state.settings = await request('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(patch)
    });
    renderSettings();
    showToast('Configuración actualizada.');
  } catch (error) {
    state.settings = previous;
    renderSettings();
    showToast(error.message);
  }
}

function invitationUrl(invitation) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('i', invitation.token);
  url.searchParams.set('v', '2');
  return url.toString();
}

function formatDate(value) {
  if (!value) return '';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

function guestAnswer(guest) {
  if (guest.attendance === 'yes') return ['Asistirá', 'answer-yes'];
  if (guest.attendance === 'no') return ['No asistirá', 'answer-no'];
  return ['Pendiente', 'answer-pending'];
}

function renderCard(invitation) {
  const url = invitationUrl(invitation);
  const answered = invitation.guests.filter((guest) => guest.attendance !== null).length;
  const rows = invitation.guests.map((guest) => {
    const [answer, answerClass] = guestAnswer(guest);
    const menu = guest.attendance === 'yes'
      ? (guest.guestType === 'child' ? 'Menú infantil' : (labels.meals[guest.meal] || 'Pendiente'))
      : '—';
    const drink = guest.attendance === 'yes' ? (labels.drinks[guest.drink] || 'Pendiente') : '—';
    const liquor = guest.attendance === 'yes' ? (guest.guestType === 'adult' ? 'Sí' : 'No') : '—';
    const cake = guest.attendance === 'yes' ? (guest.cake ? 'Sí' : 'No') : '—';
    return `
      <tr>
        <td>${escapeHtml(guest.name)}</td>
        <td data-label="Categoría">${escapeHtml(labels.guestTypes[guest.guestType] || 'Adulto')}</td>
        <td data-label="Asistencia" class="${answerClass}">${answer}</td>
        <td data-label="Plato">${escapeHtml(menu)}</td>
        <td data-label="Bebida">${escapeHtml(drink)}</td>
        <td data-label="Licor">${liquor}</td>
        <td data-label="Torta">${cake}</td>
      </tr>`;
  }).join('');

  return `
    <article class="invitation-card" data-id="${invitation.id}">
      <div class="invitation-head">
        <div>
          <div class="invitation-title">
            <h3>${escapeHtml(invitation.familyName)}</h3>
            <span class="status ${invitation.responded ? 'status-done' : 'status-pending'}">
              ${invitation.responded ? 'Confirmada' : 'Pendiente'}
            </span>
            ${invitation.lodgingInterest ? '<span class="status lodging-badge">Hospedaje</span>' : ''}
          </div>
          <p class="invitation-meta">
            ${answered} de ${invitation.guests.length} respuestas
            ${invitation.respondedAt ? ` · Actualizada ${escapeHtml(formatDate(invitation.respondedAt))}` : ''}
          </p>
        </div>
        <div class="card-actions">
          <button class="button button-ghost" type="button" data-action="copy">Copiar enlace</button>
          <a class="button button-ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir</a>
          <button class="button button-ghost" type="button" data-action="edit">Editar</button>
          <button class="button button-ghost danger" type="button" data-action="delete">Eliminar</button>
        </div>
      </div>
      <table class="guest-table">
        <thead><tr><th>Invitado</th><th>Categoría</th><th>Asistencia</th><th>Plato</th><th>Bebida</th><th>Licor</th><th>Torta</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="link-row"><span>${escapeHtml(url)}</span></div>
    </article>`;
}

function renderList() {
  const query = state.filter.trim().toLocaleLowerCase('es');
  const filtered = !query ? state.invitations : state.invitations.filter((invitation) =>
    invitation.familyName.toLocaleLowerCase('es').includes(query) ||
    invitation.guests.some((guest) => guest.name.toLocaleLowerCase('es').includes(query))
  );

  elements.loading.hidden = true;
  elements.empty.hidden = state.invitations.length !== 0;
  elements.list.innerHTML = filtered.map(renderCard).join('');
  if (query && !filtered.length) {
    elements.list.innerHTML = '<div class="state-card">No hay resultados para esta búsqueda.</div>';
  }
}

async function load() {
  const refreshButton = document.querySelector('#refresh');
  refreshButton.disabled = true;
  try {
    const data = await request('/api/admin/invitations');
    state.invitations = data.invitations;
    state.summary = data.summary;
    renderSummary();
    renderList();
  } catch (error) {
    elements.loading.textContent = error.message;
    showToast(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

function addGuestField(guest = {}) {
  const row = document.createElement('div');
  row.className = 'guest-row';
  if (guest.id) row.dataset.guestId = String(guest.id);

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 120;
  input.placeholder = 'Nombre completo';
  input.required = true;
  input.value = guest.name || '';
  input.setAttribute('aria-label', 'Nombre del invitado');

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Categoría del invitado');
  [
    ['adult', 'Adulto'],
    ['youth', 'Joven'],
    ['child', 'Niño']
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
  select.value = guest.guestType || 'adult';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-guest';
  remove.setAttribute('aria-label', 'Quitar invitado');
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    if (elements.guestFields.children.length === 1) {
      input.value = '';
      input.focus();
      return;
    }
    row.remove();
  });
  row.append(input, select, remove);
  elements.guestFields.append(row);
}

function openForm(invitation = null) {
  elements.form.reset();
  elements.formError.hidden = true;
  elements.formError.textContent = '';
  elements.guestFields.replaceChildren();
  elements.invitationId.value = invitation ? String(invitation.id) : '';
  elements.dialogTitle.textContent = invitation ? 'Editar invitación' : 'Nueva invitación';
  elements.familyName.value = invitation?.familyName || '';
  elements.specialLodging.checked = invitation?.specialLodging ?? true;
  (invitation?.guests || [{}]).forEach(addGuestField);
  elements.dialog.showModal();
  requestAnimationFrame(() => elements.familyName.focus());
}

function closeForm() {
  if (elements.saveButton.disabled) return;
  elements.dialog.close();
}

async function saveForm(event) {
  event.preventDefault();
  const id = Number(elements.invitationId.value) || null;
  const guests = [...elements.guestFields.querySelectorAll('.guest-row')].map((row) => ({
    id: Number(row.dataset.guestId) || null,
    name: row.querySelector('input').value,
    guestType: row.querySelector('select').value
  }));
  const body = {
    familyName: elements.familyName.value,
    specialLodging: elements.specialLodging.checked,
    guests
  };
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = 'Guardando…';
  elements.formError.hidden = true;
  try {
    await request(id ? `/api/admin/invitations/${id}` : '/api/admin/invitations', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    });
    elements.dialog.close();
    await load();
    showToast(id ? 'Invitación actualizada.' : 'Invitación creada. Ya puedes copiar su enlace.');
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = 'Guardar invitación';
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3400);
}

elements.list.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const card = event.target.closest('[data-id]');
  const invitation = state.invitations.find((item) => item.id === Number(card?.dataset.id));
  if (!invitation) return;

  if (action === 'edit') return openForm(invitation);
  if (action === 'copy') {
    try {
      await copyText(invitationUrl(invitation));
      showToast('Enlace copiado.');
    } catch {
      showToast('No fue posible copiar el enlace. Puedes seleccionarlo al final de la tarjeta.');
    }
    return;
  }
  if (action === 'delete') {
    const accepted = window.confirm(`¿Eliminar la invitación de ${invitation.familyName}? También se borrarán sus respuestas.`);
    if (!accepted) return;
    event.target.disabled = true;
    try {
      await request(`/api/admin/invitations/${invitation.id}`, { method: 'DELETE' });
      await load();
      showToast('Invitación eliminada.');
    } catch (error) {
      event.target.disabled = false;
      showToast(error.message);
    }
  }
});

elements.receptionVisibility.addEventListener('click', (event) => {
  const button = event.target.closest('.segmented-option');
  if (!button || button.classList.contains('active')) return;
  updateSettings({ receptionVisibility: button.dataset.value });
});
elements.rsvpLock.addEventListener('change', () => {
  updateSettings({ rsvpLockEnabled: elements.rsvpLock.checked });
});

document.querySelector('#new-invitation').addEventListener('click', () => openForm());
document.querySelector('#refresh').addEventListener('click', load);
document.querySelector('#add-guest').addEventListener('click', () => addGuestField());
elements.form.addEventListener('submit', saveForm);
elements.search.addEventListener('input', () => {
  state.filter = elements.search.value;
  renderList();
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closeForm));
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog) closeForm();
});

load();
loadSettings();
