// ── Spreadsheet view ("Regneark") ─────────────────────────────────
// Edits all clubs at once in an Excel-like grid. Reuses globals from
// admin.js (data, parseKey, buildKey, recalcTotal, showToast, …) and sb.

(function () {
  const appEl = document.getElementById('app');
  const sheetView = document.getElementById('sheet-view');
  const wrap = document.getElementById('sheet-wrap');
  const table = document.getElementById('sheet');
  const thead = table.tHead;
  const tbody = table.tBodies[0];
  const tfoot = table.tFoot;
  const searchInput = document.getElementById('sheet-search');
  const statusEl = document.getElementById('save-status');
  const listBtn = document.getElementById('view-list-btn');
  const sheetBtn = document.getElementById('view-sheet-btn');

  const amountFmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 });
  const plainFmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2, useGrouping: false });
  const coordFmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 6, useGrouping: false });

  // ── State ──
  let columns = [];          // [{ type: 'name'|'lat'|'lng'|'fund'|'total', key?, label }]
  let rows = [];             // club objects from `data`, plus optional draft
  let active = { r: 0, c: 0 };
  let editor = null;         // { input, td, r, c }
  let draft = null;          // { draft: true, name, lat, lng, org? }
  const knownKeys = new Set(); // funding columns seen this session (keeps layout stable)

  // ── Helpers ──
  const esc = (s) => String(s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  function isVisible() { return !sheetView.classList.contains('hidden'); }

  function compareKeys(a, b) {
    const pa = parseKey(a), pb = parseKey(b);
    const byProgram = pa.program.localeCompare(pb.program, 'da');
    return byProgram || (pa.year || 0) - (pb.year || 0);
  }

  function buildColumns() {
    data.forEach(org => Object.keys(org.funding).forEach(k => knownKeys.add(k)));
    const keys = [...knownKeys].sort(compareKeys);
    return [
      { type: 'name', label: 'Navn' },
      { type: 'lat', label: 'Lat' },
      { type: 'lng', label: 'Lng' },
      ...keys.map(key => ({ type: 'fund', key, label: key })),
      { type: 'total', label: 'Total' }
    ];
  }

  function colClass(col) {
    const cls = [];
    if (col.type !== 'name') cls.push('num');
    if (col.type === 'total') cls.push('readonly');
    return cls.join(' ');
  }

  function display(row, col) {
    switch (col.type) {
      case 'name': return row.name;
      case 'lat':
      case 'lng': return row[col.type] == null ? '' : coordFmt.format(row[col.type]);
      case 'fund': {
        if (row.draft) return '';
        const amt = row.funding[col.key];
        return amt == null ? '' : amountFmt.format(amt);
      }
      case 'total': return row.draft ? '' : amountFmt.format(row.totalFunding);
    }
  }

  // Value shown when editing / copying (no thousands separators)
  function rawValue(row, col) {
    switch (col.type) {
      case 'name': return row.name;
      case 'lat':
      case 'lng': return row[col.type] == null ? '' : coordFmt.format(row[col.type]);
      case 'fund': {
        if (row.draft) return '';
        const amt = row.funding[col.key];
        return amt == null ? '' : plainFmt.format(amt);
      }
      case 'total': return row.draft ? '' : plainFmt.format(row.totalFunding);
    }
  }

  // Danish amount: "15.000", "15000", "1.500,50 kr." → number. Empty → 0.
  function parseAmount(raw) {
    let s = raw.replace(/kr\.?/gi, '').replace(/\s/g, '');
    if (s === '') return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  function parseCoord(raw, type) {
    const n = Number(raw.replace(',', '.'));
    const max = type === 'lat' ? 90 : 180;
    return raw !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : NaN;
  }

  function cellEl(r, c) {
    const tr = tbody.rows[r];
    return tr && tr.cells[c];
  }

  // ── Save status in header ──
  let pending = 0;
  let statusTimer = null;
  function beginSave() {
    pending++;
    clearTimeout(statusTimer);
    statusEl.textContent = 'Gemmer…';
  }
  function endSave() {
    pending = Math.max(0, pending - 1);
    if (pending) return;
    statusEl.textContent = 'Alle ændringer gemt';
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  // ── Rendering ──
  function render() {
    columns = buildColumns();
    const term = searchInput.value.trim().toLowerCase();
    rows = data.filter(org => !term || org.name.toLowerCase().includes(term));
    if (draft) rows.push(draft);

    thead.innerHTML = '<tr>' + columns.map((col, c) =>
      `<th data-c="${c}" class="${colClass(col)}">${esc(col.label)}</th>`
    ).join('') + '</tr>';

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td class="sheet-empty" colspan="${columns.length}">Ingen tilskudsmodtagere</td></tr>`;
    } else {
      tbody.innerHTML = rows.map((row, r) =>
        `<tr${row.draft ? ' class="draft"' : ''}>` + columns.map((col, c) =>
          `<td data-r="${r}" data-c="${c}" class="${colClass(col)}">${esc(display(row, col))}</td>`
        ).join('') + '</tr>'
      ).join('');
    }

    renderFooter();
    active.r = Math.min(Math.max(active.r, 0), Math.max(rows.length - 1, 0));
    active.c = Math.min(Math.max(active.c, 0), columns.length - 1);
    markActive(false);
  }

  function renderFooter() {
    const cells = columns.map(col => {
      if (col.type === 'name') return `<td>Total (${rows.filter(r => !r.draft).length} tilskudsmodtagere)</td>`;
      if (col.type === 'lat' || col.type === 'lng') return '<td></td>';
      const sum = rows.reduce((s, row) => {
        if (row.draft) return s;
        return s + (col.type === 'total' ? row.totalFunding : (row.funding[col.key] || 0));
      }, 0);
      return `<td class="num">${amountFmt.format(sum)}</td>`;
    });
    tfoot.innerHTML = '<tr>' + cells.join('') + '</tr>';
  }

  function refreshRow(row) {
    const r = rows.indexOf(row);
    if (r < 0) return;
    columns.forEach((col, c) => {
      const td = cellEl(r, c);
      if (!td || (editor && editor.td === td)) return;
      td.textContent = display(row, col);
    });
  }

  function flash(row, col) {
    const td = cellEl(rows.indexOf(row), columns.indexOf(col));
    if (!td) return;
    td.classList.remove('saved');
    void td.offsetWidth; // restart animation
    td.classList.add('saved');
  }

  // ── Selection & navigation ──
  function markActive(scroll = true) {
    tbody.querySelectorAll('td.active').forEach(td => td.classList.remove('active'));
    tbody.querySelectorAll('tr.row-active').forEach(tr => tr.classList.remove('row-active'));
    thead.querySelectorAll('th.col-active').forEach(th => th.classList.remove('col-active'));
    if (!rows.length) return;

    const td = cellEl(active.r, active.c);
    if (!td) return;
    td.classList.add('active');
    td.parentElement.classList.add('row-active');
    const th = thead.rows[0].cells[active.c];
    if (th) th.classList.add('col-active');
    if (scroll) ensureVisible(td);
  }

  // Scroll so the cell isn't hidden behind the sticky header/footer/name column
  function ensureVisible(td) {
    const w = wrap.getBoundingClientRect();
    const b = td.getBoundingClientRect();
    const top = w.top + wrap.clientTop + thead.offsetHeight;
    const bottom = w.top + wrap.clientTop + wrap.clientHeight - tfoot.offsetHeight;
    const left = w.left + wrap.clientLeft + (active.c > 0 ? cellEl(active.r, 0).offsetWidth : 0);
    const right = w.left + wrap.clientLeft + wrap.clientWidth;

    if (b.top < top) wrap.scrollTop -= top - b.top;
    else if (b.bottom > bottom) wrap.scrollTop += b.bottom - bottom;
    if (active.c === 0) return;
    if (b.left < left) wrap.scrollLeft -= left - b.left;
    else if (b.right > right) wrap.scrollLeft += b.right - right;
  }

  function select(r, c) {
    if (!rows.length) return;
    active.r = Math.min(Math.max(r, 0), rows.length - 1);
    active.c = Math.min(Math.max(c, 0), columns.length - 1);
    markActive();
  }

  function move(dr, dc) { select(active.r + dr, active.c + dc); }

  function moveTab(dir) {
    let { r, c } = active;
    c += dir;
    if (c >= columns.length) { c = 0; r++; }
    if (c < 0) { c = columns.length - 1; r--; }
    if (r < 0 || r >= rows.length) return;
    select(r, c);
  }

  // ── Editing ──
  function startEdit(initial) {
    if (!rows.length || editor) return;
    const row = rows[active.r];
    const col = columns[active.c];
    if (col.type === 'total') return;
    if (row.draft && col.type === 'fund') {
      return showToast('Udfyld navn, lat og lng først', 'error');
    }

    const td = cellEl(active.r, active.c);
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.type = 'text';
    if (col.type !== 'name') input.inputMode = 'decimal';
    input.value = initial !== undefined ? initial : rawValue(row, col);

    td.classList.add('editing');
    td.appendChild(input);
    editor = { input, td, r: active.r, c: active.c };
    input.focus();
    if (initial === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', onEditorKey);
    input.addEventListener('blur', () => { if (editor && editor.input === input) commitEdit(); });
  }

  function closeEditor() {
    const { input, td } = editor;
    editor = null;
    input.remove();
    td.classList.remove('editing');
    if (isVisible()) wrap.focus({ preventScroll: true });
  }

  function commitEdit() {
    if (!editor) return;
    const { input, r, c } = editor;
    const row = rows[r], col = columns[c];
    const value = input.value;
    closeEditor();
    if (value.trim() !== rawValue(row, col)) setCell(row, col, value);
  }

  function cancelEdit() {
    if (!editor) return;
    closeEditor();
    if (rows[active.r] === draft && isDraftEmpty()) removeDraft();
  }

  function onEditorKey(e) {
    e.stopPropagation();
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        commitEdit();
        move(e.shiftKey ? -1 : 1, 0);
        break;
      case 'Tab':
        e.preventDefault();
        commitEdit();
        moveTab(e.shiftKey ? -1 : 1);
        break;
      case 'Escape':
        e.preventDefault();
        cancelEdit();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        commitEdit();
        move(e.key === 'ArrowUp' ? -1 : 1, 0);
        break;
    }
  }

  // ── Saving ──
  // Saves to the same cell (or the same draft) run one after another, so a
  // fast second edit can't create a duplicate funding row or club.
  const queues = new Map();
  function setCell(row, col, raw) {
    const qkey = row.draft ? 'draft' : `${row.id}|${col.key || col.type}`;
    const prev = queues.get(qkey) || Promise.resolve();
    const next = prev.then(() => doSetCell(row, col, String(raw ?? '').trim()));
    queues.set(qkey, next.catch(() => {}));
    return next;
  }

  function fail(msg, row) {
    showToast(msg, 'error');
    refreshRow(row);
    return false;
  }

  async function persist(row, col, request, apply) {
    beginSave();
    const { data: result, error } = await request;
    endSave();
    if (error) return fail('Fejl: ' + error.message, row);
    apply(result);
    refreshRow(row);
    renderFooter();
    flash(row, col);
    return true;
  }

  async function doSetCell(row, col, raw) {
    if (row.draft && row.org) row = row.org; // draft was saved meanwhile
    if (row.draft) return setDraftCell(row, col, raw);
    if (col.type === 'total') return false;

    if (col.type === 'name') {
      if (!raw) return fail('Navn må ikke være tomt', row);
      if (raw === row.name) return true;
      return persist(row, col,
        sb.from('clubs').update({ name: raw }).eq('id', row.id),
        () => { row.name = raw; });
    }

    if (col.type === 'lat' || col.type === 'lng') {
      const n = parseCoord(raw, col.type);
      if (isNaN(n)) return fail(`Ugyldig ${col.label.toLowerCase()}: "${raw}"`, row);
      if (n === row[col.type]) return true;
      return persist(row, col,
        sb.from('clubs').update({ [col.type]: n }).eq('id', row.id),
        () => { row[col.type] = n; });
    }

    // Funding cell
    const amount = parseAmount(raw);
    if (isNaN(amount)) return fail(`Ugyldigt beløb: "${raw}"`, row);
    const key = col.key;
    const id = row._fundingIds[key];

    if (amount === 0) {
      if (!id) { refreshRow(row); return true; }
      return persist(row, col,
        sb.from('funding').delete().eq('id', id),
        () => { delete row.funding[key]; delete row._fundingIds[key]; recalcTotal(row); });
    }
    if (id) {
      if (amount === row.funding[key]) return true;
      return persist(row, col,
        sb.from('funding').update({ amount }).eq('id', id),
        () => { row.funding[key] = amount; recalcTotal(row); });
    }
    const { program, year } = parseKey(key);
    return persist(row, col,
      sb.from('funding').insert({ club_id: row.id, program, year, amount }).select().single(),
      (inserted) => { row.funding[key] = amount; row._fundingIds[key] = inserted.id; recalcTotal(row); });
  }

  // ── Draft row (new club) ──
  function isDraftEmpty() {
    return draft && !draft.name && draft.lat == null && draft.lng == null;
  }

  function removeDraft() {
    draft = null;
    render();
  }

  function addRow() {
    if (editor) commitEdit();
    if (!draft) {
      draft = { draft: true, name: '', lat: null, lng: null };
      render();
    }
    select(rows.indexOf(draft), 0);
    startEdit();
  }

  async function setDraftCell(row, col, raw) {
    if (col.type === 'fund' || col.type === 'total') {
      return fail('Udfyld navn, lat og lng først', row);
    }
    if (col.type === 'name') {
      row.name = raw;
    } else {
      const n = raw === '' ? null : parseCoord(raw, col.type);
      if (Number.isNaN(n)) return fail(`Ugyldig ${col.label.toLowerCase()}: "${raw}"`, row);
      row[col.type] = n;
    }
    refreshRow(row);

    if (!row.name || row.lat == null || row.lng == null) return true;

    // All required fields filled → create the club
    beginSave();
    const { data: inserted, error } = await sb.from('clubs')
      .insert({ name: row.name, lat: row.lat, lng: row.lng })
      .select()
      .single();
    endSave();
    if (error) return fail('Fejl: ' + error.message, row);

    const org = {
      id: inserted.id,
      name: row.name, lat: row.lat, lng: row.lng,
      totalFunding: 0,
      funding: {},
      _fundingIds: {}
    };
    data.push(org);
    row.org = org;

    // Promote the draft row in place (keeps any open editor intact)
    const r = rows.indexOf(row);
    if (draft === row) draft = null;
    if (r >= 0) {
      rows[r] = org;
      tbody.rows[r].classList.remove('draft');
      refreshRow(org);
    }
    renderFooter();
    flash(org, columns[0]);
    showToast('Tilskudsmodtager oprettet', 'success');
    return true;
  }

  // ── New funding column ──
  function addColumn() {
    if (editor) commitEdit();
    const input = prompt('Pulje og år, f.eks. "AFF 2025":');
    if (!input || !input.trim()) return;
    const { program, year } = parseKey(input.trim());
    const key = buildKey(program, year);
    knownKeys.add(key);
    render();
    select(active.r, columns.findIndex(col => col.key === key));
    wrap.focus({ preventScroll: true });
  }

  // ── Keyboard (when not editing) ──
  wrap.addEventListener('keydown', (e) => {
    if (editor || !rows.length || e.target !== wrap) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const lastR = rows.length - 1, lastC = columns.length - 1;
    const handled = () => e.preventDefault();

    switch (e.key) {
      case 'ArrowUp':    handled(); return ctrl ? select(0, active.c) : move(-1, 0);
      case 'ArrowDown':  handled(); return ctrl ? select(lastR, active.c) : move(1, 0);
      case 'ArrowLeft':  handled(); return ctrl ? select(active.r, 0) : move(0, -1);
      case 'ArrowRight': handled(); return ctrl ? select(active.r, lastC) : move(0, 1);
      case 'PageUp':     handled(); return move(-10, 0);
      case 'PageDown':   handled(); return move(10, 0);
      case 'Home':       handled(); return ctrl ? select(0, 0) : select(active.r, 0);
      case 'End':        handled(); return ctrl ? select(lastR, lastC) : select(active.r, lastC);
      case 'Tab':        handled(); return moveTab(e.shiftKey ? -1 : 1);
      case 'Enter':
      case 'F2':         handled(); return startEdit();
      case 'Escape':
        if (rows[active.r] === draft && isDraftEmpty()) { handled(); removeDraft(); }
        return;
      case 'Delete':
      case 'Backspace': {
        handled();
        const row = rows[active.r], col = columns[active.c];
        if (col.type === 'total') return;
        if (!row.draft && col.type !== 'fund') {
          return showToast('Navn og koordinater kan ikke være tomme', 'error');
        }
        if (rawValue(row, col) !== '') setCell(row, col, '');
        return;
      }
    }

    // Typing a character starts editing with that character (like Excel)
    if (e.key.length === 1 && !ctrl && !e.altKey) {
      handled();
      startEdit(e.key);
    }
  });

  // ── Mouse ──
  let clickedActive = false;
  let lastClick = null; // cell of the previous click; reset by keyboard navigation
  wrap.addEventListener('keydown', () => { lastClick = null; }, true);
  tbody.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td || (editor && editor.td === td)) return;
    const r = +td.dataset.r, c = +td.dataset.c;
    clickedActive = !editor && lastClick && lastClick.r === r && lastClick.c === c &&
      r === active.r && c === active.c;
    lastClick = { r, c };
    if (editor) commitEdit();
    select(r, c);
  });
  tbody.addEventListener('click', (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td || editor) return;
    // Second click on the selected cell edits (handy on touch devices)
    if (clickedActive) startEdit();
    else wrap.focus({ preventScroll: true });
    clickedActive = false;
  });
  tbody.addEventListener('dblclick', (e) => {
    if (e.target.closest('td[data-r]') && !editor) startEdit();
  });

  // ── Clipboard ──
  document.addEventListener('copy', (e) => {
    if (!isVisible() || editor || document.activeElement !== wrap || !rows.length) return;
    e.clipboardData.setData('text/plain', rawValue(rows[active.r], columns[active.c]));
    e.preventDefault();
    showToast('Kopieret', 'success');
  });

  document.addEventListener('paste', async (e) => {
    if (!isVisible() || editor || document.activeElement !== wrap || !rows.length) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();

    // Tab-separated block, as copied from Excel
    const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
    const jobs = [];
    grid.forEach((cells, dr) => cells.forEach((value, dc) => {
      const row = rows[active.r + dr], col = columns[active.c + dc];
      if (!row || !col || col.type === 'total') return;
      jobs.push(setCell(row, col, value));
    }));
    if (!jobs.length) return;

    const results = await Promise.all(jobs);
    const ok = results.filter(Boolean).length;
    showToast(`${ok} af ${results.length} celler indsat`, ok === results.length ? 'success' : 'error');
  });

  // ── Toolbar ──
  searchInput.addEventListener('input', () => {
    if (editor) commitEdit();
    active.r = 0;
    render();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      wrap.focus({ preventScroll: true });
    }
  });
  document.getElementById('sheet-add-row-btn').addEventListener('click', addRow);
  document.getElementById('sheet-add-col-btn').addEventListener('click', addColumn);

  // ── View toggle ──
  function showView(view) {
    const sheet = view === 'sheet';
    if (!sheet && editor) commitEdit();
    appEl.classList.toggle('hidden', sheet);
    sheetView.classList.toggle('hidden', !sheet);
    listBtn.classList.toggle('on', !sheet);
    sheetBtn.classList.toggle('on', sheet);

    if (sheet) {
      setClubInUrl(null); // ?club= would force the list view on reload
      render();
      wrap.focus({ preventScroll: true });
    } else {
      // Data may have changed in the sheet — refresh the list/editor
      renderClubList(document.getElementById('club-search').value);
      if (selectedIndex != null && data[selectedIndex]) {
        setClubInUrl(data[selectedIndex].id);
        renderEditor();
      }
    }
    try { localStorage.setItem('adminView', view); } catch (_) { /* ignore */ }
  }

  listBtn.addEventListener('click', () => showView('list'));
  sheetBtn.addEventListener('click', () => showView('sheet'));

  // A pulje was renamed or deleted (admin.js) → rename/remove its columns too
  document.addEventListener('program-changed', (e) => {
    const { from, to } = e.detail;
    if (from == null) return; // added: no columns until it gets funding
    [...knownKeys].forEach(k => {
      const { program, year } = parseKey(k);
      if (program !== from) return;
      knownKeys.delete(k);
      if (to != null) knownKeys.add(buildKey(to, year));
    });
    if (isVisible()) render();
  });

  // Restore last view once data is loaded (event fired by admin.js init).
  // Stay in the list view when opened from the map for a specific recipient.
  document.addEventListener('clubs-loaded', (e) => {
    if (e.detail && e.detail.forceList) return;
    let saved = null;
    try { saved = localStorage.getItem('adminView'); } catch (_) { /* ignore */ }
    if (saved === 'sheet' || isVisible()) showView('sheet');
  });
})();
