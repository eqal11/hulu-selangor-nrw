/* Static Leaflet explorer. All local URLs are relative for GitHub Pages subpaths. */
'use strict';
(() => {
  const status = document.getElementById('load-status');
  const fitButton = document.getElementById('fit-bounds');
  const mobile = window.matchMedia('(max-width: 767px)');
  const number = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 2 });
  const materialColors = { DI:'#226bc3', uPVC:'#7c4bba', AC:'#b77928', HDPE:'#10958c', steel:'#53647c' };
  const unknownColor = '#8a96a5';
  const repairColors = { open:'#d94f57', in_progress:'#e6a02c', repaired:'#238b70' };
  const assetTypes = {
    valve: { label:'Valve', css:'valve' },
    flow_meter: { label:'Flow meter', css:'flow-meter' },
    dma_inlet_meter: { label:'DMA inlet meter', css:'inlet-meter' },
  };
  const nrwClasses = [
    { max:30, color:'#3ca978', label:'Below 30%' },
    { max:40, color:'#f5d46e', label:'30% to <40%' },
    { max:50, color:'#ee9855', label:'40% to <50%' },
    { max:Infinity, color:'#d75760', label:'50% and above' },
  ];
  const nrwColor = value => Number.isFinite(value) ? nrwClasses.find(c => value < c.max).color : unknownColor;
  const pipeWeight = diameter => 1.2 + (Number.isFinite(diameter) ? diameter : 100) / 85;
  const leakRadius = loss => 4 + 8 * Math.sqrt(Math.max(0, Number.isFinite(loss) ? loss : 0) / 170);
  const labels = { dma_id:'DMA ID', dma_name:'DMA name', population_served:'Population served', connections:'Connections',
    pipe_id:'Pipe ID', material:'Material', diameter_mm:'Diameter (mm)', install_year:'Installation year', length_m:'Length (m)', status:'Status',
    asset_id:'Asset ID', asset_type:'Asset type', condition:'Condition', leak_id:'Leak ID', leak_type:'Leak type',
    reported_date:'Reported date', repair_status:'Repair status', est_loss_m3_day:'Estimated loss (m³/day)' };
  const humanize = text => String(text).replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
  // Always escape text before inserting feature values into HTML.
  const escape = value => String(value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? 'n/a' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const missing = value => value === null || value === undefined || value === '';
  function formatValue(key, value) {
    if (missing(value) || (typeof value === 'number' && !Number.isFinite(value))) return '<span class="missing-value">n/a</span>';
    if (key === 'install_year') return escape(value);
    if (typeof value === 'number') return number.format(value);
    if (key === 'asset_type') return escape(assetTypes[value]?.label || humanize(value));
    if (['repair_status','condition','status'].includes(key)) return escape(humanize(value));
    return escape(value);
  }
  function popup(feature, kind, title, extraRows = '', note = '') {
    const rows = Object.entries(feature.properties || {}).map(([key, value]) =>
      `<tr><th scope="row">${escape(labels[key] || humanize(key))}</th><td>${formatValue(key, value)}</td></tr>`).join('');
    return `<article><p class="popup-kind">${escape(kind)}</p><h2 class="popup-title">${escape(title)}</h2>` +
      `<table class="attribute-table"><tbody>${rows}${extraRows}<tr><th scope="row">Feature ID</th><td>${escape(feature.id || '—')}</td></tr></tbody></table>` +
      (note ? `<p class="popup-note">${escape(note)}</p>` : '') + '</article>';
  }
  async function fetchJSON(filename) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`./data/${filename}`, { signal:controller.signal });
      if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new Error(`Unable to load ${filename}. ${error.name === 'AbortError' ? 'Request timed out.' : error.message}`);
    } finally { clearTimeout(timer); }
  }
  const periodSelect = document.getElementById('period-select');
  const panel = document.getElementById('insights');
  const sheetButton = document.getElementById('sheet-toggle');
  const rankingBody = document.getElementById('dma-ranking');
  const detail = document.getElementById('dma-detail');
  const openStatuses = new Set(['open', 'in_progress']);
  const balanceKeys = ['system_input_m3','billed_authorised_m3','unbilled_authorised_m3','apparent_losses_m3','real_losses_m3','nrw_m3'];
  const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const display = value => validNumber(value) ? number.format(value) : 'n/a';
  const percent = value => validNumber(value) ? number.format(value) + '%' : 'n/a';
  const periodLabel = period => period === 'annual' ? 'Annual · 2025' : new Date(period + '-01T00:00:00Z').toLocaleDateString('en-MY', { month:'short', year:'numeric', timeZone:'UTC' });
  const inPeriod = (month, period) => typeof month === 'string' && (period === 'annual' ? /^2025-(0[1-9]|1[0-2])$/.test(month) : month === period);
  // Require every input to be known: missing/negative values produce n/a, not a misleading partial total.
  // Zero is a valid volume/count. A zero denominator has no meaningful percentage.
  function sumKnown(values) {
    return values.length > 0 && values.every(validNumber) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  function ratioPct(numerator, denominator) {
    return validNumber(numerator) && validNumber(denominator) && denominator > 0 ? 100 * numerator / denominator : null;
  }
  function calculatePeriod(dmas, rows, leaks, pipes, period) {
    const selectedRows = rows.filter(row => inPeriod(row.month, period));
    const periodLeaks = leaks.filter(f => inPeriod(f.properties?.reported_date?.slice(0, 7), period));
    // Unresolved reports in this period; the dataset cannot reconstruct historical repair status.
    const openLeaks = periodLeaks.filter(f => openStatuses.has(f.properties?.repair_status));
    const byDma = new Map();
    for (const dma of dmas) {
      const id = dma.properties.dma_id;
      const dmaRows = selectedRows.filter(row => row.dma_id === id);
      const requiredMonths = period === 'annual' ? 12 : 1;
      const complete = dmaRows.length === requiredMonths && new Set(dmaRows.map(row => row.month)).size === requiredMonths;
      const volumes = Object.fromEntries(balanceKeys.map(key => [key, complete ? sumKnown(dmaRows.map(row => row[key])) : null]));
      // Preserve the original annual choropleth: simple mean of 12 monthly percentages.
      // A monthly percentage uses that month's nrw_pct. Missing percentages fall back to NRW/input.
      const monthlyPct = dmaRows.map(row => validNumber(row.system_input_m3) && row.system_input_m3 > 0 ? (validNumber(row.nrw_pct) ? row.nrw_pct : ratioPct(row.nrw_m3, row.system_input_m3)) : null);
      const pctSum = complete ? sumKnown(monthlyPct) : null;
      const pct = pctSum === null ? null : pctSum / requiredMonths;
      // Pipe inventory is period-independent. Age = 2025 - install_year; omit unknown/future years.
      // Group by recorded dma_id; intentionally invalid DMA references remain unassigned.
      const dmaPipes = pipes.filter(f => f.properties?.dma_id === id);
      const ages = dmaPipes.map(f => f.properties?.install_year).filter(y => Number.isInteger(y) && y > 0 && y <= 2025).map(y => 2025 - y);
      const lengthM = sumKnown(dmaPipes.map(f => f.properties?.length_m));
      byDma.set(id, { id, name:dma.properties.dma_name || id, pct, volumes,
        pipeKm:lengthM === null ? null : lengthM / 1000, averageAge:ages.length ? sumKnown(ages) / ages.length : null,
        knownAges:ages.length, pipeCount:dmaPipes.length, openLeaks:openLeaks.filter(f => f.properties?.dma_id === id).length });
    }
    const values = [...byDma.values()];
    const totals = Object.fromEntries(balanceKeys.map(key => [key, sumKnown(values.map(dma => dma.volumes[key]))]));
    // Overall NRW is volume-weighted: 100 * SUM(NRW m3) / SUM(system input m3).
    // Never average DMA percentages for this KPI; differing DMA sizes matter.
    return { byDma, periodLeaks, totals, overallPct:ratioPct(totals.nrw_m3, totals.system_input_m3),
      openCount:openLeaks.length, openLoss:openLeaks.length ? sumKnown(openLeaks.map(f => f.properties?.est_loss_m3_day)) : 0,
      highDmas:values.every(d => validNumber(d.pct)) ? values.filter(d => d.pct > 40).length : null,
      ranking:values.sort((a, b) => (validNumber(b.pct) ? b.pct : -Infinity) - (validNumber(a.pct) ? a.pct : -Infinity) || a.name.localeCompare(b.name)) };
  }
  const qaChecks = [
    ['missing','Missing attributes'], ['duplicates','Duplicate IDs'], ['orphans','Orphan references'],
    ['disconnected','Disconnected pipes'], ['outside','Outside boundary'],
  ];
  const qaNames = Object.fromEntries(qaChecks);
  const properties = f => f?.properties || {};
  const coordinateOK = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const emptyAttribute = value => missing(value) || (typeof value === 'string' && !value.trim());
  function validGeometry(g) {
    if (!g || !Array.isArray(g.coordinates)) return false;
    const ringOK = ring => Array.isArray(ring) && ring.length >= 4 && ring.every(coordinateOK) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
    const polygonOK = rings => Array.isArray(rings) && rings.length > 0 && rings.every(ringOK);
    if (g.type === 'Point') return coordinateOK(g.coordinates);
    if (g.type === 'LineString') return g.coordinates.length >= 2 && g.coordinates.every(coordinateOK);
    if (g.type === 'Polygon') return polygonOK(g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.length > 0 && g.coordinates.every(polygonOK);
    return false;
  }
  function drawableCollection(data, types) {
    return { type:'FeatureCollection', features:(data?.features || []).filter(f => types.includes(f?.geometry?.type) && validGeometry(f.geometry)).map(f => ({ ...f, properties:properties(f) })) };
  }
  function distanceMetres(a, b) {
    const rad = v => v * Math.PI / 180;
    const h = Math.sin(rad(b[1]-a[1])/2)**2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0]-a[0])/2)**2;
    return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function lineMidpoint(coordinates) {
    const lengths = coordinates.slice(1).map((p, i) => distanceMetres(coordinates[i], p));
    let remaining = lengths.reduce((a,b) => a+b, 0)/2;
    for (let i=0; i<lengths.length; i++) {
      if (remaining <= lengths[i]) {
        const t = lengths[i] ? remaining/lengths[i] : 0;
        return [coordinates[i][0] + t*(coordinates[i+1][0]-coordinates[i][0]), coordinates[i][1] + t*(coordinates[i+1][1]-coordinates[i][1])];
      }
      remaining -= lengths[i];
    }
    return coordinates.at(-1);
  }
  // Ray casting handles Polygon/MultiPolygon and interior holes. Boundary points count as inside.
  function pointInPolygon(point, geometry) {
    if (!coordinateOK(point) || !validGeometry(geometry) || !['Polygon','MultiPolygon'].includes(geometry.type)) return null;
    function inRing(ring) {
      let inside = false;
      for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
        const a=ring[j], b=ring[i], dx=b[0]-a[0], dy=b[1]-a[1];
        const cross=(point[0]-a[0])*dy-(point[1]-a[1])*dx;
        if (Math.abs(cross) < 1e-12 && point[0]>=Math.min(a[0],b[0])-1e-10 && point[0]<=Math.max(a[0],b[0])+1e-10 && point[1]>=Math.min(a[1],b[1])-1e-10 && point[1]<=Math.max(a[1],b[1])+1e-10) return 'boundary';
        if ((a[1]>point[1]) !== (b[1]>point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
      }
      return inside;
    }
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    return polygons.some(rings => {
      const outer=inRing(rings[0]); if (outer==='boundary') return true; if (!outer) return false;
      for (const hole of rings.slice(1)) { const result=inRing(hole); if (result==='boundary') return true; if (result) return false; }
      return true;
    });
  }
  function qaRecords(data) {
    return ['pipes','assets','leaks'].flatMap(layer => (data[layer]?.features || []).map((feature,index) => ({
      layer, index, feature:feature || {}, recordKey:layer+':'+index,
      featureId:feature?.id ?? properties(feature)[{pipes:'pipe_id',assets:'asset_id',leaks:'leak_id'}[layer]] ?? 'n/a',
      dmaId:emptyAttribute(properties(feature).dma_id)?'n/a':String(properties(feature).dma_id),
    })));
  }
  function qaIssue(record, check, code, description, field = null) {
    return { ...record, check, checkName:qaNames[check], code, description, field };
  }
  // Check 1: emit one issue per required null/absent/blank attribute (zero is not missing).
  function checkMissing(records) {
    return records.flatMap(record => (record.layer==='pipes'?['material','install_year']:record.layer==='assets'?['condition']:[])
      .filter(field => emptyAttribute(properties(record.feature)[field]))
      .map(field => qaIssue(record,'missing','missing_'+field,'Required attribute '+field+' is missing.',field)));
  }
  // Check 2: index business IDs per layer in O(n); flag EVERY member of a duplicate group.
  function checkDuplicates(records) {
    const groups=new Map();
    for (const record of records) {
      const field={pipes:'pipe_id',assets:'asset_id',leaks:'leak_id'}[record.layer], value=properties(record.feature)[field];
      if (emptyAttribute(value)) continue;
      const key=record.layer+':'+String(value), group=groups.get(key)||[]; group.push(record); groups.set(key,group);
    }
    return [...groups.values()].filter(group=>group.length>1).flatMap(group=>group.map(record=>{
      const field={pipes:'pipe_id',assets:'asset_id',leaks:'leak_id'}[record.layer];
      return qaIssue(record,'duplicates','duplicate_'+field,field+' "'+properties(record.feature)[field]+'" occurs '+group.length+' times in '+record.layer+'.',field);
    }));
  }
  // Check 3: set lookups validate DMA references and leak-to-pipe references independently.
  function checkOrphans(records, dmas) {
    const dmaIds=new Set(dmas.map(f=>properties(f).dma_id).filter(v=>!emptyAttribute(v)));
    const pipeIds=new Set(records.filter(r=>r.layer==='pipes').map(r=>properties(r.feature).pipe_id).filter(v=>!emptyAttribute(v)));
    const issues=[];
    for (const record of records) {
      const p=properties(record.feature);
      if (!dmaIds.has(p.dma_id)) issues.push(qaIssue(record,'orphans','invalid_dma_id','DMA reference '+(emptyAttribute(p.dma_id)?'n/a':p.dma_id)+' does not exist.','dma_id'));
      if (record.layer==='leaks' && !pipeIds.has(p.pipe_id)) issues.push(qaIssue(record,'orphans','invalid_pipe_id','Pipe reference '+(emptyAttribute(p.pipe_id)?'n/a':p.pipe_id)+' does not exist.','pipe_id'));
    }
    return issues;
  }
  // Check 4: 1 m Earth-centred XYZ grid, 27 neighbouring buckets, then exact haversine <=1 m.
  // Ignore BOTH endpoints from the same pipe; any OTHER pipe endpoint or asset may connect.
  // Bucket construction/query avoids scanning every other pipe for each endpoint.
  function checkDisconnected(records) {
    const grid=new Map(), pipes=[];
    function cell(p) {
      const lon=p[0]*Math.PI/180, lat=p[1]*Math.PI/180, r=6371008.8;
      return [r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat)].map(Math.floor);
    }
    function add(point,recordKey) { const key=cell(point).join(','); const bucket=grid.get(key)||[]; bucket.push({point,recordKey}); grid.set(key,bucket); }
    for (const record of records) {
      const g=record.feature.geometry;
      if (!validGeometry(g)) continue;
      if (record.layer==='pipes' && g.type==='LineString') { pipes.push(record); add(g.coordinates[0],record.recordKey); add(g.coordinates.at(-1),record.recordKey); }
      if (record.layer==='assets' && g.type==='Point') add(g.coordinates,record.recordKey);
    }
    function connected(point, recordKey) {
      const [x,y,z]=cell(point);
      for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++) for (let c=-1;c<=1;c++) {
        const bucket=grid.get([x+a,y+b,z+c].join(','))||[];
        if (bucket.some(other=>other.recordKey!==recordKey && distanceMetres(point,other.point)<=1+1e-6)) return true;
      }
      return false;
    }
    return pipes.flatMap(record=>{
      const coords=record.feature.geometry.coordinates;
      const ends=[]; if(!connected(coords[0],record.recordKey))ends.push('start'); if(!connected(coords.at(-1),record.recordKey))ends.push('end');
      return ends.length?[qaIssue(record,'disconnected','disconnected_segment','No other pipe endpoint or asset within 1 m of '+ends.join(' and ')+' endpoint'+(ends.length>1?'s.':'.'),'geometry')]:[];
    });
  }
  // Check 5: test the half-length pipe midpoint or leak point against its assigned DMA.
  // Unknown DMA is already an orphan (not counted twice). Invalid geometry is reported as untestable.
  function checkOutside(records, dmas) {
    const byId=new Map(dmas.map(f=>[properties(f).dma_id,f]));
    return records.filter(r=>['pipes','leaks'].includes(r.layer)).flatMap(record=>{
      const g=record.feature.geometry, expected=record.layer==='pipes'?'LineString':'Point';
      if (!validGeometry(g) || g.type!==expected) return [qaIssue(record,'outside','invalid_geometry','n/a: missing or invalid '+expected+' geometry; boundary check could not run.','geometry')];
      const dma=byId.get(properties(record.feature).dma_id); if(!dma)return [];
      const point=record.layer==='pipes'?lineMidpoint(g.coordinates):g.coordinates;
      const inside=pointInPolygon(point,dma.geometry);
      if(inside===null)return [qaIssue(record,'outside','invalid_dma_geometry','n/a: assigned DMA boundary is missing or invalid.','geometry')];
      return inside?[]:[qaIssue(record,'outside','outside_boundary',(record.layer==='pipes'?'Pipe midpoint':'Leak point')+' falls outside its assigned DMA.','geometry')];
    });
  }
  function runQa(data) {
    const records=qaRecords(data), dmas=data.dma?.features||[];
    const issues=[...checkMissing(records),...checkDuplicates(records),...checkOrphans(records,dmas),...checkDisconnected(records),...checkOutside(records,dmas)].map((issue,index)=>({...issue,issueIndex:index}));
    const affected=new Set(issues.map(issue=>issue.recordKey)).size;
    return { records:records.length, affected, issues, passRate:records.length?100*(records.length-affected)/records.length:null,
      counts:Object.fromEntries(qaChecks.map(([key])=>[key,issues.filter(i=>i.check===key).length])) };
  }
  // Match defect TYPE and feature, not just a faulty feature's ID; donors don't inflate detection.
  function injectionDetection(log, result) {
    if (!Array.isArray(log?.issues)) return null;
    const detected=log.issues.filter(injected=>{
      const layer=String(injected.file||'').replace('.geojson','');
      return result.issues.some(issue=>issue.layer===layer && issue.code===injected.issue_type &&
        (!emptyAttribute(injected.feature_id)?String(issue.featureId)===String(injected.feature_id):issue.index===injected.feature_index));
    }).length;
    return { detected, total:log.issues.length, pct:log.issues.length?100*detected/log.issues.length:null };
  }
  // RFC 4180 CSV: quote every field, double embedded quotes, and neutralize spreadsheet formulas.
  function issuesCsv(issues) {
    const quote=value=>'"'+String(value??'n/a').replace(/^[=+@\-\t\r]/,first=>"'"+first).replaceAll('"','""')+'"';
    return '\uFEFF'+[['Check','Layer','Feature ID','DMA','Description'],...issues.map(i=>[i.checkName,i.layer,i.featureId,i.dmaId,i.description])].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }

  function showError(error) {
    status.hidden = false;
    status.setAttribute('role', 'alert');
    status.innerHTML = `<strong>The map could not be loaded</strong><p>${escape(error.message)}</p><p>` +
      (location.protocol === 'file:' ? 'Serve this folder over HTTP, or use GitHub Pages, so the map can load the data files.' : 'Check your connection and make sure the data folder is beside index.html, then reload.') + '</p>';
  }
  async function init() {
    if (!window.L) throw new Error('Leaflet did not load. Check your internet connection and reload.');
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    });
    const imagery = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:19, attribution:'Tiles &copy; Esri &mdash; Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    });
    const mapElement = document.getElementById('map');
    const map = L.map('map', { layers:[osm], zoomControl:false, minZoom:4 }).setView([3.515, 101.64], 12);
    L.control.zoom({ position:'bottomleft' }).addTo(map);
    L.control.scale({ position:'bottomleft', imperial:false, maxWidth:100 }).addTo(map);
    // Explicit panes preserve layer order when users toggle overlays back on.
    for (const [name, z] of [['dma',400], ['pipes',450], ['assets',500], ['leaks',550], ['qa-focus',650]]) map.createPane(name).style.zIndex = z;
    const tileStatus = document.getElementById('tile-status');
    for (const tiles of [osm, imagery]) {
      tiles.on('tileerror', () => { if (map.hasLayer(tiles)) tileStatus.hidden = false; });
      tiles.on('tileload', () => { if (map.hasLayer(tiles)) tileStatus.hidden = true; });
    }
    map.on('baselayerchange', () => { tileStatus.hidden = true; });
    // Optional audit log is never required for map/QA initialization.
    const injectedLogPromise = fetchJSON('qa_injected_issues.json').catch(() => null);
    const [dmaData, pipeData, assetData, leakData, balanceData] = await Promise.all([
      fetchJSON('dma.geojson'), fetchJSON('pipes.geojson'), fetchJSON('assets.geojson'), fetchJSON('leaks.geojson'), fetchJSON('water_balance.json'),
    ]);
    let selectedId = null;
    let currentPeriod = 'annual';
    let current = calculatePeriod(dmaData.features, balanceData, leakData.features, pipeData.features, currentPeriod);
    const dmaLayers = new Map();
    function dmaStyle(f) {
      const selected = selectedId === f.properties.dma_id;
      return { color:selected ? '#073e60' : '#3b6775', weight:selected ? 4 : 1.3, opacity:selected ? 1 : .75,
        fillColor:nrwColor(current.byDma.get(f.properties.dma_id)?.pct), fillOpacity:selected ? .45 : .32 };
    }
    function dmaPopup(f) {
      const metrics = current.byDma.get(f.properties.dma_id);
      return popup(f, 'District metered area', f.properties.dma_name,
        '<tr class="annual-row"><th scope="row">NRW · ' + escape(periodLabel(currentPeriod)) + '</th><td>' + percent(metrics?.pct) + '</td></tr>',
        currentPeriod === 'annual' ? 'Arithmetic mean of 12 monthly NRW percentages in 2025.' : 'NRW percentage for the selected month.');
    }
    const popupOptions = { maxWidth:330, maxHeight:380, autoPanPadding:[15,25] };
    const dmaLayer = L.geoJSON(drawableCollection(dmaData,['Polygon','MultiPolygon']), {
      pane:'dma', style:dmaStyle,
      onEachFeature(f, layer) {
        dmaLayers.set(f.properties.dma_id, layer);
        layer.bindPopup(dmaPopup(f), popupOptions);
        layer.bindTooltip(escape(f.properties.dma_name), { permanent:true, direction:'center', className:'dma-label', opacity:1, interactive:false });
        layer.on('mouseover', () => { if (selectedId !== f.properties.dma_id) layer.setStyle({ weight:2.5, fillOpacity:.45 }); });
        layer.on('mouseout', () => layer.setStyle(dmaStyle(f)));
        layer.on('click', () => selectDma(f.properties.dma_id, false));
      },
    }).addTo(map);
    const pipesLayer = L.geoJSON(drawableCollection(pipeData,['LineString']), {
      pane:'pipes', style:f => ({ color:materialColors[f.properties.material] || unknownColor, weight:pipeWeight(f.properties.diameter_mm),
        opacity:.9, dashArray:materialColors[f.properties.material] ? null : '5 4', lineCap:'round' }),
      onEachFeature(f, layer) { layer.bindPopup(popup(f, 'Water main', f.properties.pipe_id), popupOptions); },
    }).addTo(map);
    const assetsLayer = L.geoJSON(drawableCollection(assetData,['Point']), {
      pointToLayer(f, latlng) {
        const type = assetTypes[f.properties.asset_type] || { label:'Asset', css:'valve' };
        return L.marker(latlng, { pane:'assets', title:`${type.label} · ${f.properties.asset_id}`, alt:`${type.label} ${f.properties.asset_id}`,
          icon:L.divIcon({ className:'asset-icon', html:`<span class="asset-symbol ${type.css}" aria-hidden="true"></span>`, iconSize:[14,14], iconAnchor:[7,7], popupAnchor:[0,-10] }) });
      },
      onEachFeature(f, layer) { layer.bindPopup(popup(f, assetTypes[f.properties.asset_type]?.label || 'Asset', f.properties.asset_id), popupOptions); },
    }).addTo(map);
    const leaksLayer = L.geoJSON(drawableCollection({features:current.periodLeaks},['Point']), {
      pointToLayer(f, latlng) { return L.circleMarker(latlng, { pane:'leaks', radius:leakRadius(f.properties.est_loss_m3_day),
        fillColor:repairColors[f.properties.repair_status] || unknownColor, fillOpacity:.9, color:'#fff', weight:1.5 }); },
      onEachFeature(f, layer) { layer.bindPopup(popup(f, 'Leak report', f.properties.leak_id, '', 'Estimated loss is the daily rate while this leak was active.'), popupOptions); },
    }).addTo(map);
    // A narrow embedded map can need compact controls even in a desktop window.
    const needsCompactControls = () => mobile.matches || mapElement.clientWidth < 620;
    let compactControls = needsCompactControls();
    const control = L.control.layers({ 'OpenStreetMap':osm, 'Esri World Imagery':imagery }, {
      'DMA boundaries':dmaLayer, 'Pipes':pipesLayer, 'Assets':assetsLayer, 'Leaks':leaksLayer,
    }, { position:'topright', collapsed:compactControls }).addTo(map);
    function labelLayerControl() {
      const heading = L.DomUtil.create('p', 'control-title'); heading.textContent = 'Map layers';
      control.getContainer().querySelector('.leaflet-control-layers-list').prepend(heading);
      control.getContainer().setAttribute('aria-label', 'Basemaps and map layers');
    }
    labelLayerControl();
    // Shared symbol functions keep legend and actual map encodings in sync.
    const row = (symbol, label) => `<div class="legend-row">${symbol}<span>${label}</span></div>`;
    const swatch = color => `<span class="legend-swatch" style="background:${color}" aria-hidden="true"></span>`;
    const line = (color, width, dashed = false) => `<span class="legend-line" style="border-top-color:${color};border-top-width:${width}px;${dashed ? 'border-top-style:dashed' : ''}" aria-hidden="true"></span>`;
    const dot = (color, radius) => `<span class="legend-dot" style="background:${color};width:${radius * 2}px;height:${radius * 2}px" aria-hidden="true"></span>`;
    const section = (title, body) => `<section class="legend-section"><h2>${title}</h2>${body}</section>`;
    const legend = L.control({ position:'bottomright' });
    let legendBody;
    legend.onAdd = () => {
      const el = L.DomUtil.create('details', 'map-legend'); el.open = !compactControls;
      el.innerHTML = '<summary>Map legend</summary><div class="legend-body"></div>';
      legendBody = el.querySelector('.legend-body');
      L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
      return el;
    };
    legend.addTo(map);
    function updateLegend() {
      const parts = [];
      if (map.hasLayer(dmaLayer)) parts.push(section('DMA · ' + escape(periodLabel(currentPeriod)) + ' NRW', nrwClasses.map(c => row(swatch(c.color), c.label)).join('') +
        '<p class="legend-note">' + (currentPeriod === 'annual' ? 'Mean of monthly NRW percentages' : 'Selected month NRW percentage') + '</p>'));
      if (map.hasLayer(pipesLayer)) parts.push(section('Pipes · Material', Object.entries(materialColors).map(([name, color]) => row(line(color, 3), escape(name))).join('') +
        row(line(unknownColor, 3, true), 'Unknown / missing') + '<p class="legend-note">Line width · diameter</p><div class="legend-inline">' +
        [75,150,300].map(d => `<span>${line('#587386', pipeWeight(d))}${d} mm</span>`).join('') + '</div>'));
      if (map.hasLayer(assetsLayer)) parts.push(section('Assets · Type', Object.values(assetTypes).map(t => row(`<span class="legend-shape"><span class="asset-symbol ${t.css}" aria-hidden="true"></span></span>`, t.label)).join('')));
      if (map.hasLayer(leaksLayer)) parts.push(section('Leaks · Repair status', Object.entries(repairColors).map(([state, color]) => row(`<span class="legend-shape">${dot(color,5)}</span>`, humanize(state))).join('') +
        '<p class="legend-note">Circle size · estimated loss (m³/day)</p><div class="legend-inline">' + [10,60,150].map(loss => `<span>${dot('#7697a7', leakRadius(loss))}${loss}</span>`).join('') + '</div>'));
      legendBody.innerHTML = parts.length ? parts.join('') : '<p class="legend-note">No overlays visible. Enable a layer in the map layers control.</p>';
    }
    map.on('overlayadd overlayremove', updateLegend); updateLegend();
    function setSheet(expanded) {
      panel.classList.toggle('is-expanded', expanded);
      sheetButton.setAttribute('aria-expanded', String(expanded));
    }
    sheetButton.addEventListener('click', () => { const expanded = !panel.classList.contains('is-expanded'); setSheet(expanded); if (expanded && selectedId) highlightSelection(true); });
    // Native buttons inside table cells provide keyboard activation as well as whole-row clicks.
    function renderRanking() {
      rankingBody.innerHTML = current.ranking.map((dma, index) => {
        const selected = dma.id === selectedId;
        const width = validNumber(dma.pct) ? Math.max(0, Math.min(100, dma.pct)) : 0;
        return '<tr data-dma-id="' + escape(dma.id) + '"' + (selected ? ' class="is-selected"' : '') + '><td>' + (index + 1) +
          '</td><th scope="row"><button type="button" aria-pressed="' + selected + '" aria-label="Select ' + escape(dma.name) + '">' + escape(dma.name) +
          '</button><span class="rank-track" aria-hidden="true"><span style="width:' + width + '%;background:' + nrwColor(dma.pct) + '"></span></span></th><td>' + percent(dma.pct) + '</td></tr>';
      }).join('');
      document.getElementById('ranking-method').textContent = currentPeriod === 'annual' ? 'Annual: mean of monthly NRW percentages.' : 'Monthly NRW percentage · ' + periodLabel(currentPeriod);
    }
    function renderKpis() {
      const card = (label, value, extra = '', wide = false) => '<article class="kpi-card' + (wide ? ' kpi-wide' : '') + '"><h3>' + label + '</h3><strong>' + value + '</strong>' + (extra ? '<span>' + extra + '</span>' : '') + '</article>';
      document.getElementById('kpi-grid').innerHTML =
        card('System input · m³', display(current.totals.system_input_m3)) + card('Billed consumption · m³', display(current.totals.billed_authorised_m3)) +
        card('Non-revenue water · m³', display(current.totals.nrw_m3), '<b>' + percent(current.overallPct) + '</b> overall NRW', true) +
        card('Open leaks', display(current.openCount), display(current.openLoss) + ' m³/day estimated loss') +
        card('DMAs above 40% NRW', display(current.highDmas), 'Of ' + dmaData.features.length + ' DMAs');
    }
    function renderDetail() {
      detail.hidden = !selectedId;
      if (!selectedId) { detail.innerHTML = ''; return; }
      const dma = current.byDma.get(selectedId);
      const components = [
        ['billed_authorised_m3','Billed authorised','#146a91'], ['unbilled_authorised_m3','Unbilled authorised','#65b8ca'],
        ['apparent_losses_m3','Apparent losses','#e5b64d'], ['real_losses_m3','Real losses','#d75760'],
      ];
      const input = dma.volumes.system_input_m3;
      // Stack percentages = component volume / system input * 100. Annual values use annual sums.
      // Require complete, balanced components before drawing a full-width bar; zero input is n/a.
      const componentSum = sumKnown(components.map(([key]) => dma.volumes[key]));
      const balanced = validNumber(input) && input > 0 && componentSum !== null && Math.abs(componentSum - input) <= .02;
      const bar = balanced ? components.map(([key, label, color]) => {
        const pct = ratioPct(dma.volumes[key], input);
        return '<span style="width:' + pct + '%;background:' + color + '" title="' + label + ': ' + display(dma.volumes[key]) + ' m³ (' + percent(pct) + ')"></span>';
      }).join('') : '<span class="stack-empty">n/a</span>';
      detail.innerHTML = '<span class="eyebrow">SELECTED DMA</span><h3 id="detail-title">' + escape(dma.name) + '</h3><p class="detail-period">' + escape(periodLabel(currentPeriod)) +
        ' · ' + percent(dma.pct) + ' NRW</p><div class="balance-stack" role="img" aria-label="Water balance breakdown; volumes and percentages listed below">' + bar + '</div>' +
        '<ul class="balance-labels">' + components.map(([key, label, color]) => '<li><span class="balance-name"><i style="background:' + color + '" aria-hidden="true"></i>' + label +
          '</span><strong>' + display(dma.volumes[key]) + ' m³ <small>' + percent(ratioPct(dma.volumes[key], input)) + '</small></strong></li>').join('') + '</ul>' +
        '<dl class="detail-stats"><div><dt>Total pipe length</dt><dd>' + display(dma.pipeKm) + ' km</dd></div><div><dt>Average pipe age</dt><dd>' + display(dma.averageAge) +
        ' years</dd></div><div><dt>Open leaks</dt><dd>' + display(dma.openLeaks) + '</dd></div></dl><p class="panel-note">Inventory age at 2025 year-end; ' + dma.knownAges + '/' + dma.pipeCount +
        ' pipe ages known. Length uses recorded DMA IDs; invalid references are excluded.</p>';
    }
    function highlightSelection(scrollToRow) {
      dmaLayer.setStyle(dmaStyle);
      for (const tr of rankingBody.querySelectorAll('tr')) {
        const selected = tr.dataset.dmaId === selectedId;
        tr.classList.toggle('is-selected', selected); tr.querySelector('button').setAttribute('aria-pressed', String(selected));
        if (selected && scrollToRow) {
          // Scroll only the ranking container, never the whole page or map.
          const scroller = document.getElementById('ranking-scroll');
          const delta = tr.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          scroller.scrollTop += delta - scroller.clientHeight / 2 + tr.clientHeight / 2;
          const content = document.getElementById('panel-content');
          const rowRect = tr.getBoundingClientRect(), contentRect = content.getBoundingClientRect();
          if (rowRect.top < contentRect.top || rowRect.bottom > contentRect.bottom) content.scrollTop += rowRect.top - contentRect.top - 30;
        }
      }
    }
    function selectDma(id, zoom) {
      if (!dmaLayers.has(id)) return;
      selectedId = id;
      if (!map.hasLayer(dmaLayer)) dmaLayer.addTo(map);
      const layer = dmaLayers.get(id);
      if (mobile.matches) setSheet(false); // Keep the selected outline and popup visible above the collapsed sheet.
      highlightSelection(true); renderDetail();
      if (zoom) map.fitBounds(layer.getBounds(), { paddingTopLeft:[30,35], paddingBottomRight:mobile.matches ? [30,190] : [245,40], maxZoom:15, animate:false });
      layer.openPopup();
    }
    rankingBody.addEventListener('click', event => {
      const tr = event.target.closest('tr[data-dma-id]'); if (tr) selectDma(tr.dataset.dmaId, true);
    });
    function fitToDmas() {
      const bounds = dmaLayer.getBounds(); if (bounds.isValid && !bounds.isValid()) return;
      const size = map.getSize();
      // Padding belongs to the MAP column, not the full window. Never reserve 250 px in a tiny map.
      const edge = Math.min(24, size.x * .05);
      const right = compactControls ? edge : Math.min(250, size.x * .25);
      const top = Math.min(mobile.matches ? 100 : 115, size.y * .2);
      const bottom = Math.min(mobile.matches ? 150 : 45, size.y * .25);
      map.fitBounds(bounds, { paddingTopLeft:[edge,top], paddingBottomRight:[right,bottom], maxZoom:14, animate:false });
    }
    function syncMapControls() {
      const compact = needsCompactControls();
      if (compact === compactControls) return;
      compactControls = compact;
      // Rebuild Leaflet's control so its expand/collapse listeners match the new layout mode.
      control.options.collapsed = compact;
      control.remove(); control.addTo(map); labelLayerControl();
      legend.getContainer().open = !compact;
    }
    let layoutFrame = null, fitAfterLayout = false, afterLayout = null;
    function refreshMapLayout(fit = false, callback = null) {
      fitAfterLayout = fitAfterLayout || fit;
      if (callback) afterLayout = callback;
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      // Two frames let the tab, sidebar and CSS grid finish layout before Leaflet measures it.
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = null;
          if (mapView.hidden || !mapElement.clientWidth || !mapElement.clientHeight) return;
          syncMapControls();
          map.invalidateSize({pan:false,animate:false});
          const shouldFit = fitAfterLayout, callback = afterLayout;
          fitAfterLayout = false; afterLayout = null;
          if (shouldFit) fitToDmas();
          // QA issue links can focus their feature AFTER the common resize/overview fit.
          if (callback) callback();
        });
      });
    }
    function resetView() {
      selectedId = null; map.closePopup(); if (!map.hasLayer(dmaLayer)) dmaLayer.addTo(map); highlightSelection(false); renderDetail(); if (mobile.matches) setSheet(false); refreshMapLayout(true);
    }
    function updatePeriod() {
      currentPeriod = periodSelect.value;
      current = calculatePeriod(dmaData.features, balanceData, leakData.features, pipeData.features, currentPeriod);
      dmaLayer.setStyle(dmaStyle);
      dmaLayer.eachLayer(layer => layer.setPopupContent(dmaPopup(layer.feature)));
      leaksLayer.clearLayers(); leaksLayer.addData(drawableCollection({features:current.periodLeaks},['Point']));
      renderKpis(); renderRanking(); renderDetail(); highlightSelection(Boolean(selectedId)); updateLegend();
    }
    periodSelect.disabled = false; periodSelect.addEventListener('change', updatePeriod);
    fitButton.disabled = false; fitButton.addEventListener('click', resetView);
    // QA/QC always audits the full loaded infrastructure inventory, independent of period filters.
    const qaResult = runQa({ dma:dmaData, pipes:pipeData, assets:assetData, leaks:leakData });
    const qaView = document.getElementById('view-qa'), mapView = document.getElementById('view-map');
    const tabMap = document.getElementById('tab-map'), tabQa = document.getElementById('tab-qa');
    const checkFilter = document.getElementById('qa-check-filter'), dmaFilter = document.getElementById('qa-dma-filter');
    const issueBody = document.getElementById('qa-issues-body');
    const focusBanner = document.getElementById('qa-focus');
    let qaHighlight = null;
    function switchTab(name, afterShow) {
      const onMap=name==='map';
      mapView.hidden=!onMap; qaView.hidden=onMap; fitButton.hidden=!onMap;
      for (const [tab,active] of [[tabMap,onMap],[tabQa,!onMap]]) { tab.setAttribute('aria-selected',String(active)); tab.tabIndex=active?0:-1; }
      // Hidden Leaflet containers have zero dimensions. Resize only after display is restored.
      if(onMap) { if (mobile.matches) setSheet(false); refreshMapLayout(true, afterShow); }
    }
    for(const [tab,name] of [[tabMap,'map'],[tabQa,'qa']]) {
      tab.disabled=false; tab.addEventListener('click',()=>switchTab(name));
      tab.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault(); const target=event.key==='Home'?tabMap:event.key==='End'?tabQa:tab===tabMap?tabQa:tabMap;
        target.focus(); switchTab(target===tabMap?'map':'qa');
      });
    }
    function clearQaHighlight() {
      if(qaHighlight) { map.removeLayer(qaHighlight); qaHighlight=null; }
      focusBanner.hidden=true; mapView.classList.toggle('has-qa-focus',false);
    }
    document.getElementById('clear-qa-focus').addEventListener('click',clearQaHighlight);
    fitButton.addEventListener('click',clearQaHighlight);
    function showQaFeature(issue) {
      switchTab('map',()=>{
        clearQaHighlight(); map.closePopup(); if(mobile.matches)setSheet(false);
        focusBanner.hidden=false; mapView.classList.toggle('has-qa-focus',true);
        const g=issue.feature.geometry;
        const canDraw=validGeometry(g);
        document.getElementById('qa-focus-message').textContent=issue.checkName+' · '+issue.featureId+(canDraw?'':' · Location n/a');
        if(!canDraw) {
          const dma=dmaLayers.get(issue.dmaId); if(dma)map.fitBounds(dma.getBounds(),{maxZoom:15});
          return;
        }
        // A separate overlay preserves normal layer styles and survives period/layer changes.
        qaHighlight=L.geoJSON({...issue.feature,properties:properties(issue.feature)}, {
          pane:'qa-focus', style:{color:'#e12942',weight:6,opacity:1,fillColor:'#e12942',fillOpacity:.23},
          pointToLayer:(f,latlng)=>L.circleMarker(latlng,{pane:'qa-focus',radius:12,color:'#e12942',weight:4,fillColor:'#ff6074',fillOpacity:.35}),
          onEachFeature:(f,layer)=>layer.bindPopup(popup(f,'QA/QC · '+issue.checkName,issue.featureId,'',issue.description),popupOptions),
        }).addTo(map);
        map.fitBounds(qaHighlight.getBounds(),{paddingTopLeft:[35,90],paddingBottomRight:mobile.matches?[35,190]:[245,45],maxZoom:17,animate:false});
        // Keep the focused geometry visible; its full attribute popup opens when it is clicked.
      });
    }
    const summaryCard=(label,value,note='')=>'<article class="qa-card"><h3>'+label+'</h3><strong>'+value+'</strong>'+(note?'<p>'+note+'</p>':'')+'</article>';
    document.getElementById('qa-summary').innerHTML=summaryCard('Records checked',display(qaResult.records),'Pipes, assets and leaks')+
      summaryCard('Total issues',display(qaResult.issues.length),display(qaResult.affected)+' unique records affected')+
      summaryCard('Pass rate',percent(qaResult.passRate),'Records with no detected issues');
    document.getElementById('qa-check-counts').innerHTML=qaChecks.map(([key,name])=>'<div class="qa-check-count"><span>'+name+'</span><strong>'+display(qaResult.counts[key])+'</strong></div>').join('');
    checkFilter.innerHTML='<option value="all">All checks</option>'+qaChecks.map(([key,name])=>'<option value="'+key+'">'+name+'</option>').join('');
    const dmaNames=new Map(dmaData.features.map(f=>[properties(f).dma_id,properties(f).dma_name]));
    const dmaIds=[...new Set(qaRecords({pipes:pipeData,assets:assetData,leaks:leakData}).map(record=>record.dmaId))].sort();
    dmaFilter.innerHTML='<option value="all">All DMAs</option>'+dmaIds.map(id=>'<option value="'+escape(id)+'">'+escape(dmaNames.has(id)?dmaNames.get(id)+' · '+id:id)+'</option>').join('');
    checkFilter.value='all'; dmaFilter.value='all';
    const filteredIssues=()=>qaResult.issues.filter(issue=>(checkFilter.value==='all'||issue.check===checkFilter.value)&&(dmaFilter.value==='all'||issue.dmaId===dmaFilter.value));
    function renderIssues() {
      const issues=filteredIssues();
      issueBody.innerHTML=issues.length?issues.map(issue=>'<tr data-issue-index="'+issue.issueIndex+'"><td><span class="qa-check-label">'+escape(issue.checkName)+
        '</span></td><td>'+escape(humanize(issue.layer))+'</td><th scope="row"><button type="button" aria-label="Locate '+escape(issue.featureId)+' on map">'+escape(issue.featureId)+
        '</button></th><td>'+escape(dmaNames.get(issue.dmaId)||issue.dmaId)+'</td><td>'+escape(issue.description)+'</td></tr>').join(''):
        '<tr><td colspan="5" class="qa-empty">No issues match these filters.</td></tr>';
      document.getElementById('qa-table-status').textContent=display(issues.length)+' of '+display(qaResult.issues.length)+' issues shown. Select a record to locate it on the map.';
    }
    checkFilter.addEventListener('change',renderIssues); dmaFilter.addEventListener('change',renderIssues);
    issueBody.addEventListener('click',event=>{const tr=event.target.closest('tr[data-issue-index]'); if(tr)showQaFeature(qaResult.issues[Number(tr.dataset.issueIndex)]);});
    document.getElementById('qa-export').addEventListener('click',()=>{
      const blob=new Blob([issuesCsv(filteredIssues())],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob), anchor=document.createElement('a');
      anchor.href=url; anchor.download='nrw-qa-issues.csv'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    renderIssues();
    injectedLogPromise.then(log=>{
      const detection=injectionDetection(log,qaResult), card=document.getElementById('qa-detection');
      card.hidden=!detection;
      if(detection)card.innerHTML=summaryCard('Detection rate',percent(detection.pct),display(detection.detected)+' / '+display(detection.total)+' injected defects detected');
    });

    renderKpis(); renderRanking(); status.hidden = true;
    refreshMapLayout(true); // Panel content is rendered; fit only after its layout is measured.
    const fitAfterLoad = () => refreshMapLayout(!selectedId && !qaHighlight);
    if (document.readyState === 'complete') fitAfterLoad();
    else window.addEventListener('load', fitAfterLoad, {once:true});
    // Observe the actual map box: sidebar/breakpoint changes need not emit a window resize.
    const mapResizeObserver = new ResizeObserver(() => {
      if (!mapView.hidden) refreshMapLayout(!selectedId && !qaHighlight);
    });
    mapResizeObserver.observe(mapElement);
    mobile.addEventListener('change', () => {
      if (mobile.matches) setSheet(false);
      refreshMapLayout(!selectedId && !qaHighlight);
    });
  }
  init().catch(showError);
})();
