(async function() {
  // ========== CONFIGURATION ==========
  const CONFIG = {
    center: [55.676, 12.568],
    zoom: 12,
    minZoom: 11,
    maxZoom: 18,
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  };

  // Color scale: 6-step logarithmic OrRd
  const COLOR_STEPS = [
    { min: 0,       max: 10000,    color: '#fee5d9', label: '< 10.000' },
    { min: 10000,   max: 50000,    color: '#fcbba1', label: '10.000 – 50.000' },
    { min: 50000,   max: 200000,   color: '#fc9272', label: '50.000 – 200.000' },
    { min: 200000,  max: 1000000,  color: '#fb6a4a', label: '200.000 – 1.000.000' },
    { min: 1000000, max: 5000000,  color: '#de2d26', label: '1.000.000 – 5.000.000' },
    { min: 5000000, max: Infinity, color: '#a50f15', label: '> 5.000.000' },
  ];

  // Derive columns from data so newly added programs/years appear automatically
  function deriveColumns(orgs) {
    const keySet = new Set();
    orgs.forEach(org => Object.keys(org.funding || {}).forEach(k => keySet.add(k)));
    return [...keySet].sort().map(key => {
      const match = key.match(/^(.*?)\s+(\d{4})$/);
      return match
        ? { key, program: match[1], year: parseInt(match[2]) }
        : { key, program: key, year: null };
    });
  }

  // ========== UTILITIES ==========
  function formatDKK(amount) {
    return new Intl.NumberFormat('da-DK', {
      style: 'currency',
      currency: 'DKK',
      maximumFractionDigits: 0
    }).format(amount);
  }

  function getColor(amount) {
    if (amount <= 0) return '#cccccc';
    for (const step of COLOR_STEPS) {
      if (amount >= step.min && amount < step.max) return step.color;
    }
    return COLOR_STEPS[COLOR_STEPS.length - 1].color;
  }

  function getRadius(amount) {
    if (amount <= 0) return 5;
    const logMin = Math.log10(1000);
    const logMax = Math.log10(10000000);
    const logVal = Math.log10(Math.max(amount, 1000));
    const t = Math.max(0, Math.min(1, (logVal - logMin) / (logMax - logMin)));
    return 5 + t * 14;
  }

  // ========== LOAD DATA ==========
  let data;
  try {
    const response = await fetch('data/data.json');
    data = await response.json();
  } catch (e) {
    document.getElementById('map').innerHTML =
      '<div style="padding:40px;color:#dc3545;font-size:15px">' +
      '<strong>Fejl:</strong> Kunne ikke indlæse data.json.<br><br>' +
      'Åbn siden via serveren: <code>http://localhost:8000</code><br>' +
      '(ikke som en lokal fil i browseren)</div>';
    return;
  }

  const COLUMNS = deriveColumns(data);
  const PROGRAMS = [...new Set(COLUMNS.map(c => c.program))];
  const YEARS = [...new Set(COLUMNS.map(c => c.year).filter(y => y !== null))].sort();

  // ========== MAP INIT ==========
  const map = L.map('map', {
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
  });
  L.tileLayer(CONFIG.tileUrl, { attribution: CONFIG.tileAttribution }).addTo(map);

  // ========== CREATE MARKERS ==========
  const markersLayer = L.layerGroup().addTo(map);
  const markers = [];

  data.forEach(org => {
    const circle = L.circleMarker([org.lat, org.lng], {
      radius: getRadius(org.totalFunding),
      fillColor: getColor(org.totalFunding),
      color: '#333',
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.7,
    });

    circle.bindTooltip(
      `<strong>${org.name}</strong><br>I alt: ${formatDKK(org.totalFunding)}`,
      { sticky: true }
    );

    circle.on('click', () => showDetail(org));
    circle.addTo(markersLayer);
    markers.push({ org, circle });
  });

  // ========== BUILD FILTER UI ==========
  const programFiltersEl = document.getElementById('program-filters');
  PROGRAMS.forEach(p => {
    const id = 'prog-' + p.replace(/[^a-zA-Z0-9]/g, '_');
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" id="${id}" checked data-program="${p}" /> ${p}`;
    programFiltersEl.appendChild(label);
  });

  const yearFiltersEl = document.getElementById('year-filters');
  YEARS.forEach(y => {
    const id = 'year-' + y;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" id="${id}" checked data-year="${y}" /> ${y}`;
    yearFiltersEl.appendChild(label);
  });

  // ========== BUILD LEGEND ==========
  const legendItems = document.getElementById('legend-items');
  COLOR_STEPS.forEach(step => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-swatch" style="background:${step.color}"></span> ${step.label} DKK`;
    legendItems.appendChild(row);
  });

  // Note about missing orgs
  const totalInXlsx = 103;
  const totalOnMap = data.length;
  if (totalInXlsx > totalOnMap) {
    document.getElementById('missing-note').textContent =
      `${totalInXlsx - totalOnMap} klubber uden koordinater er ikke vist på kortet.`;
  }

  // ========== FILTER LOGIC ==========
  function getActiveColumns() {
    const activePrograms = new Set();
    document.querySelectorAll('#program-filters input:checked').forEach(cb => {
      activePrograms.add(cb.dataset.program);
    });

    const activeYears = new Set();
    document.querySelectorAll('#year-filters input:checked').forEach(cb => {
      activeYears.add(parseInt(cb.dataset.year));
    });

    return COLUMNS.filter(col =>
      activePrograms.has(col.program) &&
      (col.year === null || activeYears.has(col.year))
    );
  }

  function getFilteredTotal(org, activeCols) {
    return activeCols.reduce((sum, col) => sum + (org.funding[col.key] || 0), 0);
  }

  function applyFilters() {
    const searchTerm = document.getElementById('search-box').value.toLowerCase();
    const activeCols = getActiveColumns();
    const minAmount = parseFloat(document.getElementById('min-amount').value) || 0;
    const maxAmount = parseFloat(document.getElementById('max-amount').value) || Infinity;

    let visibleCount = 0;

    markers.forEach(({ org, circle }) => {
      const filteredTotal = getFilteredTotal(org, activeCols);
      const matchesSearch = org.name.toLowerCase().includes(searchTerm);
      const matchesAmount = filteredTotal >= minAmount && filteredTotal <= maxAmount;
      const hasFunding = filteredTotal > 0;

      const visible = matchesSearch && matchesAmount && hasFunding;

      if (visible) {
        circle.setStyle({
          fillColor: getColor(filteredTotal),
          radius: getRadius(filteredTotal),
        });
        circle.setTooltipContent(
          `<strong>${org.name}</strong><br>I alt: ${formatDKK(filteredTotal)}`
        );
        if (!markersLayer.hasLayer(circle)) {
          circle.addTo(markersLayer);
        }
        visibleCount++;
      } else {
        markersLayer.removeLayer(circle);
      }
    });

    document.getElementById('stats').textContent =
      `Viser ${visibleCount} af ${markers.length} klubber`;
  }

  // Wire up filter events
  document.getElementById('search-box').addEventListener('input', applyFilters);
  document.querySelectorAll('#program-filters input, #year-filters input').forEach(cb => {
    cb.addEventListener('change', applyFilters);
  });
  document.getElementById('min-amount').addEventListener('input', applyFilters);
  document.getElementById('max-amount').addEventListener('input', applyFilters);

  document.getElementById('reset-btn').addEventListener('click', () => {
    document.getElementById('search-box').value = '';
    document.getElementById('min-amount').value = '';
    document.getElementById('max-amount').value = '';
    document.querySelectorAll('#program-filters input, #year-filters input').forEach(cb => {
      cb.checked = true;
    });
    applyFilters();
  });

  // Initial count
  applyFilters();

  // ========== DETAIL PANEL ==========
  function showDetail(org) {
    document.getElementById('detail-name').textContent = org.name;

    const activeCols = getActiveColumns();
    const filteredTotal = getFilteredTotal(org, activeCols);

    document.getElementById('detail-total').textContent = formatDKK(filteredTotal);

    const tbody = document.getElementById('detail-tbody');
    tbody.innerHTML = '';

    const entries = activeCols
      .filter(col => (org.funding[col.key] || 0) > 0)
      .map(col => ({ label: col.key, amount: org.funding[col.key] }))
      .sort((a, b) => b.amount - a.amount);

    if (entries.length === 0) {
      const row = tbody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 2;
      cell.textContent = 'Ingen bevillinger i valgte filtre';
      cell.style.color = '#6c757d';
      cell.style.fontStyle = 'italic';
    } else {
      entries.forEach(({ label, amount }) => {
        const row = tbody.insertRow();
        row.insertCell().textContent = label;
        row.insertCell().textContent = formatDKK(amount);
      });
    }

    document.body.classList.add('detail-open');
    setTimeout(() => map.invalidateSize(), 310);
  }

  document.getElementById('close-detail').addEventListener('click', () => {
    document.body.classList.remove('detail-open');
    setTimeout(() => map.invalidateSize(), 310);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.body.classList.remove('detail-open');
      setTimeout(() => map.invalidateSize(), 310);
    }
  });

})();
