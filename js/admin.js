// ── State ──────────────────────────────────────────────────────
let data = [];
let selectedIndex = null;
let isDirty = false;
let locationMap = null;
let locationMarker = null;

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
  const set = new Set();
  data.forEach(org => Object.keys(org.funding).forEach(k => set.add(parseKey(k).program)));
  return [...set].sort();
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

// ── Persistence ─────────────────────────────────────────────────

async function loadData() {
  const res = await fetch('data/data.json');
  data = await res.json();
}

async function saveData() {
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    isDirty = false;
    updateSaveBtn();
    showToast('Gemt!', 'success');
  } catch (e) {
    showToast('Fejl ved gem: ' + e.message, 'error');
  }
}

// ── Dirty state ──────────────────────────────────────────────────

function markDirty() {
  isDirty = true;
  updateSaveBtn();
}

function updateSaveBtn() {
  const btn = document.getElementById('save-btn');
  const status = document.getElementById('save-status');
  btn.disabled = !isDirty;
  status.textContent = isDirty ? 'Ugemte ændringer' : '';
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

function selectClub(index) {
  selectedIndex = index;
  renderClubList(document.getElementById('club-search').value);

  // Hide add-club form, show editor
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

  // Trigger visibility logic
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

function addFunding() {
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

  const key = buildKey(program, year);
  const org = data[selectedIndex];

  if (org.funding[key] !== undefined) {
    org.funding[key] += amount;
  } else {
    org.funding[key] = amount;
  }
  recalcTotal(org);

  amountInput.value = '';
  markDirty();
  renderEditor();
  renderClubList(document.getElementById('club-search').value);
}

function deleteFunding(key) {
  const org = data[selectedIndex];
  delete org.funding[key];
  recalcTotal(org);
  markDirty();
  renderEditor();
  renderClubList(document.getElementById('club-search').value);
}

// ── Club mutations ────────────────────────────────────────────────

function saveClubDetails() {
  const org = data[selectedIndex];
  const name = document.getElementById('edit-name').value.trim();
  const lat = parseFloat(document.getElementById('edit-lat').value);
  const lng = parseFloat(document.getElementById('edit-lng').value);

  if (!name) return showToast('Navn må ikke være tomt', 'error');
  if (isNaN(lat) || isNaN(lng)) return showToast('Ugyldige koordinater', 'error');

  org.name = name;
  org.lat = lat;
  org.lng = lng;

  markDirty();
  document.getElementById('editor-club-name-heading').textContent = name;
  renderClubList(document.getElementById('club-search').value);
  showToast('Detaljer opdateret', 'success');
}

function deleteClub() {
  const org = data[selectedIndex];
  if (!confirm(`Slet "${org.name}"? Dette kan ikke fortrydes.`)) return;
  data.splice(selectedIndex, 1);
  selectedIndex = null;
  markDirty();
  renderClubList(document.getElementById('club-search').value);
  document.getElementById('club-editor').classList.add('hidden');
  document.getElementById('empty-state').classList.remove('hidden');
}

function addClub() {
  const name = document.getElementById('new-club-name').value.trim();
  const lat = parseFloat(document.getElementById('new-lat').value);
  const lng = parseFloat(document.getElementById('new-lng').value);

  if (!name) return showToast('Angiv et navn', 'error');
  if (isNaN(lat) || isNaN(lng)) return showToast('Klik på kortet for at vælge placering', 'error');

  data.push({ name, lat, lng, totalFunding: 0, funding: {} });
  markDirty();

  const newIndex = data.length - 1;
  renderClubList('');
  document.getElementById('club-search').value = '';
  selectClub(newIndex);
}

// ── Add-club form & location map ──────────────────────────────────

function showAddClubForm() {
  selectedIndex = null;
  renderClubList(document.getElementById('club-search').value);

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('club-editor').classList.add('hidden');
  document.getElementById('add-club-form').classList.remove('hidden');

  document.getElementById('new-club-name').value = '';
  document.getElementById('new-lat').value = '';
  document.getElementById('new-lng').value = '';
  document.getElementById('new-lat-display').textContent = '—';
  document.getElementById('new-lng-display').textContent = '—';

  // Init or reset mini map
  if (locationMap) {
    locationMap.remove();
    locationMap = null;
    locationMarker = null;
  }
  locationMap = L.map('location-map', { center: [55.676, 12.568], zoom: 12 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(locationMap);

  // Show existing clubs as grey dots for context
  data.forEach(org => {
    L.circleMarker([org.lat, org.lng], {
      radius: 4, fillColor: '#aaa', color: '#555', weight: 1,
      fillOpacity: 0.5, interactive: false
    }).addTo(locationMap);
  });

  locationMap.on('click', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById('new-lat').value = lat;
    document.getElementById('new-lng').value = lng;
    document.getElementById('new-lat-display').textContent = lat.toFixed(6);
    document.getElementById('new-lng-display').textContent = lng.toFixed(6);
    if (locationMarker) locationMarker.remove();
    locationMarker = L.circleMarker([lat, lng], {
      radius: 8, fillColor: '#0d6efd', color: '#fff', weight: 2, fillOpacity: 0.9
    }).addTo(locationMap);
  });
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

// ── Warn on unload ────────────────────────────────────────────────

window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Init ──────────────────────────────────────────────────────────

(async function init() {
  await loadData();
  renderClubList();
  updateSaveBtn();

  // Club search
  document.getElementById('club-search').addEventListener('input', (e) => {
    renderClubList(e.target.value);
  });

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

  // Cancel add club
  document.getElementById('cancel-add-club-btn').addEventListener('click', () => {
    document.getElementById('add-club-form').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    selectedIndex = null;
    renderClubList(document.getElementById('club-search').value);
    if (locationMap) { locationMap.remove(); locationMap = null; }
  });

  // Global save
  document.getElementById('save-btn').addEventListener('click', saveData);
})();
