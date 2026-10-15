/* South Lebanon Displacement & Damage Map — Leaflet app */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = n => (n == null || isNaN(n)) ? '–' : Math.round(n).toLocaleString('en-US');

  // ---------- config ----------
  const RAMPS = {
    Blues: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
    Reds: ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'],
    Purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
    Oranges: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'],
    Greens: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
    RdYlGn: ['#a50026', '#f46d43', '#fee08b', '#a6d96a', '#1a9850'],
    YlOrRd: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026']
  };
  const IND = {
    idps_total: { label: 'IDPs hosted (individuals)', ramps: ['Reds', 'Purples', 'Blues', 'Oranges'], kind: 'count' },
    idps_shelter: { label: 'IDPs in collective shelters', ramps: ['Purples', 'Reds', 'Blues', 'Oranges'], kind: 'count' },
    pct_remaining: { label: 'Population remaining vs. pre-escalation', ramps: ['RdYlGn', 'Blues', 'Greens'], kind: 'pct' },
    pop_now: { label: 'Current population (individuals)', ramps: ['Blues', 'Greens', 'Purples', 'Oranges'], kind: 'count' },
    pop_before: { label: 'Population before 2 Mar 2026', ramps: ['Greens', 'Blues', 'Purples', 'Oranges'], kind: 'count' },
    lrc_score: { label: 'LRC priority score (0–100)', ramps: ['YlOrRd', 'Reds', 'Purples'], kind: 'score' }
  };
  const ZONES = [
    ['1 Within yellow line', 'Within the yellow line', '#ffff00'],
    ['2 Front line (0-5 km)', 'Front line (0–5 km)', '#ffc000'],
    ['3 5-7 km from yellow line', '5–7 km from yellow line', '#92d050'],
    ['4 Outside conflict line (7 km+)', 'Outside conflict line (7 km+)', '#00b050']
  ];
  const DMG = [
    ['Destroyed (complete)', '#67000d'], ['Very severe', '#b2182b'], ['Severe', '#e34a33'],
    ['Moderate', '#fc8d59'], ['Mild', '#fdcc8a'], ['No damage', '#7fbf7b'], ['Not verified', '#9aa3ab']
  ];
  const dmgColor = Object.fromEntries(DMG);
  const zoneColor = Object.fromEntries(ZONES.map(z => [z[0], z[2]]));
  const zoneLabel = Object.fromEntries(ZONES.map(z => [z[0], z[1]]));

  const state = { res: 'cad', ind: 'idps_total', rampIdx: {}, labels: false, select: true, dmgOn: new Set(DMG.map(d => d[0])), zoneOp: 0.45, theme: 'light', bm: 'light' };

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, preferCanvas: false }).setView([33.3, 35.45], 9);
  map.createPane('choro').style.zIndex = 400;
  map.createPane('zones').style.zIndex = 405;
  map.createPane('bounds').style.zIndex = 420;
  map.createPane('geoai').style.zIndex = 430;
  map.createPane('sites').style.zIndex = 620;
  const BASEMAPS = {
    light: L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' }), L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'shadowPane' })]),
    dark: L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' }), L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'shadowPane' })]),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' })
  };
  BASEMAPS.light.addTo(map);
  map.attributionControl.setPrefix('Boundaries and names shown do not imply official endorsement or acceptance by the United Nations');

  // ---------- data ----------
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  Promise.all(['cadasters.geojson', 'districts.geojson', 'governorates.geojson', 'damaged_sites.geojson', 'geoai_buildings_khiam.geojson'].map(get))
    .then(init).catch(e => { $('#legend').innerHTML = '<h3>Data could not load</h3><p class="sub">Open the site through a web server (e.g. GitHub Pages), not as a local file.</p>'; console.error(e); });

  let CAD, DIST, GOV, SITES, GEOAI, layers = {};

  function aggregate(key) {
    const agg = {};
    CAD.features.forEach(f => {
      const p = f.properties, k = p[key]; if (!k) return;
      const a = agg[k] || (agg[k] = { n: 0, pop_before: 0, pop_now: 0, idps_total: 0, idps_shelter: 0, nPop: 0, lrcSum: 0, lrcN: 0, destroyed: 0 });
      a.n++;
      if (p.pop_before != null) { a.pop_before += p.pop_before; a.pop_now += (p.pop_now || 0); a.nPop++; }
      a.idps_total += p.idps_total || 0; a.idps_shelter += p.idps_shelter || 0;
      if (p.lrc_score != null) { a.lrcSum += p.lrc_score; a.lrcN++; }
      a.destroyed += p.units_destroyed || 0;
    });
    Object.values(agg).forEach(a => {
      a.pct_remaining = a.nPop && a.pop_before > 0 ? a.pop_now / a.pop_before * 100 : null;
      a.lrc_score = a.lrcN ? a.lrcSum / a.lrcN : null;
      if (!a.nPop) { a.pop_before = a.pop_now = a.idps_total = a.idps_shelter = null; }
    });
    return agg;
  }

  function init(d) {
    [CAD, DIST, GOV, SITES, GEOAI] = d;
    const aD = aggregate('DISTRICT'), aG = aggregate('GOV');
    DIST.features.forEach(f => Object.assign(f.properties, aD[f.properties.DISTRICT] || {}, { NAME: f.properties.DISTRICT }));
    GOV.features.forEach(f => Object.assign(f.properties, aG[f.properties.GOV] || {}, { NAME: f.properties.GOV }));
    CAD.features.forEach(f => f.properties.NAME = f.properties.ACS_NAME);

    layers.zones = L.geoJSON({ type: 'FeatureCollection', features: CAD.features.filter(f => f.properties.zone) }, {
      pane: 'zones', interactive: false,
      style: f => ({ fillColor: zoneColor[f.properties.zone], fillOpacity: state.zoneOp, color: '#ffffff', weight: 0.3, opacity: 0.6 })
    });

    layers.sites = L.layerGroup().addTo(map);
    SITES.features.forEach(f => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      const r = { 'Destroyed (complete)': 7, 'Very severe': 6.5, 'Severe': 6 }[p.damage] || 5;
      const m = L.circleMarker([lat, lon], { pane: 'sites', radius: r, fillColor: dmgColor[p.damage], fillOpacity: 0.95, color: '#ffffff', weight: 1.3 });
      m.feature = f;
      m.bindPopup(`<b>${p.facility_name_ar || p.facility_type}</b><br>${p.facility_type}<br>${p.municipality}, ${p.district}<br>` +
        `<span class="pill" style="background:${dmgColor[p.damage]};color:${p.dmg_rank <= 2 ? '#fff' : '#111'}">${p.damage}</span><br>` +
        `Services operating: <b>${p.service_continuity}</b>${p.damage_types ? '<br><small>Damage: ' + p.damage_types + '</small>' : ''}` +
        (p.shared_coord ? '<br><small>Location shared with another site (municipality-level).</small>' : ''));
      layers.sites.addLayer(m);
    });

    layers.geoai = L.geoJSON(GEOAI, { pane: 'geoai', style: { color: '#00e5ff', weight: 1.2, fillColor: '#00e5ff', fillOpacity: 0.25 } })
      .bindTooltip(l => 'GeoAI building · confidence ' + Math.round(l.feature.properties.confidence * 100) + '%');
    layers.khiam = L.circleMarker([33.3281, 35.61284], { pane: 'sites', radius: 10, fillColor: '#67000d', fillOpacity: 1, color: '#fff', weight: 2 })
      .bindTooltip('Khiam municipality – reported destroyed (LRC)', { permanent: true, direction: 'top', offset: [0, -10] });

    buildChips(); bindUI(); drawChoropleth(); renderLegend(); renderLayersTab(); renderOverview();
    setTimeout(fitSouth, 50);
  }

  // ---------- choropleth ----------
  function features() { return state.res === 'cad' ? CAD : state.res === 'dist' ? DIST : GOV; }
  function breaks(vals, kind) {
    if (kind === 'pct') return [0, 25, 50, 75, 100];
    if (kind === 'score') return [0, 20, 35, 50, 65];
    const v = vals.filter(x => x > 0).sort((a, b) => a - b);
    if (!v.length) return [0, 1, 2, 3, 4];
    const q = p => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    const b = [0, q(0.2), q(0.4), q(0.6), q(0.8)].map(x => niceRound(x));
    for (let i = 1; i < b.length; i++) if (b[i] <= b[i - 1]) b[i] = b[i - 1] + 1;
    return b;
  }
  function niceRound(x) { if (x < 10) return Math.round(x); const m = Math.pow(10, Math.floor(Math.log10(x)) - 1); return Math.round(x / m) * m; }
  function ramp() { const ind = IND[state.ind]; return RAMPS[ind.ramps[(state.rampIdx[state.ind] || 0) % ind.ramps.length]]; }
  function classOf(v, b) { let c = 0; for (let i = 0; i < b.length; i++) if (v >= b[i]) c = i; return c; }
  let curBreaks = null;

  function drawChoropleth() {
    if (layers.choro) map.removeLayer(layers.choro);
    const fc = features(), ind = state.ind ? IND[state.ind] : null;
    if (ind) curBreaks = breaks(fc.features.map(f => f.properties[state.ind]).filter(v => v != null), ind.kind);
    const R = ind ? ramp() : null;
    layers.choro = L.geoJSON(fc, {
      pane: 'choro',
      style: f => {
        const v = ind ? f.properties[state.ind] : null;
        const has = v != null && !(ind.kind === 'count' && false);
        let fill = 'transparent', fo = 0;
        if (ind && v != null) {
          if (ind.kind === 'count' && v === 0) { fill = '#ffffff'; fo = 0.55; }
          else { fill = R[classOf(v, curBreaks)]; fo = 0.78; }
        }
        return { fillColor: fill, fillOpacity: fo, color: state.res === 'cad' ? '#7a828a' : '#343a40', weight: state.res === 'cad' ? 0.4 : 1.4, opacity: 0.9 };
      },
      onEachFeature: (f, l) => {
        l.on('click', e => { selectArea(f, l); });
        l.on('mouseover', () => l.setStyle({ weight: 2.4, color: '#1a73e8' }));
        l.on('mouseout', () => layers.choro.resetStyle(l));
        if (state.labels) l.bindTooltip(f.properties.NAME || '', { permanent: true, direction: 'center', className: 'lbl' });
      }
    }).addTo(map);
    updateLabelVisibility();
  }
  function updateLabelVisibility() {
    if (!state.labels || !layers.choro) return;
    const show = state.res !== 'cad' || map.getZoom() >= 11;
    layers.choro.eachLayer(l => { const t = l.getTooltip(); if (t) show ? l.openTooltip() : l.closeTooltip(); });
  }
  map.on('zoomend', updateLabelVisibility);

  // ---------- selection / analysis ----------
  let selLayer = null;
  function selectArea(f, l) {
    if (!state.select) { L.popup().setLatLng(l.getBounds().getCenter()).setContent(`<b>${f.properties.NAME}</b>`).openOn(map); return; }
    if (selLayer) map.removeLayer(selLayer);
    selLayer = L.geoJSON(f, { pane: 'bounds', style: { color: '#1a73e8', weight: 3, fill: false, dashArray: '6 4' } }).addTo(map);
    renderArea(f.properties, l);
    showTab('analysis');
  }
  function sitesIn(p) {
    const key = state.res === 'cad' ? null : state.res === 'dist' ? 'district' : 'governorate';
    if (!key) return SITES.features.filter(s => (s.properties.municipality || '').toLowerCase().split(' ')[0] === (p.ACS_NAME || '').toLowerCase().split(' ')[0]);
    const gm = { 'El Nabatieh': ['El Nabatieh'], 'South': ['South'], 'Bekaa': ['Bekaa', 'Baalbek-El Hermel'] };
    return SITES.features.filter(s => key === 'district' ? s.properties.district === p.DISTRICT || s.properties.district === p.NAME : (gm[p.GOV] || [p.GOV]).includes(s.properties.governorate));
  }
  function renderArea(p) {
    const lvl = { cad: 'Cadastre', dist: 'District', gov: 'Governorate' }[state.res];
    const ss = sitesIn(p), counts = {}; ss.forEach(s => counts[s.properties.damage] = (counts[s.properties.damage] || 0) + 1);
    const zone = p.zone ? `<span class="pill" style="background:${zoneColor[p.zone]}">${zoneLabel[p.zone]}</span>` : '';
    $('#tab-analysis').innerHTML = `
      <div class="guide-card"><h3>${p.NAME}</h3><span class="sub">${lvl}${p.DISTRICT && state.res === 'cad' ? ' · ' + p.DISTRICT : ''}</span></div>
      ${zone ? '<h4>Conflict zone</h4>' + zone : ''}
      <h4>Population &amp; displacement (21 Sep 2026)</h4>
      <div class="kpis">
        <div class="kpi"><b>${fmt(p.pop_before)}</b><span>Population before escalation</span></div>
        <div class="kpi"><b>${fmt(p.pop_now)}</b><span>Current population</span></div>
        <div class="kpi"><b>${p.pct_remaining == null ? '–' : Math.round(p.pct_remaining) + '%'}</b><span>Population remaining</span></div>
        <div class="kpi"><b>${fmt(p.idps_total)}</b><span>IDPs hosted</span></div>
      </div>
      <h4>LRC preliminary assessment</h4>
      <table class="kv">
        <tr><td>Priority score (0–100)</td><td>${p.lrc_score == null ? '–' : Math.round(p.lrc_score)}${p.lrc_band ? ' · ' + p.lrc_band : ''}</td></tr>
        <tr><td>IDPs in collective shelters</td><td>${fmt(p.idps_shelter)}</td></tr>
        ${state.res === 'cad' ? `<tr><td>Housing units destroyed (80–100%)</td><td>${fmt(p.units_destroyed)}</td></tr><tr><td>Housing units partially damaged</td><td>${fmt(p.units_partial)}</td></tr>` : `<tr><td>Cadastres with data</td><td>${fmt(p.n)}</td></tr>`}
      </table>
      <h4>Public institutions assessed here (${ss.length})</h4>
      ${ss.length ? DMG.filter(d => counts[d[0]]).map(d => bar(d[0], counts[d[0]], ss.length, d[1])).join('') : '<p class="sub">No geolocated institutions in this area.</p>'}
      <p class="sub" style="margin-top:12px">Click another area, or use “Clear selection” to return to the overview.</p>`;
  }
  function bar(label, n, max, col) { return `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${n / max * 100}%;background:${col}"></div></div><span class="n">${n}</span></div>`; }
  function renderOverview() {
    const c = {}; SITES.features.forEach(s => c[s.properties.damage] = (c[s.properties.damage] || 0) + 1);
    const sev = SITES.features.filter(s => s.properties.dmg_rank <= 3).length;
    const tot = CAD.features.reduce((a, f) => (a.idps += f.properties.idps_total || 0, a.now += f.properties.pop_now || 0, a.bef += f.properties.pop_before || 0, a), { idps: 0, now: 0, bef: 0 });
    const top = CAD.features.filter(f => f.properties.idps_total).sort((a, b) => b.properties.idps_total - a.properties.idps_total).slice(0, 8);
    $('#tab-analysis').innerHTML = `
      <div class="guide-card"><h3>South &amp; Nabatiyeh overview</h3><span class="sub">Click any area on the map for its figures</span></div>
      <h4>Headline figures</h4>
      <div class="kpis">
        <div class="kpi"><b>${fmt(tot.idps)}</b><span>IDPs hosted</span></div>
        <div class="kpi"><b>${Math.round(tot.now / tot.bef * 100)}%</b><span>of pre-escalation population present</span></div>
        <div class="kpi"><b>${SITES.features.length}</b><span>institutions assessed (LRC)</span></div>
        <div class="kpi"><b>${sev}</b><span>severely damaged or destroyed</span></div>
      </div>
      <h4>Institutions by damage level</h4>
      ${DMG.map(d => bar(d[0], c[d[0]] || 0, SITES.features.length, d[1])).join('')}
      <h4>Top cadastres by IDPs hosted</h4>
      <table class="kv">${top.map(f => `<tr><td>${f.properties.ACS_NAME}</td><td>${fmt(f.properties.idps_total)}</td></tr>`).join('')}</table>`;
  }

  // ---------- legend & layers tab ----------
  function legendIndicator() {
    if (!state.ind) return '';
    const ind = IND[state.ind], R = ramp(), b = curBreaks;
    let rows = '';
    if (ind.kind === 'count') rows += `<div class="row"><span class="sw" style="background:#fff"></span>None (0)</div>`;
    b.forEach((v, i) => {
      const hi = b[i + 1];
      let t = ind.kind === 'pct' ? (hi != null ? `${v}–${hi}%` : `${v}%+`) : (hi != null ? `${fmt(i === 0 && ind.kind === 'count' ? 1 : v)} – ${fmt(hi)}` : `${fmt(v)}+`);
      rows += `<div class="row"><span class="sw" style="background:${R[i]}"></span>${t}</div>`;
    });
    return `<h4>${ind.label}</h4>${rows}<div class="row"><span class="sw" style="background:transparent;border-style:dashed"></span>No data</div>`;
  }
  function renderLegend() {
    let h = '<h3>Map Legend</h3>' + legendIndicator();
    if (map.hasLayer(layers.zones)) h += '<h4>Conflict zone</h4>' + ZONES.map(z => `<div class="row"><span class="sw" style="background:${z[2]}"></span>${z[1]}</div>`).join('');
    if (map.hasLayer(layers.sites)) h += '<h4>Public institutions – damage</h4>' + DMG.filter(d => state.dmgOn.has(d[0])).map(d => `<div class="row"><span class="dot" style="background:${d[1]}"></span>${d[0]}</div>`).join('');
    if (map.hasLayer(layers.geoai)) h += '<h4>GeoAI</h4><div class="row"><span class="sw" style="background:rgba(0,229,255,.35);border-color:#00e5ff"></span>Detected standing building</div>';
    $('#legend').innerHTML = h;
  }
  function renderLayersTab() {
    const items = [];
    if (state.ind) items.push(`<div class="layer-item"><b>${IND[state.ind].label}</b><span class="sub">${{ cad: 'Cadastre', dist: 'District', gov: 'Governorate' }[state.res]} level · ramp ${IND[state.ind].ramps[(state.rampIdx[state.ind] || 0) % IND[state.ind].ramps.length]}</span></div>`);
    if (map.hasLayer(layers.zones)) items.push(`<div class="layer-item"><b>Conflict zones</b><span class="sub">Opacity ${Math.round(state.zoneOp * 100)}% · source: governorate sheets, 21 Sep 2026</span></div>`);
    if (map.hasLayer(layers.sites)) items.push(`<div class="layer-item"><b>Damaged public institutions</b><span class="sub">${state.dmgOn.size} of 7 damage levels shown · LRC, Jun–Jul 2026</span></div>`);
    if (map.hasLayer(layers.geoai)) items.push(`<div class="layer-item"><b>GeoAI detected buildings – Khiam</b><span class="sub">379 polygons · Mask R-CNN on Esri imagery</span></div>`);
    items.push(`<div class="layer-item"><b>Basemap</b><span class="sub">${{ light: 'Esri Light Gray Canvas', dark: 'Esri Dark Gray Canvas', sat: 'Esri World Imagery' }[state.bm]}</span></div>`);
    $('#tab-layers').innerHTML = '<h4>Layers on the map</h4>' + items.join('');
  }
  function refreshPanels() { renderLegend(); renderLayersTab(); }

  // ---------- UI ----------
  function buildChips() {
    $('#dmgChips').innerHTML = DMG.map(d => `<button type="button" class="chip" data-dmg="${d[0]}"><i style="background:${d[1]}"></i>${d[0]}</button>`).join('');
  }
  function applySiteFilter() {
    layers.sites.eachLayer(m => { const on = state.dmgOn.has(m.feature.properties.damage); m.setStyle({ opacity: on ? 1 : 0, fillOpacity: on ? 0.95 : 0 }); on ? m.options.interactive = true : null; });
  }
  function setBasemap(k) {
    Object.values(BASEMAPS).forEach(b => map.removeLayer(b)); BASEMAPS[k].addTo(map); state.bm = k;
    $$('[data-bm]').forEach(b => b.classList.toggle('on', b.dataset.bm === k)); refreshPanels();
  }
  function showTab(t) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab-body').forEach(el => el.hidden = el.id !== 'tab-' + t);
  }
  function fitSouth() { map.invalidateSize(); map.fitBounds([[33.05, 35.15], [33.62, 35.82]], { padding: [10, 10] }); }

  function bindUI() {
    $$('[data-res]').forEach(b => b.onclick = () => { state.res = b.dataset.res; $$('[data-res]').forEach(x => x.classList.toggle('on', x === b)); if (selLayer) { map.removeLayer(selLayer); selLayer = null; renderOverview(); } drawChoropleth(); refreshPanels(); });
    $('#labelsBtn').onclick = e => { state.labels = !state.labels; e.target.classList.toggle('on', state.labels); e.target.textContent = state.labels ? 'Hide labels' : 'Show labels'; drawChoropleth(); };
    $$('.ind').forEach(b => b.onclick = () => {
      state.ind = state.ind === b.dataset.ind ? null : b.dataset.ind;
      $$('.ind').forEach(x => x.classList.toggle('on', x.dataset.ind === state.ind)); drawChoropleth(); refreshPanels();
    });
    $$('.col-btn').forEach(b => b.onclick = () => {
      const k = b.dataset.ind; state.rampIdx[k] = (state.rampIdx[k] || 0) + 1;
      if (state.ind !== k) { state.ind = k; $$('.ind').forEach(x => x.classList.toggle('on', x.dataset.ind === k)); }
      drawChoropleth(); refreshPanels();
    });
    $$('.ind').forEach(x => x.classList.toggle('on', x.dataset.ind === state.ind));
    $('#zoneChk').onchange = e => { e.target.checked ? layers.zones.addTo(map) : map.removeLayer(layers.zones); refreshPanels(); };
    $('#zoneOp').oninput = e => { state.zoneOp = e.target.value / 100; $('#zoneOpOut').textContent = e.target.value + '%'; layers.zones.setStyle({ fillOpacity: state.zoneOp }); renderLayersTab(); };
    $('#siteChk').onchange = e => { e.target.checked ? layers.sites.addTo(map) : map.removeLayer(layers.sites); refreshPanels(); };
    $('#dmgChips').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; const k = c.dataset.dmg; state.dmgOn.has(k) ? state.dmgOn.delete(k) : state.dmgOn.add(k); c.classList.toggle('off', !state.dmgOn.has(k)); applySiteFilter(); refreshPanels(); };
    $('#geoaiChk').onchange = e => { if (e.target.checked) { layers.geoai.addTo(map); layers.khiam.addTo(map); } else { map.removeLayer(layers.geoai); map.removeLayer(layers.khiam); } refreshPanels(); };
    $('#khiamBtn').onclick = () => { $('#geoaiChk').checked = true; layers.geoai.addTo(map); layers.khiam.addTo(map); setBasemap('sat'); map.flyTo([33.3281, 35.61284], 16, { duration: 1.6 }); refreshPanels(); };
    $$('[data-bm]').forEach(b => b.onclick = () => setBasemap(b.dataset.bm));
    $('#fitBtn').onclick = fitSouth;
    $('#selBtn').classList.add('on');
    $('#selBtn').onclick = e => { state.select = !state.select; e.target.classList.toggle('on', state.select); };
    $('#clearBtn').onclick = () => { if (selLayer) map.removeLayer(selLayer); selLayer = null; renderOverview(); };
    $$('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    $('#themeBtn').onclick = () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', state.theme);
      $('#themeBtn').textContent = state.theme === 'dark' ? 'Light' : 'Dark';
      if (state.bm !== 'sat') setBasemap(state.theme === 'dark' ? 'dark' : 'light');
    };
  }
})();
