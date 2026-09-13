import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT || '3016', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_URL = new URL(process.env.PUBLIC_URL || 'https://fys.nuestraboda.111labs.net').origin;
const SHARE_VERSION = '2';
const MAX_BODY_BYTES = 64 * 1024;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT debe ser un numero entre 1 y 65535.');
}

if (
  ADMIN_PASSWORD.length < 12 ||
  ['cambia-esta-clave', 'change-me', 'password'].includes(ADMIN_PASSWORD.toLowerCase())
) {
  throw new Error('Define ADMIN_PASSWORD con una clave de al menos 12 caracteres y sin valores de ejemplo.');
}

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'wedding.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    family_name TEXT NOT NULL,
    special_lodging INTEGER NOT NULL DEFAULT 0 CHECK (special_lodging IN (0, 1)),
    lodging_interest INTEGER NOT NULL DEFAULT 0 CHECK (lodging_interest IN (0, 1)),
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY,
    invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    guest_type TEXT NOT NULL DEFAULT 'adult' CHECK (guest_type IN ('adult', 'youth', 'child')),
    attendance TEXT CHECK (attendance IN ('yes', 'no')),
    meal TEXT CHECK (meal IN ('p1', 'p2')),
    drink TEXT CHECK (drink IN ('b1', 'b2')),
    cake INTEGER CHECK (cake IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    UNIQUE (invitation_id, name)
  );

  CREATE INDEX IF NOT EXISTS guests_invitation_id_idx ON guests(invitation_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migración no destructiva para bases creadas antes de clasificar invitados.
// Los registros existentes se consideran adultos hasta que se editen en el panel.
const guestColumns = db.prepare('PRAGMA table_info(guests)').all();
if (!guestColumns.some((column) => column.name === 'guest_type')) {
  db.exec(`
    ALTER TABLE guests
    ADD COLUMN guest_type TEXT NOT NULL DEFAULT 'adult'
    CHECK (guest_type IN ('adult', 'youth', 'child'))
  `);
}

// Fin del plazo de confirmación/modificación de asistencia: 11 de octubre de 2026, 23:59 hora de Colombia (UTC-5).
const RSVP_DEADLINE = Date.UTC(2026, 9, 12, 4, 59, 59);
const RECEPTION_VISIBILITY_VALUES = new Set(['auto', 'show', 'hide']);

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function currentSettings() {
  const receptionVisibility = getSetting('reception_visibility');
  const rsvpLockEnabled = getSetting('rsvp_lock_enabled');
  return {
    receptionVisibility: RECEPTION_VISIBILITY_VALUES.has(receptionVisibility) ? receptionVisibility : 'auto',
    rsvpLockEnabled: rsvpLockEnabled === null ? true : rsvpLockEnabled === '1'
  };
}

function rsvpLockActive() {
  const settings = currentSettings();
  return settings.rsvpLockEnabled && Date.now() > RSVP_DEADLINE;
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const STATIC_FILES = new Map([
  ['/support.js', join(ROOT, 'support.js')],
  ['/image-slot.js', join(ROOT, 'image-slot.js')],
  ['/img/SiluetaVirgen.jpeg', join(ROOT, 'img/SiluetaVirgen.jpeg')],
  ['/img/novios-anillo.jpeg', join(ROOT, 'img/novios-anillo.jpeg')],
  ['/img/novios-retrato.jpeg', join(ROOT, 'img/novios-retrato.jpeg')],
  ['/img/preview-whatsapp.jpg', join(ROOT, 'img/preview-whatsapp.jpg')],
  ['/img/novios-villa-de-leyva.jpeg', join(ROOT, 'img/novios-villa-de-leyva.jpeg')],
  ['/img/ramita-olivo.png', join(ROOT, 'img/ramita-olivo.png')],
  ['/img/favicon.svg', join(ROOT, 'img/favicon.svg')],
  ['/img/dress-code/hombre-01-beige-chaleco.jpeg', join(ROOT, 'img/dress-code/hombre-01-beige-chaleco.jpeg')],
  ['/img/dress-code/hombre-02-beige-tirantes.jpeg', join(ROOT, 'img/dress-code/hombre-02-beige-tirantes.jpeg')],
  ['/img/dress-code/hombre-03-tonos-tierra.jpeg', join(ROOT, 'img/dress-code/hombre-03-tonos-tierra.jpeg')],
  ['/img/dress-code/mujer-01-azul-rey.jpeg', join(ROOT, 'img/dress-code/mujer-01-azul-rey.jpeg')],
  ['/img/dress-code/mujer-02-encaje-claro.jpeg', join(ROOT, 'img/dress-code/mujer-02-encaje-claro.jpeg')],
  ['/img/dress-code/mujer-03-rosa-floral.jpeg', join(ROOT, 'img/dress-code/mujer-03-rosa-floral.jpeg')],
  ['/img/dress-code/mujer-04-amarillo-floral.jpeg', join(ROOT, 'img/dress-code/mujer-04-amarillo-floral.jpeg')],
  ['/img/dress-code/mujer-05-menta-floral.jpeg', join(ROOT, 'img/dress-code/mujer-05-menta-floral.jpeg')],
  ['/img/dress-code/mujer-06-rosas.jpeg', join(ROOT, 'img/dress-code/mujer-06-rosas.jpeg')],
  ['/img/dress-code/mujer-07-azul-claro.jpeg', join(ROOT, 'img/dress-code/mujer-07-azul-claro.jpeg')],
  ['/img/dress-code/mujer-08-lila-floral.jpeg', join(ROOT, 'img/dress-code/mujer-08-lila-floral.jpeg')],
  ['/_ds/classical-717d4eba-58bb-40a1-8c6e-55130b3c446a/styles.css', join(ROOT, '_ds/classical-717d4eba-58bb-40a1-8c6e-55130b3c446a/styles.css')],
  ['/_ds/classical-717d4eba-58bb-40a1-8c6e-55130b3c446a/_ds_bundle.js', join(ROOT, '_ds/classical-717d4eba-58bb-40a1-8c6e-55130b3c446a/_ds_bundle.js')],
  ['/vendor/react.production.min.js', join(ROOT, 'node_modules/react/umd/react.production.min.js')],
  ['/vendor/react-dom.production.min.js', join(ROOT, 'node_modules/react-dom/umd/react-dom.production.min.js')],
  ['/vendor/babel.min.js', join(ROOT, 'node_modules/@babel/standalone/babel.min.js')]
]);

const ADMIN_FILES = new Map([
  ['/admin', join(ROOT, 'admin/index.html')],
  ['/admin/', join(ROOT, 'admin/index.html')],
  ['/admin/app.js', join(ROOT, 'admin/app.js')],
  ['/admin/styles.css', join(ROOT, 'admin/styles.css')]
]);
const INVITATION_TEMPLATE = readFileSync(join(ROOT, 'Invitación Felipe y Sarita.dc.html'), 'utf8');

function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra
  };
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  }));
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, securityHeaders({
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...headers
  }));
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serveInvitation(res, url) {
  const token = url.searchParams.get('i');
  const invitation = token
    ? db.prepare('SELECT family_name AS familyName FROM invitations WHERE token = ?').get(token)
    : null;
  const title = invitation
    ? `Felipe & Sarita invitan a ${invitation.familyName}`
    : 'Felipe & Sarita · Invitación de boda';
  const description = 'Celebremos juntos el 7 de noviembre de 2026 en Villa de Leyva. Abre la invitación para conocer todos los detalles.';
  const canonicalUrl = invitation
    ? `${PUBLIC_URL}/?i=${encodeURIComponent(token)}&v=${SHARE_VERSION}`
    : `${PUBLIC_URL}/`;
  const previewUrl = `${PUBLIC_URL}/img/preview-whatsapp.jpg?v=20260912`;
  const socialMeta = `
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:locale" content="es_CO">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Felipe &amp; Sarita">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(previewUrl)}">
<meta property="og:image:secure_url" content="${escapeHtml(previewUrl)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="627">
<meta property="og:image:alt" content="Invitación de boda de Felipe y Sarita">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(previewUrl)}">`;
  const body = INVITATION_TEMPLATE.replace('<meta charset="utf-8">', `<meta charset="utf-8">${socialMeta}`);
  sendText(res, 200, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
}

function serveFile(res, filePath, { privateFile = false } = {}) {
  try {
    const body = readFileSync(filePath);
    const contentType = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, securityHeaders({
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': privateFile ? 'no-store' : (extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=86400')
    }));
    res.end(body);
  } catch (error) {
    console.error('No se pudo servir el archivo:', filePath, error);
    sendJson(res, 500, { error: 'No se pudo cargar este recurso.' });
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAdmin(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    return safeEqual(decoded.slice(0, separator), ADMIN_USER) && safeEqual(decoded.slice(separator + 1), ADMIN_PASSWORD);
  } catch {
    return false;
  }
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, { error: 'Autenticación requerida.' }, {
    'WWW-Authenticate': 'Basic realm="Administración boda", charset="UTF-8"'
  });
  return false;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('La solicitud es demasiado grande.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('El cuerpo JSON no es válido.');
    error.status = 400;
    throw error;
  }
}

function cleanText(value, field, maxLength = 120) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw validationError(`${field} es obligatorio.`);
  if (text.length > maxLength) throw validationError(`${field} no puede superar ${maxLength} caracteres.`);
  return text;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseInvitationPayload(body, { allowIds = false } = {}) {
  const familyName = cleanText(body.familyName, 'El nombre de la familia');
  if (!Array.isArray(body.guests) || body.guests.length < 1 || body.guests.length > 20) {
    throw validationError('Cada invitación debe tener entre 1 y 20 invitados.');
  }

  const guests = body.guests.map((guest, index) => {
    const guestType = guest?.guestType || 'adult';
    if (!['adult', 'youth', 'child'].includes(guestType)) {
      throw validationError(`La categoría del invitado ${index + 1} no es válida.`);
    }
    return {
      id: allowIds && Number.isInteger(Number(guest?.id)) && Number(guest.id) > 0 ? Number(guest.id) : null,
      name: cleanText(guest?.name, `El nombre del invitado ${index + 1}`),
      guestType
    };
  });
  const uniqueNames = new Set(guests.map((guest) => guest.name.toLocaleLowerCase('es')));
  if (uniqueNames.size !== guests.length) throw validationError('No puede haber invitados con el mismo nombre dentro de una invitación.');

  return {
    familyName,
    specialLodging: body.specialLodging === true,
    guests
  };
}

function withTransaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function guestRows(invitationId) {
  return db.prepare(`
    SELECT id, name, guest_type AS guestType, attendance, meal, drink, cake,
           sort_order AS sortOrder, updated_at AS updatedAt
    FROM guests
    WHERE invitation_id = ?
    ORDER BY sort_order, id
  `).all(invitationId).map((guest) => ({
    ...guest,
    id: Number(guest.id),
    cake: guest.cake === null ? null : guest.cake === 1
  }));
}

function guestResponseComplete(guest) {
  if (!guest.attendance) return false;
  if (guest.attendance === 'no') return true;
  const hasMeal = guest.guestType === 'child' || ['p1', 'p2'].includes(guest.meal);
  return hasMeal && ['b1', 'b2'].includes(guest.drink);
}

function publicInvitation(token) {
  const invitation = db.prepare(`
    SELECT id, family_name AS familyName, special_lodging AS specialLodging,
           lodging_interest AS lodgingInterest, responded_at AS respondedAt
    FROM invitations WHERE token = ?
  `).get(token);
  if (!invitation) return null;
  const guests = guestRows(invitation.id);
  return {
    familyName: invitation.familyName,
    specialLodging: invitation.specialLodging === 1,
    lodgingInterest: invitation.lodgingInterest === 1,
    responded: guests.length > 0 && guests.every(guestResponseComplete),
    respondedAt: invitation.respondedAt,
    guests: guests.map(({ sortOrder, updatedAt, ...guest }) => guest)
  };
}

function adminInvitations() {
  return db.prepare(`
    SELECT id, token, family_name AS familyName, special_lodging AS specialLodging,
           lodging_interest AS lodgingInterest, responded_at AS respondedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM invitations
    ORDER BY family_name COLLATE NOCASE, id
  `).all().map((invitation) => {
    const guests = guestRows(invitation.id);
    return {
      ...invitation,
      id: Number(invitation.id),
      specialLodging: invitation.specialLodging === 1,
      lodgingInterest: invitation.lodgingInterest === 1,
      responded: guests.length > 0 && guests.every(guestResponseComplete),
      guests
    };
  });
}

function summary(invitations) {
  const guests = invitations.flatMap((invitation) => invitation.guests);
  return {
    invitations: invitations.length,
    respondedInvitations: invitations.filter((invitation) => invitation.responded).length,
    guests: guests.length,
    attending: guests.filter((guest) => guest.attendance === 'yes').length,
    declined: guests.filter((guest) => guest.attendance === 'no').length,
    pending: guests.filter((guest) => guest.attendance === null).length,
    lodging: invitations.filter((invitation) => invitation.lodgingInterest).length,
    meals: {
      p1: guests.filter((guest) => guest.meal === 'p1').length,
      p2: guests.filter((guest) => guest.meal === 'p2').length,
      child: guests.filter((guest) => guest.attendance === 'yes' && guest.guestType === 'child').length
    },
    drinks: {
      b1: guests.filter((guest) => guest.drink === 'b1').length,
      b2: guests.filter((guest) => guest.drink === 'b2').length
    },
    cake: guests.filter((guest) => guest.attendance === 'yes' && guest.cake === true).length,
    liquor: {
      yes: guests.filter((guest) => guest.attendance === 'yes' && guest.guestType === 'adult').length,
      no: guests.filter((guest) => guest.attendance === 'yes' && guest.guestType !== 'adult').length
    }
  };
}

function createInvitation(body) {
  const input = parseInvitationPayload(body);
  return withTransaction(() => {
    const token = randomBytes(18).toString('base64url');
    const inserted = db.prepare(`
      INSERT INTO invitations (token, family_name, special_lodging)
      VALUES (?, ?, ?)
    `).run(token, input.familyName, input.specialLodging ? 1 : 0);
    const invitationId = Number(inserted.lastInsertRowid);
    const insertGuest = db.prepare(`
      INSERT INTO guests (invitation_id, name, guest_type, sort_order) VALUES (?, ?, ?, ?)
    `);
    input.guests.forEach((guest, index) => insertGuest.run(invitationId, guest.name, guest.guestType, index));
    return adminInvitations().find((invitation) => invitation.id === invitationId);
  });
}

function updateInvitation(id, body) {
  const input = parseInvitationPayload(body, { allowIds: true });
  return withTransaction(() => {
    const existing = db.prepare('SELECT id FROM invitations WHERE id = ?').get(id);
    if (!existing) return null;

    const currentGuests = guestRows(id);
    const currentIds = new Set(currentGuests.map((guest) => guest.id));
    const submittedIds = new Set();
    for (const guest of input.guests) {
      if (guest.id !== null) {
        if (!currentIds.has(guest.id) || submittedIds.has(guest.id)) {
          throw validationError('La lista de invitados contiene identificadores inválidos.');
        }
        submittedIds.add(guest.id);
      }
    }

    db.prepare(`
      UPDATE invitations
      SET family_name = ?, special_lodging = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(input.familyName, input.specialLodging ? 1 : 0, id);

    const removedGuests = currentGuests.filter((guest) => !submittedIds.has(guest.id));
    removedGuests.forEach((guest) => {
      db.prepare('DELETE FROM guests WHERE id = ? AND invitation_id = ?').run(guest.id, id);
    });

    // Libera temporalmente los nombres para permitir intercambiarlos sin
    // chocar con la restricción única y sin perder respuestas existentes.
    const temporaryPrefix = `__tmp_${randomBytes(8).toString('hex')}_`;
    input.guests
      .filter((guest) => guest.id !== null)
      .forEach((guest) => db.prepare('UPDATE guests SET name = ? WHERE id = ? AND invitation_id = ?')
        .run(temporaryPrefix + guest.id, guest.id, id));

    const updateGuest = db.prepare(`
      UPDATE guests
      SET name = ?, guest_type = ?, sort_order = ?,
          meal = CASE WHEN ? = 'child' THEN NULL ELSE meal END
      WHERE id = ? AND invitation_id = ?
    `);
    const insertGuest = db.prepare(`
      INSERT INTO guests (invitation_id, name, guest_type, sort_order) VALUES (?, ?, ?, ?)
    `);
    input.guests.forEach((guest, index) => {
      if (guest.id === null) insertGuest.run(id, guest.name, guest.guestType, index);
      else updateGuest.run(guest.name, guest.guestType, index, guest.guestType, guest.id, id);
    });

    return adminInvitations().find((invitation) => invitation.id === id);
  });
}

function saveRsvp(token, body) {
  const invitation = db.prepare('SELECT id FROM invitations WHERE token = ?').get(token);
  if (!invitation) return null;
  if (rsvpLockActive()) {
    const error = new Error('El plazo para confirmar o modificar tu asistencia venció el 11 de octubre de 2026.');
    error.status = 403;
    throw error;
  }
  if (!Array.isArray(body.guests)) throw validationError('La lista de respuestas es obligatoria.');

  const existingGuests = guestRows(invitation.id);
  const byId = new Map(existingGuests.map((guest) => [guest.id, guest]));
  if (body.guests.length !== existingGuests.length) throw validationError('Debes responder por todas las personas de la invitación.');

  const answers = body.guests.map((answer) => {
    const id = Number(answer?.id);
    if (!Number.isInteger(id) || !byId.has(id)) throw validationError('La respuesta contiene un invitado inválido.');
    const guest = byId.get(id);
    byId.delete(id);
    if (!['yes', 'no'].includes(answer.attendance)) throw validationError('Indica si cada persona asistirá.');
    if (answer.attendance === 'yes' && guest.guestType !== 'child' && !['p1', 'p2'].includes(answer.meal)) {
      throw validationError('Selecciona un plato para cada asistente adulto o joven.');
    }
    if (answer.attendance === 'yes' && !['b1', 'b2'].includes(answer.drink)) throw validationError('Selecciona una bebida para cada asistente.');
    return {
      id,
      attendance: answer.attendance,
      meal: answer.attendance === 'yes' && guest.guestType !== 'child' ? answer.meal : null,
      drink: answer.attendance === 'yes' ? answer.drink : null,
      cake: answer.attendance === 'yes' ? answer.cake !== false : null
    };
  });
  if (byId.size) throw validationError('Debes responder una sola vez por cada persona.');

  withTransaction(() => {
    const update = db.prepare(`
      UPDATE guests SET attendance = ?, meal = ?, drink = ?, cake = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND invitation_id = ?
    `);
    answers.forEach((answer) => update.run(
      answer.attendance,
      answer.meal,
      answer.drink,
      answer.cake === null ? null : (answer.cake ? 1 : 0),
      answer.id,
      invitation.id
    ));
    db.prepare(`
      UPDATE invitations SET responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(invitation.id);
  });
  return publicInvitation(token);
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function invitationsCsv(invitations) {
  const rows = [[
    'Familia', 'Invitado', 'Categoría', 'Asistencia', 'Plato', 'Bebida', 'Licor', 'Torta',
    'Hospedaje', 'Respondido el', 'Enlace'
  ]];
  const mealLabels = { p1: 'Murillo Estofado', p2: 'Churrasco de Pollo' };
  const drinkLabels = { b1: 'Soda de tamarindo y limonaria', b2: 'Soda de arándanos y moras' };
  const typeLabels = { adult: 'Adulto', youth: 'Joven', child: 'Niño' };
  for (const invitation of invitations) {
    for (const guest of invitation.guests) {
      rows.push([
        invitation.familyName,
        guest.name,
        typeLabels[guest.guestType] || 'Adulto',
        guest.attendance === 'yes' ? 'Asistirá' : guest.attendance === 'no' ? 'No asistirá' : 'Pendiente',
        guest.attendance === 'yes' && guest.guestType === 'child' ? 'Menú infantil' : (mealLabels[guest.meal] || ''),
        drinkLabels[guest.drink] || '',
        guest.attendance === 'yes' ? (guest.guestType === 'adult' ? 'Sí' : 'No') : '',
        guest.cake === true ? 'Sí' : guest.cake === false ? 'No' : '',
        invitation.lodgingInterest ? 'Sí' : 'No',
        invitation.respondedAt || '',
        `/?i=${invitation.token}&v=${SHARE_VERSION}`
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function parseId(pathname) {
  const match = pathname.match(/^\/api\/admin\/invitations\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, currentSettings());
  }

  const publicMatch = url.pathname.match(/^\/api\/invitations\/([A-Za-z0-9_-]+)(?:\/(rsvp|lodging))?$/);
  if (publicMatch) {
    const [, token, action] = publicMatch;
    if (req.method === 'GET' && !action) {
      const invitation = publicInvitation(token);
      if (!invitation) return sendJson(res, 404, { error: 'Esta invitación no existe o el enlace está incompleto.' });
      return sendJson(res, 200, invitation);
    }
    if (req.method === 'PUT' && action === 'rsvp') {
      const invitation = saveRsvp(token, await readJson(req));
      if (!invitation) return sendJson(res, 404, { error: 'Esta invitación no existe.' });
      return sendJson(res, 200, invitation);
    }
    if (req.method === 'PUT' && action === 'lodging') {
      const body = await readJson(req);
      if (typeof body.interested !== 'boolean') throw validationError('El interés de hospedaje debe ser verdadero o falso.');
      const result = db.prepare(`
        UPDATE invitations SET lodging_interest = ?, updated_at = CURRENT_TIMESTAMP WHERE token = ?
      `).run(body.interested ? 1 : 0, token);
      if (Number(result.changes) === 0) return sendJson(res, 404, { error: 'Esta invitación no existe.' });
      return sendJson(res, 200, { lodgingInterest: body.interested });
    }
    return sendJson(res, 405, { error: 'Método no permitido.' }, { Allow: action ? 'PUT' : 'GET' });
  }

  if (!url.pathname.startsWith('/api/admin/')) return sendJson(res, 404, { error: 'Ruta no encontrada.' });
  if (!requireAdmin(req, res)) return;

  if (url.pathname === '/api/admin/invitations' && req.method === 'GET') {
    const invitations = adminInvitations();
    return sendJson(res, 200, { summary: summary(invitations), invitations });
  }
  if (url.pathname === '/api/admin/invitations' && req.method === 'POST') {
    return sendJson(res, 201, createInvitation(await readJson(req)));
  }
  const invitationId = parseId(url.pathname);
  if (invitationId !== null && req.method === 'PUT') {
    const invitation = updateInvitation(invitationId, await readJson(req));
    if (!invitation) return sendJson(res, 404, { error: 'La invitación no existe.' });
    return sendJson(res, 200, invitation);
  }
  if (invitationId !== null && req.method === 'DELETE') {
    const result = db.prepare('DELETE FROM invitations WHERE id = ?').run(invitationId);
    if (Number(result.changes) === 0) return sendJson(res, 404, { error: 'La invitación no existe.' });
    res.writeHead(204, securityHeaders({ 'Cache-Control': 'no-store' }));
    return res.end();
  }
  if (url.pathname === '/api/admin/settings' && req.method === 'GET') {
    return sendJson(res, 200, currentSettings());
  }
  if (url.pathname === '/api/admin/settings' && req.method === 'PUT') {
    const body = await readJson(req);
    if (body.receptionVisibility !== undefined) {
      if (!RECEPTION_VISIBILITY_VALUES.has(body.receptionVisibility)) {
        throw validationError('La visibilidad de la recepción no es válida.');
      }
      setSetting('reception_visibility', body.receptionVisibility);
    }
    if (body.rsvpLockEnabled !== undefined) {
      if (typeof body.rsvpLockEnabled !== 'boolean') {
        throw validationError('El bloqueo de asistencia debe ser verdadero o falso.');
      }
      setSetting('rsvp_lock_enabled', body.rsvpLockEnabled ? '1' : '0');
    }
    return sendJson(res, 200, currentSettings());
  }
  if (url.pathname === '/api/admin/export.csv' && req.method === 'GET') {
    const csv = invitationsCsv(adminInvitations());
    return sendText(res, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="confirmaciones-boda.csv"',
      'Cache-Control': 'no-store'
    });
  }
  return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') return sendJson(res, 200, { status: 'ok' });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/') return serveInvitation(res, url);

    if (ADMIN_FILES.has(url.pathname)) {
      if (!requireAdmin(req, res)) return;
      return serveFile(res, ADMIN_FILES.get(url.pathname), { privateFile: true });
    }
    if (STATIC_FILES.has(url.pathname)) return serveFile(res, STATIC_FILES.get(url.pathname));

    // image-slot consulta este archivo aunque todavía no haya imágenes cargadas.
    if (url.pathname === '/.image-slots.state.json') return sendJson(res, 200, {});
    return sendJson(res, 404, { error: 'Página no encontrada.' });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'Ocurrió un error inesperado.' : error.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Invitaciones disponibles en http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal}: cerrando servidor...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
