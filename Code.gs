/**
 * KG Pass & License Tracker backend
 *
 * Simple setup:
 * 1) Put this file inside Google Sheet > Extensions > Apps Script.
 * 2) Change VIEW_PIN and EDIT_PIN below.
 * 3) Run initialSetup().
 * 4) Deploy as Web App: Execute as Me, Who has access Anyone.
 */

const CONFIG = {
  // Change these two PINs before real use.
  // VIEW_PIN can only read. EDIT_PIN can add/edit/delete.
  VIEW_PIN: '1234',
  EDIT_PIN: 'hengonghuat',

  ALERT_EMAILS: ['shayne@kgplasterceil.com.sg', 'kgchesterlee@gmail.com'],
  DAILY_EMAIL_HOUR: 8,
  TIMEZONE: 'Asia/Singapore',

  PEOPLE_SHEET: 'People',
  ITEMS_SHEET: 'Pass_And_License',
  LOG_SHEET: 'Log',

  PASS_RED_DAYS: 15,
  PASS_YELLOW_DAYS: 30,
  LICENSE_RED_DAYS: 35,
  LICENSE_YELLOW_DAYS: 60
};

const PEOPLE_HEADERS = [
  'personId', 'name', 'nickname', 'role', 'notes', 'active',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
];

const ITEM_HEADERS = [
  'itemId', 'personId', 'itemType', 'itemName', 'expiryDate', 'notes', 'active',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
];

const LOG_HEADERS = ['timestamp', 'action', 'mode', 'detail'];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || '').trim();
  if (!action) {
    return ContentService
      .createTextOutput('KG Pass & License Tracker backend is running. Use the website to connect.')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  let result;
  try {
    result = handleRequest_(params);
  } catch (err) {
    result = { ok: false, error: cleanError_(err) };
  }

  result.requestId = String(params.requestId || '');
  result.kgPassTracker = true;

  const callback = sanitizeCallback_(params.callback || 'callback');
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(result).replace(/</g, '\u003c') + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  const requestId = String(params.requestId || '');
  let result;
  try {
    result = handleRequest_(params);
  } catch (err) {
    result = { ok: false, error: cleanError_(err) };
  }
  result.requestId = requestId;
  result.kgPassTracker = true;
  return htmlPostMessage_(result);
}

function handleRequest_(params) {
  ensureSetup_();
  const action = String(params.action || '').trim();
  const auth = getAuth_(String(params.pin || ''));
  const payload = parsePayload_(params.payload);

  if (!auth.ok) return { ok: false, error: 'Wrong PIN.' };

  if (action === 'list') {
    const data = getData_();
    return Object.assign({ ok: true, mode: auth.mode }, data);
  }

  if (action === 'savePerson') {
    requireEdit_(auth);
    savePerson_(payload, auth.mode);
    writeLog_('savePerson', auth.mode, JSON.stringify({ name: payload.person && payload.person.name }));
    const data = getData_();
    return Object.assign({ ok: true, mode: auth.mode }, data);
  }

  if (action === 'deletePerson') {
    requireEdit_(auth);
    deletePerson_(payload.personId, auth.mode);
    writeLog_('deletePerson', auth.mode, String(payload.personId || ''));
    const data = getData_();
    return Object.assign({ ok: true, mode: auth.mode }, data);
  }

  return { ok: false, error: 'Unknown action: ' + action };
}

function initialSetup() {
  ensureSetup_();
  removeOldTriggers_('sendDailyExpiryEmail');
  ScriptApp.newTrigger('sendDailyExpiryEmail')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.DAILY_EMAIL_HOUR)
    .create();

  writeLog_('initialSetup', 'system', 'Sheets and daily email trigger ready');
  SpreadsheetApp.getActive().toast('KG tracker setup complete. Deploy this Apps Script as a Web App.', 'Done', 8);
}

function sendDailyExpiryEmail() {
  sendExpiryEmail_(false);
}

function sendTestEmail() {
  sendExpiryEmail_(true);
}

function sendExpiryEmail_(forceSend) {
  ensureSetup_();
  const data = getData_();
  const rows = flattenDueRows_(data.people, data.items);
  const dueRows = rows.filter(function(row) { return row.statusKey === 'red' || row.statusKey === 'yellow'; });

  if (!dueRows.length && !forceSend) return;

  const subject = dueRows.length
    ? 'KG pass/license expiry alert - ' + dueRows.length + ' item(s) need checking'
    : 'KG pass/license expiry test - no urgent item now';

  const htmlBody = buildEmailHtml_(dueRows);
  const plainBody = buildEmailText_(dueRows);

  MailApp.sendEmail({
    to: CONFIG.ALERT_EMAILS.join(','),
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  });

  writeLog_(forceSend ? 'sendTestEmail' : 'sendDailyExpiryEmail', 'system', 'Sent to ' + CONFIG.ALERT_EMAILS.join(', '));
}

function ensureSetup_() {
  const ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, CONFIG.PEOPLE_SHEET, PEOPLE_HEADERS);
  ensureSheet_(ss, CONFIG.ITEMS_SHEET, ITEM_HEADERS);
  ensureSheet_(ss, CONFIG.LOG_SHEET, LOG_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);

  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  let changed = false;
  headers.forEach(function(header, index) {
    if (existing[index] !== header) {
      existing[index] = header;
      changed = true;
    }
  });
  if (changed || sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
}

function getAuth_(pin) {
  if (pin && pin === CONFIG.EDIT_PIN) return { ok: true, mode: 'edit' };
  if (pin && pin === CONFIG.VIEW_PIN) return { ok: true, mode: 'view' };
  return { ok: false, mode: 'none' };
}

function requireEdit_(auth) {
  if (!auth || auth.mode !== 'edit') throw new Error('Edit PIN required. View PIN cannot change data.');
}

function parsePayload_(text) {
  if (!text) return {};
  try {
    return JSON.parse(String(text));
  } catch (err) {
    throw new Error('Bad payload from website.');
  }
}

function getData_() {
  const people = readObjects_(CONFIG.PEOPLE_SHEET)
    .filter(function(row) { return isActive_(row.active); })
    .map(cleanPerson_);

  const activePersonIds = {};
  people.forEach(function(person) { activePersonIds[person.personId] = true; });

  const items = readObjects_(CONFIG.ITEMS_SHEET)
    .filter(function(row) { return isActive_(row.active) && activePersonIds[row.personId]; })
    .map(cleanItem_);

  return {
    people: people,
    items: items,
    settings: {
      passRedDays: CONFIG.PASS_RED_DAYS,
      passYellowDays: CONFIG.PASS_YELLOW_DAYS,
      licenseRedDays: CONFIG.LICENSE_RED_DAYS,
      licenseYellowDays: CONFIG.LICENSE_YELLOW_DAYS,
      alertEmails: CONFIG.ALERT_EMAILS,
      dailyEmailHour: CONFIG.DAILY_EMAIL_HOUR,
      timezone: CONFIG.TIMEZONE
    },
    serverTime: nowText_()
  };
}

function readObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map(function(row) {
    const obj = {};
    headers.forEach(function(header, index) {
      if (!header) return;
      let value = row[index];
      if (value instanceof Date) {
        if (String(header).toLowerCase().indexOf('date') >= 0) value = formatDate_(value);
        else value = Utilities.formatDate(value, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
      }
      obj[header] = value;
    });
    return obj;
  });
}

function cleanPerson_(row) {
  return {
    personId: String(row.personId || ''),
    name: String(row.name || ''),
    nickname: String(row.nickname || ''),
    role: normalizeRole_(row.role),
    notes: String(row.notes || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || '')
  };
}

function cleanItem_(row) {
  return {
    itemId: String(row.itemId || ''),
    personId: String(row.personId || ''),
    itemType: normalizeItemType_(row.itemType),
    itemName: String(row.itemName || ''),
    expiryDate: normalizeDateText_(row.expiryDate),
    notes: String(row.notes || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || '')
  };
}

function savePerson_(payload, mode) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const person = payload.person || {};
    const incomingItems = Array.isArray(payload.items) ? payload.items : [];
    const now = nowText_();

    const personId = String(person.personId || '').trim() || makeId_('P');
    const name = String(person.name || '').trim();
    if (!name) throw new Error('Name is required.');

    const peopleSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.PEOPLE_SHEET);
    const peopleIndex = indexSheetById_(peopleSheet, 'personId');
    const existingPerson = peopleIndex.map[personId] || null;

    const personRow = {
      personId: personId,
      name: name,
      nickname: String(person.nickname || '').trim(),
      role: normalizeRole_(person.role),
      notes: String(person.notes || '').trim(),
      active: true,
      createdAt: existingPerson ? existingPerson.object.createdAt : now,
      updatedAt: now,
      createdBy: existingPerson ? existingPerson.object.createdBy : mode,
      updatedBy: mode
    };

    upsertRow_(peopleSheet, PEOPLE_HEADERS, peopleIndex, personId, personRow);

    const itemsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.ITEMS_SHEET);
    const itemIndex = indexSheetById_(itemsSheet, 'itemId');
    const allItems = readObjects_(CONFIG.ITEMS_SHEET);
    const existingActiveItemIds = {};
    allItems.forEach(function(row) {
      if (row.personId === personId && isActive_(row.active)) existingActiveItemIds[row.itemId] = true;
    });

    const keptItemIds = {};
    incomingItems.forEach(function(item) {
      const itemName = String(item.itemName || '').trim();
      const expiryDate = normalizeDateText_(item.expiryDate);
      if (!itemName && !expiryDate) return;
      if (!itemName || !expiryDate) throw new Error('Every pass/license needs name and expiry date.');

      const itemId = String(item.itemId || '').trim() || makeId_('I');
      keptItemIds[itemId] = true;
      const existingItem = itemIndex.map[itemId] || null;

      const itemRow = {
        itemId: itemId,
        personId: personId,
        itemType: normalizeItemType_(item.itemType),
        itemName: itemName,
        expiryDate: expiryDate,
        notes: String(item.notes || '').trim(),
        active: true,
        createdAt: existingItem ? existingItem.object.createdAt : now,
        updatedAt: now,
        createdBy: existingItem ? existingItem.object.createdBy : mode,
        updatedBy: mode
      };
      upsertRow_(itemsSheet, ITEM_HEADERS, itemIndex, itemId, itemRow);
    });

    const removedItemIds = Object.keys(existingActiveItemIds).filter(function(itemId) {
      return !keptItemIds[itemId];
    });
    deleteRowsByIds_(itemsSheet, 'itemId', removedItemIds);
  } finally {
    lock.releaseLock();
  }
}

function deletePerson_(personId, mode) {
  personId = String(personId || '').trim();
  if (!personId) throw new Error('Missing person ID.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const peopleSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.PEOPLE_SHEET);
    const itemsSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.ITEMS_SHEET);

    // Delete the real rows from Google Sheet, so the sheet stays easy to read.
    deleteRowsWhere_(itemsSheet, function(row) { return String(row.personId || '') === personId; });
    deleteRowsWhere_(peopleSheet, function(row) { return String(row.personId || '') === personId; });
  } finally {
    lock.releaseLock();
  }
}

function upsertRow_(sheet, headers, index, idValue, object) {
  const rowValues = headers.map(function(header) { return object[header] === undefined ? '' : object[header]; });
  if (index.map[idValue]) {
    sheet.getRange(index.map[idValue].rowNumber, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

function markInactive_(sheet, headers, index, idValue, mode) {
  if (!index.map[idValue]) return;
  const obj = index.map[idValue].object;
  obj.active = false;
  obj.updatedAt = nowText_();
  obj.updatedBy = mode || 'system';
  const values = headers.map(function(header) { return obj[header] === undefined ? '' : obj[header]; });
  sheet.getRange(index.map[idValue].rowNumber, 1, 1, headers.length).setValues([values]);
}

function deleteRowsByIds_(sheet, idHeader, ids) {
  if (!ids || !ids.length) return;
  const index = indexSheetById_(sheet, idHeader);
  const rowNumbers = ids
    .map(function(id) { return index.map[id] ? index.map[id].rowNumber : 0; })
    .filter(function(rowNumber) { return rowNumber > 1; })
    .sort(function(a, b) { return b - a; });
  rowNumbers.forEach(function(rowNumber) { sheet.deleteRow(rowNumber); });
}

function deleteRowsWhere_(sheet, predicate) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0];
  const rowsToDelete = [];
  for (let r = 1; r < values.length; r++) {
    const object = {};
    headers.forEach(function(header, c) { object[header] = values[r][c]; });
    if (predicate(object)) rowsToDelete.push(r + 1);
  }
  rowsToDelete.sort(function(a, b) { return b - a; }).forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });
}

function indexSheetById_(sheet, idHeader) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIndex = headers.indexOf(idHeader);
  const map = {};
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const object = {};
    headers.forEach(function(header, c) {
      let value = row[c];
      if (value instanceof Date) {
        if (String(header).toLowerCase().indexOf('date') >= 0) value = formatDate_(value);
        else value = Utilities.formatDate(value, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
      }
      object[header] = value;
    });
    const idValue = String(row[idIndex] || '');
    if (idValue) map[idValue] = { rowNumber: r + 1, object: object };
  }
  return { headers: headers, map: map };
}

function isActive_(value) {
  return value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1' || value === '' || value === undefined;
}

function normalizeRole_(role) {
  const text = String(role || '').trim().toLowerCase();
  return text === 'foreman' ? 'Foreman' : 'Worker';
}

function normalizeItemType_(type) {
  const text = String(type || '').trim().toLowerCase();
  return text === 'license' ? 'License' : 'Pass';
}

function normalizeDateText_(value) {
  if (!value) return '';
  if (value instanceof Date) return formatDate_(value);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const d = new Date(text);
  if (isNaN(d.getTime())) return '';
  return formatDate_(d);
}

function formatDate_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function nowText_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function makeId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 18);
}

function writeLog_(action, mode, detail) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.LOG_SHEET);
  sheet.appendRow([nowText_(), action, mode, detail || '']);
}

function removeOldTriggers_(functionName) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(trigger);
  });
}

function flattenDueRows_(people, items) {
  const personMap = {};
  people.forEach(function(person) { personMap[person.personId] = person; });

  return items.map(function(item) {
    const person = personMap[item.personId] || {};
    const status = getItemStatus_(item);
    return {
      person: person,
      item: item,
      statusKey: status.key,
      statusLabel: status.label,
      days: status.days,
      rank: status.rank
    };
  }).sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.days - b.days;
  });
}

function getItemStatus_(item) {
  const type = normalizeItemType_(item.itemType);
  const days = daysUntil_(item.expiryDate);
  const redLimit = type === 'License' ? CONFIG.LICENSE_RED_DAYS : CONFIG.PASS_RED_DAYS;
  const yellowLimit = type === 'License' ? CONFIG.LICENSE_YELLOW_DAYS : CONFIG.PASS_YELLOW_DAYS;

  if (days <= redLimit) return { key: 'red', label: daysLabel_(days), days: days, rank: 0 };
  if (days <= yellowLimit) return { key: 'yellow', label: daysLabel_(days), days: days, rank: 1 };
  return { key: 'normal', label: daysLabel_(days), days: days, rank: 2 };
}

function daysUntil_(dateText) {
  const text = normalizeDateText_(dateText);
  if (!text) return 99999;
  const parts = text.split('-').map(Number);
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function daysLabel_(days) {
  if (days < 0) return Math.abs(days) + ' day(s) expired';
  if (days === 0) return 'Expires today';
  return days + ' day(s) left';
}

function buildEmailHtml_(rows) {
  const ruleText = '<p><b>Pass:</b> Red expired/within 15 days, Yellow 16-30 days.<br>' +
    '<b>License:</b> Red expired/within 35 days, Yellow 36-60 days.</p>';

  if (!rows.length) {
    return '<h2>KG Pass & License Expiry Test</h2><p>No red/yellow item at the moment.</p>' + ruleText;
  }

  const tableRows = rows.map(function(row) {
    const bg = row.statusKey === 'red' ? '#fff0ee' : '#fff7d8';
    const color = row.statusKey === 'red' ? '#b3261e' : '#8a5d00';
    return '<tr style="background:' + bg + '">' +
      '<td>' + html_(row.person.name) + '</td>' +
      '<td>' + html_(row.person.nickname) + '</td>' +
      '<td>' + html_(row.person.role) + '</td>' +
      '<td>' + html_(row.item.itemType) + '</td>' +
      '<td><b>' + html_(row.item.itemName) + '</b></td>' +
      '<td>' + html_(row.item.expiryDate) + '</td>' +
      '<td style="color:' + color + ';font-weight:bold">' + html_(row.statusLabel) + '</td>' +
      '<td>' + html_(row.item.notes) + '</td>' +
      '</tr>';
  }).join('');

  return '<h2>KG Pass & License Expiry Alert</h2>' +
    '<p>These items are expired or expiring soon. Please renew/check.</p>' +
    ruleText +
    '<table border="1" cellspacing="0" cellpadding="8" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">' +
    '<thead><tr style="background:#14324d;color:#fff">' +
    '<th>Name</th><th>Nickname</th><th>Role</th><th>Type</th><th>Pass/License</th><th>Expiry</th><th>Status</th><th>Notes</th>' +
    '</tr></thead><tbody>' + tableRows + '</tbody></table>';
}

function buildEmailText_(rows) {
  if (!rows.length) return 'KG Pass & License Expiry Test\nNo red/yellow item at the moment.';
  const lines = ['KG Pass & License Expiry Alert', ''];
  rows.forEach(function(row) {
    lines.push(row.statusLabel + ' - ' + row.person.name + ' (' + row.person.role + ') - ' + row.item.itemType + ': ' + row.item.itemName + ' - Expiry ' + row.item.expiryDate);
  });
  return lines.join('\n');
}

function html_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function htmlPostMessage_(result) {
  const json = JSON.stringify(result).replace(/</g, '\\u003c');
  const html = '<!doctype html><html><body><script>' +
    'window.parent.postMessage(' + json + ', "*");' +
    '</script></body></html>';
  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function sanitizeCallback_(value) {
  const callback = String(value || 'callback');
  if (/^[A-Za-z_$][0-9A-Za-z_$.]{0,100}$/.test(callback)) return callback;
  return 'callback';
}

function cleanError_(err) {
  if (!err) return 'Unknown error';
  return String(err.message || err).replace(/^Exception:\s*/i, '');
}
