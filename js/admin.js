// ── State ──────────────────────────────────────────────────────
let data = [];
let selectedIndex = null;
let locationMap = null;
let locationMarker = null;
let extraPrograms = new Set(); // puljer from the `programs` table (may have no funding yet)

// ── Data helpers ────────────────────────────────────────────────

function parseKey(key) {
  const match = key.match(/^(.*?)\s+(\d{4})$/);
  return match
    ? { program: match[1], year: parseInt(match[2]) }
    : { program: key, year: null };
}

function buildKey(program, year) {
  return year ? `${program} ${year}` : program;
}

function recalcTotal(org) {
  org.totalFunding = Object.values(org.funding).reduce((s, v) => s + (v || 0), 0);
}

function derivePrograms() {
  const set = new Set(extraPrograms);
  data.forEach(org => Object.keys(org.funding).forEach(k => set.add(parseKey(k).program)));
  return [...set].sort((a, b) => a.localeCompare(b, 'da'));
}

function deriveYears() {
  const set = new Set();
  data.forEach(org =>
    Object.keys(org.funding).forEach(k => {
      const { year } = parseKey(k);
      if (year) set.add(year);
    })
  );
  return [...set].sort();
}

function formatDKK(amount) {
  return new Intl.NumberFormat('da-DK', {
    style: 'currency', currency: 'DKK', maximumFractionDigits: 0
  }).format(amount);
}

// ── Address lookup ──────────────────────────────────────────────
// OpenStreetMap Nominatim: free, no API key. Usage policy allows light use
// (max 1 request/second), so we only search on button/Enter, never per keystroke.

async function geocodeAddress(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'dk',
    viewbox: '12.40,55.75,12.70,55.60', // prefer Copenhagen-area matches
    limit: '5',
    'accept-language': 'da'
  });
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
  if (!res.ok) throw new Error(`Adressesøgning fejlede (${res.status})`);
  const results = await res.json();
  return results.map(r => ({ label: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }));
}

// Wires an address input + "Find" button + results list. Calls onPick({label, lat, lng}).
function setupAddressSearch(inputId, btnId, resultsId, onPick) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const list = document.getElementById(resultsId);

  function pick(result) {
    list.innerHTML = '';
    list.classList.add('hidden');
    onPick(result);
  }

  async function search() {
    const query = input.value.trim();
    if (!query) return showToast('Skriv en adresse', 'error');
    btn.disabled = true;
    btn.textContent = 'Søger…';
    list.innerHTML = '';
    list.classList.add('hidden');
    try {
      const results = await geocodeAddress(query);
      if (results.length === 0) return showToast('Ingen adresse fundet', 'error');
      if (results.length === 1) return pick(results[0]);
      results.forEach(r => {
        const li = document.createElement('li');
        li.textContent = r.label;
        li.addEventListener('click', () => pick(r));
        list.appendChild(li);
      });
      list.classList.remove('hidden');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Find';
    }
  }

  btn.addEventListener('click', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(); }
  });
}

function resetAddressSearch(inputId, resultsId) {
  document.getElementById(inputId).value = '';
  const list = document.getElementById(resultsId);
  list.innerHTML = '';
  list.classList.add('hidden');
}

// ── Persistence (Supabase) ──────────────────────────────────────

async function loadData() {
  data = await loadClubsFromSupabase();
  const { data: rows, error } = await sb.from('programs').select('name');
  if (error) console.warn('Kunne ikke hente puljer:', error.message);
  extraPrograms = new Set((rows || []).map(r => r.name));
}

// ── Club list ────────────────────────────────────────────────────

function renderClubList(filter = '') {
  const ul = document.getElementById('club-list');
  ul.innerHTML = '';
  const term = filter.toLowerCase();

  data.forEach((org, i) => {
    if (term && !org.name.toLowerCase().includes(term)) return;

    const li = document.createElement('li');
    if (i === selectedIndex) li.classList.add('active');

    li.innerHTML = `
      <span class="club-name">${org.name}</span>
      <span class="club-total">${formatDKK(org.totalFunding)}</span>
    `;
    li.addEventListener('click', () => selectClub(i));
    ul.appendChild(li);
  });
}

// ── Club selection ───────────────────────────────────────────────

// Keeps ?club=<id> in the address bar so each recipient has its own link
// (used by the map's "Administrer tilskudsmodtager" button; survives reload).
function setClubInUrl(id) {
  const url = id == null ? location.pathname : `${location.pathname}?club=${encodeURIComponent(id)}`;
  history.replaceState(null, '', url);
}

function selectClub(index) {
  selectedIndex = index;
  setClubInUrl(data[index] && data[index].id);
  renderClubList(document.getElementById('club-search').value);

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('add-club-form').classList.add('hidden');
  document.getElementById('club-editor').classList.remove('hidden');

  renderEditor();
}

function renderEditor() {
  const org = data[selectedIndex];
  if (!org) return;

  document.getElementById('editor-club-name-heading').textContent = org.name;
  document.getElementById('edit-name').value = org.name;
  document.getElementById('edit-lat').value = org.lat;
  document.getElementById('edit-lng').value = org.lng;
  resetAddressSearch('edit-address', 'edit-address-results');

  renderFundingTable(org);
  refreshDropdowns();
}

// ── Funding table ────────────────────────────────────────────────

function renderFundingTable(org) {
  const tbody = document.getElementById('funding-tbody');
  const noMsg = document.getElementById('no-funding-msg');
  tbody.innerHTML = '';

  const entries = Object.entries(org.funding).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    noMsg.classList.remove('hidden');
  } else {
    noMsg.classList.add('hidden');
    entries.forEach(([key, amount]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${key}</td>
        <td>${formatDKK(amount)}</td>
        <td><button class="delete-funding-btn" title="Slet">×</button></td>
      `;
      tr.querySelector('.delete-funding-btn').addEventListener('click', () => deleteFunding(key));
      tbody.appendChild(tr);
    });
  }
}

// ── Dropdowns ────────────────────────────────────────────────────

function refreshDropdowns() {
  const programs = derivePrograms();
  const years = deriveYears();

  const progSel = document.getElementById('program-select');
  const yearSel = document.getElementById('year-select');

  progSel.innerHTML = '';
  programs.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    progSel.appendChild(opt);
  });
  const newProgOpt = document.createElement('option');
  newProgOpt.value = '__new__';
  newProgOpt.textContent = '+ Ny pulje…';
  progSel.appendChild(newProgOpt);

  yearSel.innerHTML = '';
  const noYearOpt = document.createElement('option');
  noYearOpt.value = '';
  noYearOpt.textContent = 'Intet år';
  yearSel.appendChild(noYearOpt);
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearSel.appendChild(opt);
  });
  const newYearOpt = document.createElement('option');
  newYearOpt.value = '__new__';
  newYearOpt.textContent = '+ Nyt år…';
  yearSel.appendChild(newYearOpt);

  toggleNewProgram();
  toggleNewYear();
}

function toggleNewProgram() {
  const sel = document.getElementById('program-select');
  const row = document.getElementById('new-program-row');
  row.classList.toggle('hidden', sel.value !== '__new__');
}

function toggleNewYear() {
  const sel = document.getElementById('year-select');
  const row = document.getElementById('new-year-row');
  row.classList.toggle('hidden', sel.value !== '__new__');
}

// ── Funding mutations ────────────────────────────────────────────

async function addFunding() {
  const progSel = document.getElementById('program-select');
  const yearSel = document.getElementById('year-select');
  const amountInput = document.getElementById('funding-amount');

  let program = progSel.value === '__new__'
    ? document.getElementById('new-program-input').value.trim()
    : progSel.value;

  let year = yearSel.value === '__new__'
    ? parseInt(document.getElementById('new-year-input').value)
    : (yearSel.value ? parseInt(yearSel.value) : null);

  const amount = parseFloat(amountInput.value);

  if (!program) return showToast('Angiv et puljenavn', 'error');
  if (yearSel.value === '__new__' && !year) return showToast('Angiv et gyldigt år', 'error');
  if (!amount || amount <= 0) return showToast('Angiv et beløb større end 0', 'error');

  const org = data[selectedIndex];
  const key = buildKey(program, year);

  // Check if this funding key already exists - if so, update amount
  if (org._fundingIds[key]) {
    const newAmount = org.funding[key] + amount;
    const { error } = await sb.from('funding')
      .update({ amount: newAmount })
      .eq('id', org._fundingIds[key]);
    if (error) return showToast('Fejl: ' + error.message, 'error');
    org.funding[key] = newAmount;
  } else {
    const { data: inserted, error } = await sb.from('funding')
      .insert({ club_id: org.id, program, year, amount })
      .select()
      .single();
    if (error) return showToast('Fejl: ' + error.message, 'error');
    org.funding[key] = amount;
    org._fundingIds[key] = inserted.id;
  }

  recalcTotal(org);
  amountInput.value = '';
  renderEditor();
  renderClubList(document.getElementById('club-search').value);
  showToast('Bevilling tilføjet', 'success');
}

async function deleteFunding(key) {
  const org = data[selectedIndex];
  const fundingId = org._fundingIds[key];

  if (!fundingId) return showToast('Kunne ikke finde bevilling', 'error');

  const { error } = await sb.from('funding').delete().eq('id', fundingId);
  if (error) return showToast('Fejl: ' + error.message, 'error');

  delete org.funding[key];
  delete org._fundingIds[key];
  recalcTotal(org);
  renderEditor();
  renderClubList(document.getElementById('club-search').value);
  showToast('Bevilling slettet', 'success');
}

// ── Club mutations ────────────────────────────────────────────────

async function saveClubDetails() {
  const org = data[selectedIndex];
  const name = document.getElementById('edit-name').value.trim();
  const lat = parseFloat(document.getElementById('edit-lat').value);
  const lng = parseFloat(document.getElementById('edit-lng').value);

  if (!name) return showToast('Navn må ikke være tomt', 'error');
  if (isNaN(lat) || isNaN(lng)) return showToast('Ugyldige koordinater', 'error');

  const { error } = await sb.from('clubs')
    .update({ name, lat, lng })
    .eq('id', org.id);
  if (error) return showToast('Fejl: ' + error.message, 'error');

  org.name = name;
  org.lat = lat;
  org.lng = lng;

  document.getElementById('editor-club-name-heading').textContent = name;
  renderClubList(document.getElementById('club-search').value);
  showToast('Detaljer gemt', 'success');
}

async function deleteClub() {
  const org = data[selectedIndex];
  if (!confirm(`Slet "${org.name}"? Dette kan ikke fortrydes.`)) return;

  const { error } = await sb.from('clubs').delete().eq('id', org.id);
  if (error) return showToast('Fejl: ' + error.message, 'error');

  data.splice(selectedIndex, 1);
  selectedIndex = null;
  setClubInUrl(null);
  renderClubList(document.getElementById('club-search').value);
  document.getElementById('club-editor').classList.add('hidden');
  document.getElementById('empty-state').classList.remove('hidden');
  showToast('Tilskudsmodtager slettet', 'success');
}

async function addClub() {
  const name = document.getElementById('new-club-name').value.trim();
  const lat = parseFloat(document.getElementById('new-lat').value);
  const lng = parseFloat(document.getElementById('new-lng').value);

  if (!name) return showToast('Angiv et navn', 'error');
  if (isNaN(lat) || isNaN(lng)) return showToast('Klik på kortet for at vælge placering', 'error');

  const { data: inserted, error } = await sb.from('clubs')
    .insert({ name, lat, lng })
    .select()
    .single();
  if (error) return showToast('Fejl: ' + error.message, 'error');

  data.push({
    id: inserted.id,
    name, lat, lng,
    totalFunding: 0,
    funding: {},
    _fundingIds: {}
  });

  const newIndex = data.length - 1;
  renderClubList('');
  document.getElementById('club-search').value = '';
  selectClub(newIndex);
  showToast('Tilskudsmodtager oprettet', 'success');
}

// ── Puljer: rename a program across all recipients ────────────────

// Puljer = names in the `programs` table (extraPrograms, may have no funding yet)
// ∪ distinct funding.program. See derivePrograms().

function validateProgramName(name) {
  name = name.trim();
  if (!name) throw new Error('Puljenavnet må ikke være tomt');
  if (/\s\d{4}$/.test(name)) throw new Error('Puljenavnet må ikke slutte med et årstal');
  return name;
}

// Refresh everything that shows puljer after a change. `to` is null when removed.
function notifyProgramChange(from, to) {
  document.dispatchEvent(new CustomEvent('program-changed', { detail: { from, to } }));
  renderClubList(document.getElementById('club-search').value);
  if (selectedIndex != null && data[selectedIndex]) renderEditor();
}

async function addProgram(name) {
  name = validateProgramName(name);
  const existing = derivePrograms().find(p => p.toLowerCase() === name.toLowerCase());
  if (existing) throw new Error(`Puljen "${existing}" findes allerede`);

  const { error } = await sb.from('programs').insert({ name });
  if (error) throw new Error('Fejl: ' + error.message);
  extraPrograms.add(name);
  notifyProgramChange(null, name);
  return name;
}

// Renames `from` → `to` for every recipient.
// Throws an Error with a Danish message if the rename isn't allowed or fails.
async function renameProgram(from, to) {
  to = validateProgramName(to);
  if (to === from) return;

  // Renaming into an existing pulje is fine (merges them), unless a recipient
  // already has both for the same year — that would create a duplicate entry.
  const conflict = data.find(org => Object.keys(org.funding).some(k => {
    const { program, year } = parseKey(k);
    return program === from && org.funding[buildKey(to, year)] !== undefined;
  }));
  if (conflict) {
    throw new Error(`${conflict.name} har allerede bevillinger i både "${from}" og "${to}" for samme år`);
  }

  const { error } = await sb.from('funding').update({ program: to }).eq('program', from);
  if (error) throw new Error('Fejl: ' + error.message);

  if (extraPrograms.has(from)) {
    const { error: e2 } = extraPrograms.has(to)
      ? await sb.from('programs').delete().eq('name', from)   // merging into an existing pulje
      : await sb.from('programs').update({ name: to }).eq('name', from);
    if (e2) throw new Error('Fejl: ' + e2.message);
    extraPrograms.delete(from);
    extraPrograms.add(to);
  }

  data.forEach(org => {
    Object.keys(org.funding).forEach(k => {
      const { program, year } = parseKey(k);
      if (program !== from) return;
      const newKey = buildKey(to, year);
      org.funding[newKey] = org.funding[k];
      org._fundingIds[newKey] = org._fundingIds[k];
      delete org.funding[k];
      delete org._fundingIds[k];
    });
  });

  notifyProgramChange(from, to);
}

// Deletes a pulje and all its funding (after confirmation). Returns false if cancelled.
async function deleteProgram(name) {
  let grants = 0;
  const recipients = new Set();
  data.forEach(org => Object.keys(org.funding).forEach(k => {
    if (parseKey(k).program !== name) return;
    grants++;
    recipients.add(org.id);
  }));

  const question = grants === 0
    ? `Slet puljen "${name}"?`
    : `Slet puljen "${name}"?\n\nDet sletter også ${grants} ${grants === 1 ? 'bevilling' : 'bevillinger'} ` +
      `hos ${recipients.size} ${recipients.size === 1 ? 'tilskudsmodtager' : 'tilskudsmodtagere'}. ` +
      'Det kan ikke fortrydes.';
  if (!confirm(question)) return false;

  if (grants > 0) {
    const { error } = await sb.from('funding').delete().eq('program', name);
    if (error) throw new Error('Fejl: ' + error.message);
  }
  if (extraPrograms.has(name)) {
    const { error } = await sb.from('programs').delete().eq('name', name);
    if (error) throw new Error('Fejl: ' + error.message);
    extraPrograms.delete(name);
  }

  data.forEach(org => {
    let changed = false;
    Object.keys(org.funding).forEach(k => {
      if (parseKey(k).program !== name) return;
      delete org.funding[k];
      delete org._fundingIds[k];
      changed = true;
    });
    if (changed) recalcTotal(org);
  });

  notifyProgramChange(name, null);
  return true;
}

function openProgramsDialog() {
  setProgramsMessage('');
  document.getElementById('program-add-input').value = '';
  renderProgramList();
  document.getElementById('programs-dialog').showModal();
}

// Messages are shown inside the dialog: the toast sits behind a modal dialog.
function setProgramsMessage(text, type = '') {
  const el = document.getElementById('programs-msg');
  el.textContent = text;
  el.className = type;
}

// Runs a dialog action with a busy button, then shows success or error in the dialog.
// `action` returns a success message, or null if nothing happened (e.g. cancelled).
async function runProgramAction(btn, busyText, action) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    const message = await action();
    if (message) {
      renderProgramList();
      setProgramsMessage(message, 'success');
    }
  } catch (e) {
    setProgramsMessage(e.message, 'error');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

function renderProgramList() {
  const ul = document.getElementById('programs-list');
  ul.innerHTML = '';
  const programs = derivePrograms();
  if (programs.length === 0) {
    ul.innerHTML = '<li class="muted">Ingen puljer endnu.</li>';
    return;
  }

  programs.forEach(program => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = program;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn btn-primary btn-sm';
    renameBtn.textContent = 'Omdøb';
    renameBtn.disabled = true;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-sm program-delete';
    deleteBtn.textContent = 'Slet';

    const isChanged = () => {
      const value = input.value.trim();
      return Boolean(value) && value !== program;
    };
    input.addEventListener('input', () => { renameBtn.disabled = !isChanged(); });

    const rename = async () => {
      if (!isChanged()) return;
      const to = input.value.trim();
      await runProgramAction(renameBtn, 'Gemmer…', async () => {
        await renameProgram(program, to);
        return `"${program}" er omdøbt til "${to}"`;
      });
      renameBtn.disabled = !isChanged();
    };
    renameBtn.addEventListener('click', rename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); rename(); }
    });

    deleteBtn.addEventListener('click', () => {
      runProgramAction(deleteBtn, 'Sletter…', async () => {
        const deleted = await deleteProgram(program);
        return deleted ? `Puljen "${program}" er slettet` : null;
      });
    });

    li.append(input, renameBtn, deleteBtn);
    ul.appendChild(li);
  });
}

// ── Add-club form & location map ──────────────────────────────────

function showAddClubForm() {
  selectedIndex = null;
  setClubInUrl(null);
  renderClubList(document.getElementById('club-search').value);

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('club-editor').classList.add('hidden');
  document.getElementById('add-club-form').classList.remove('hidden');

  document.getElementById('new-club-name').value = '';
  document.getElementById('new-lat').value = '';
  document.getElementById('new-lng').value = '';
  document.getElementById('new-lat-display').textContent = '—';
  document.getElementById('new-lng-display').textContent = '—';
  resetAddressSearch('new-address', 'new-address-results');

  if (locationMap) {
    locationMap.remove();
    locationMap = null;
    locationMarker = null;
  }
  locationMap = L.map('location-map', { center: [55.676, 12.568], zoom: 12 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(locationMap);

  data.forEach(org => {
    L.circleMarker([org.lat, org.lng], {
      radius: 4, fillColor: '#aaa', color: '#555', weight: 1,
      fillOpacity: 0.5, interactive: false
    }).addTo(locationMap);
  });

  locationMap.on('click', (e) => setNewClubLocation(e.latlng.lat, e.latlng.lng));
}

function setNewClubLocation(lat, lng) {
  document.getElementById('new-lat').value = lat;
  document.getElementById('new-lng').value = lng;
  document.getElementById('new-lat-display').textContent = lat.toFixed(6);
  document.getElementById('new-lng-display').textContent = lng.toFixed(6);
  if (!locationMap) return;
  if (locationMarker) locationMarker.remove();
  locationMarker = L.circleMarker([lat, lng], {
    radius: 8, fillColor: '#0d6efd', color: '#fff', weight: 2, fillOpacity: 0.9
  }).addTo(locationMap);
}

// ── Toast ─────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2500);
}

// ── Excel export ──────────────────────────────────────────────────

async function exportToExcel() {
  if (data.length === 0) return showToast('Ingen data at eksportere', 'error');

  // Collect all unique funding keys, sorted
  const allKeys = new Set();
  data.forEach(org => Object.keys(org.funding).forEach(k => allKeys.add(k)));
  const sortedKeys = [...allKeys].sort();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tilskudsmodtagere');

  // Define columns
  ws.columns = [
    { header: 'Tilskudsmodtager', key: 'klub', width: 30 },
    ...sortedKeys.map(k => ({ header: k, key: k, width: 16 })),
    { header: 'Total', key: 'total', width: 18 }
  ];

  // Add data rows
  data.forEach(org => {
    const row = { klub: org.name, total: 0 };
    sortedKeys.forEach(key => {
      const amt = org.funding[key] || 0;
      if (amt) row[key] = amt;
      row.total += amt;
    });
    ws.addRow(row);
  });

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C5F8A' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 28;

  // Style data rows and format numbers
  const dkkFormat = '#,##0 "kr."';
  for (let r = 2; r <= data.length + 1; r++) {
    const row = ws.getRow(r);
    row.alignment = { vertical: 'middle' };
    row.height = 22;

    // Zebra striping
    if (r % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6FA' } };
    }

    // Format amount cells
    for (let c = 2; c <= sortedKeys.length + 2; c++) {
      const cell = row.getCell(c);
      if (cell.value) cell.numFmt = dkkFormat;
    }

    // Bold the total column
    row.getCell(sortedKeys.length + 2).font = { bold: true };
  }

  // Borders for all cells
  const lastCol = sortedKeys.length + 2;
  const lastRow = data.length + 1;
  const thinBorder = { style: 'thin', color: { argb: 'FFD0D0D0' } };
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      ws.getRow(r).getCell(c).border = {
        top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder
      };
    }
  }

  // Auto-filter on header
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastCol } };

  // Freeze top row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Download
  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'tilskudsmodtagere.xlsx');
  showToast('Excel-fil downloadet', 'success');
}

// ── Init ──────────────────────────────────────────────────────────

(async function init() {
  try {
    await loadData();
  } catch (e) {
    showToast('Fejl ved indlæsning: ' + e.message, 'error');
    return;
  }
  renderClubList();

  // Opened via "Administrer tilskudsmodtager" on the map → select that recipient
  const linkedId = new URLSearchParams(location.search).get('club');
  const linkedIndex = linkedId ? data.findIndex(org => String(org.id) === linkedId) : -1;
  if (linkedIndex >= 0) {
    selectClub(linkedIndex);
    const li = document.querySelector('#club-list li.active');
    if (li) li.scrollIntoView({ block: 'center' });
  }
  if (linkedId && linkedIndex < 0) setClubInUrl(null); // unknown id → clean URL
  document.dispatchEvent(new CustomEvent('clubs-loaded', { detail: { forceList: linkedIndex >= 0 } }));

  // Puljer dialog (rename a pulje across all recipients)
  document.getElementById('programs-btn').addEventListener('click', openProgramsDialog);
  document.getElementById('programs-close').addEventListener('click', () => {
    document.getElementById('programs-dialog').close();
  });
  document.getElementById('program-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('program-add-input');
    const btn = e.target.querySelector('button');
    runProgramAction(btn, 'Tilføjer…', async () => {
      const name = await addProgram(input.value);
      input.value = '';
      return `Puljen "${name}" er tilføjet`;
    });
  });

  // Club search
  document.getElementById('club-search').addEventListener('input', (e) => {
    renderClubList(e.target.value);
  });

  // Export to Excel
  document.getElementById('export-excel-btn').addEventListener('click', exportToExcel);

  // Add club button
  document.getElementById('add-club-btn').addEventListener('click', showAddClubForm);

  // Club detail save
  document.getElementById('save-details-btn').addEventListener('click', saveClubDetails);

  // Delete club
  document.getElementById('delete-club-btn').addEventListener('click', deleteClub);

  // Funding dropdowns
  document.getElementById('program-select').addEventListener('change', toggleNewProgram);
  document.getElementById('year-select').addEventListener('change', toggleNewYear);

  // Add funding
  document.getElementById('add-funding-btn').addEventListener('click', addFunding);

  // Confirm add club
  document.getElementById('confirm-add-club-btn').addEventListener('click', addClub);

  // Address → coordinates (new club): place marker and zoom in; map click still adjusts
  setupAddressSearch('new-address', 'new-address-btn', 'new-address-results', ({ lat, lng }) => {
    setNewClubLocation(lat, lng);
    if (locationMap) locationMap.setView([lat, lng], 16);
  });

  // Address → coordinates (edit club): fill lat/lng and save right away
  setupAddressSearch('edit-address', 'edit-address-btn', 'edit-address-results', ({ lat, lng }) => {
    document.getElementById('edit-lat').value = lat;
    document.getElementById('edit-lng').value = lng;
    saveClubDetails();
  });

  // Cancel add club
  document.getElementById('cancel-add-club-btn').addEventListener('click', () => {
    document.getElementById('add-club-form').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    selectedIndex = null;
    setClubInUrl(null);
    renderClubList(document.getElementById('club-search').value);
    if (locationMap) { locationMap.remove(); locationMap = null; }
  });
})();
