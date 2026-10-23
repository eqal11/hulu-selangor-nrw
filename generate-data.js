#!/usr/bin/env node
'use strict';
// All data is synthetic, for demonstration only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const DEFAULT_SEED = 20251023;
const YEAR = 2025;
const round = (n, d = 2) => Number(n.toFixed(d));
const pad = (n, d = 3) => String(n).padStart(d, '0');
const fc = features => ({ type: 'FeatureCollection', features });
const feature = (id, type, coordinates, properties) => ({ type: 'Feature', id, geometry: { type, coordinates }, properties });
function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function distanceM(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function generateDataset(seed = DEFAULT_SEED) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new Error('Seed must be an integer from 0 to 4294967295.');
  const rng = randomSource(seed);
  const range = (a, b) => a + rng() * (b - a);
  const int = (a, b) => Math.floor(range(a, b + 1));
  const pick = a => a[int(0, a.length - 1)];
  const coord = (x, y) => [round(x, 7), round(y, 7)];
  const dmas = [], pipes = [], assets = [], leaks = [], balances = [], issues = [];
  const bounds = new Map();
  const names = ['Serendah Demo', 'Rasa Demo', 'Batang Kali Demo', 'Bukit Sentosa Demo', 'Kuala Kubu Demo', 'Hulu Yam Demo', 'Kalumpang Demo', 'Kerling Demo'];
  const baselines = [0.25, 0.30, 0.33, 0.51, 0.49, 0.27, 0.46, 0.31];
  const materials = [['DI', .22, 1985, 2021], ['uPVC', .26, 1993, 2023], ['AC', .23, 1965, 1992], ['HDPE', .20, 2000, 2025], ['steel', .09, 1978, 2012]];
  function addPipe(dmaId, a, b) {
    let draw = rng(), definition = materials.at(-1);
    for (const m of materials) { draw -= m[1]; if (draw < 0) { definition = m; break; } }
    const index = pipes.length;
    pipes.push(feature(`pipe-feature-${pad(index + 1, 4)}`, 'LineString', [a, b], {
      pipe_id: `PIPE-${pad(index + 1, 4)}`, dma_id: dmaId, material: definition[0],
      diameter_mm: pick([75, 100, 150, 200, 250, 300]), install_year: int(definition[2], definition[3]),
      length_m: round(distanceM(a, b)), status: rng() < (definition[0] === 'AC' ? .18 : .05) ? 'needs_rehabilitation' : 'in_service',
    }));
    return index;
  }
  function addAsset(type, dmaId, point) {
    const index = assets.length + 1;
    assets.push(feature(`asset-feature-${pad(index, 4)}`, 'Point', point, {
      asset_id: `ASSET-${pad(index, 4)}`, asset_type: type, dma_id: dmaId,
      install_year: int(type === 'valve' ? 1985 : 2005, 2025), condition: pick(['good', 'good', 'fair', 'fair', 'poor']),
    }));
  }
  for (let i = 0; i < 8; i++) {
    const dmaId = `DMA-${pad(i + 1)}`;
    const west = 101.59 + (i % 4) * .025, south = 3.49 + Math.floor(i / 4) * .025;
    bounds.set(dmaId, { west, south });
    const connections = int(1500, 3200), population = Math.round(connections * range(3.6, 4.7));
    // Fictional rectangles: names do not imply actual locality or utility boundaries.
    dmas.push(feature(dmaId, 'Polygon', [[coord(west, south), coord(west + .025, south), coord(west + .025, south + .025), coord(west, south + .025), coord(west, south)]], {
      dma_id: dmaId, dma_name: names[i], population_served: population, connections,
    }));
    // Reuse exact node coordinates to ensure connected jittered grid edges.
    const nodes = Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) =>
      coord(west + .025 * (.18 + c * .11 + range(-.012, .012)), south + .025 * (.18 + r * .11 + range(-.012, .012)))));
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      if (c < 6) addPipe(dmaId, nodes[r][c], nodes[r][c + 1]);
      if (r < 6) addPipe(dmaId, nodes[r][c], nodes[r + 1][c]);
    }
    addAsset('dma_inlet_meter', dmaId, nodes[3][0]);
    for (const [r, c] of [[1, 2], [3, 3], [5, 5]]) addAsset('flow_meter', dmaId, nodes[r][c]);
    for (const [r, c] of [[0, 0], [0, 3], [0, 6], [2, 2], [2, 5], [4, 1], [4, 4], [6, 0], [6, 3], [6, 6]]) addAsset('valve', dmaId, nodes[r][c]);
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
      const seasonal = 1 + .06 * Math.sin((month - 2) * Math.PI / 6);
      const input = Math.round(population * range(.175, .200) * days * seasonal / (1 - baselines[i]) * 100);
      const rate = Math.max(.20, Math.min(.55, baselines[i] + range(-.018, .018) + (month - 6.5) * .0007));
      // Integer hundredths of m3 avoid rounding inconsistencies in balance totals.
      const nrw = Math.round(input * rate), unbilled = Math.round(input * range(.010, .025)), apparent = Math.round(input * range(.025, .055));
      balances.push({ dma_id: dmaId, month: `${YEAR}-${pad(month, 2)}`, system_input_m3: input / 100,
        billed_authorised_m3: (input - nrw) / 100, unbilled_authorised_m3: unbilled / 100,
        apparent_losses_m3: apparent / 100, real_losses_m3: (nrw - unbilled - apparent) / 100,
        nrw_m3: nrw / 100, nrw_pct: round(100 * nrw / input) });
    }
  }
  const affected = new Set();
  function log(index, type, field, original, injected, description, extra = {}) {
    affected.add(index);
    issues.push({ issue_id: `QA-${pad(issues.length + 1)}`, file: 'pipes.geojson', feature_index: index,
      feature_id: pipes[index].id, pipe_id: pipes[index].properties.pipe_id, issue_type: type,
      field, original_value: original, injected_value: injected, description, ...extra });
  }
  for (const dmaId of ['DMA-002', 'DMA-006']) {
    const b = bounds.get(dmaId);
    const index = addPipe(dmaId, coord(b.west + .0010, b.south + .0010), coord(b.west + .0027, b.south + .0017));
    log(index, 'disconnected_segment', 'geometry', null, pipes[index].geometry,
      'Added isolated segment inside its DMA; neither endpoint connects to the grid.', { expected_dma_id: dmaId });
  }
  const candidates = Array.from({ length: pipes.length - 2 }, (_, i) => i);
  for (let i = candidates.length - 1; i > 0; i--) { const j = int(0, i); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  let cursor = 0;
  for (const field of ['material', 'install_year']) for (let n = 0; n < 6; n++) {
    const index = candidates[cursor++], old = pipes[index].properties[field];
    pipes[index].properties[field] = null;
    log(index, `missing_${field}`, field, old, null, `Intentionally null ${field}.`);
  }
  for (let n = 0; n < 3; n++) {
    const index = candidates[cursor++], donor = candidates[candidates.length - 1 - n], old = pipes[index].properties.pipe_id;
    pipes[index].properties.pipe_id = pipes[donor].properties.pipe_id;
    log(index, 'duplicate_pipe_id', 'pipe_id', old, pipes[index].properties.pipe_id, 'Copied a donor business ID; feature IDs remain unique.',
      { duplicate_of_feature_id: pipes[donor].id, duplicate_of_feature_index: donor });
  }
  for (let n = 0; n < 3; n++) {
    const index = candidates[cursor++], old = pipes[index].properties.dma_id;
    pipes[index].properties.dma_id = `DMA-INVALID-${n + 1}`;
    log(index, 'invalid_dma_id', 'dma_id', old, pipes[index].properties.dma_id, 'Nonexistent DMA foreign key; geometry remains in original DMA.');
  }
  const duplicateIds = new Set(issues.filter(i => i.issue_type === 'duplicate_pipe_id').map(i => i.injected_value));
  for (let index = 0; index < pipes.length; index++) {
    const p = pipes[index].properties;
    // Avoid creating unlogged or ambiguous leak references to deliberately bad records.
    if (affected.has(index) || duplicateIds.has(p.pipe_id)) continue;
    const risk = .055 * (p.material === 'AC' ? 2 : 1) * (p.install_year < 1995 ? 2.2 : 1);
    if (rng() >= risk) continue;
    const [a, b] = pipes[index].geometry.coordinates, t = range(.12, .88);
    const lon = a[0] + t * (b[0] - a[0]), lat = a[1] + t * (b[1] - a[1]);
    const angle = range(0, 2 * Math.PI), offset = range(2, 10);
    const point = coord(lon + offset * Math.cos(angle) / (111195 * Math.cos(lat * Math.PI / 180)), lat + offset * Math.sin(angle) / 111195);
    const type = pick(['burst', 'service connection', 'joint', 'joint']);
    const lossRange = type === 'burst' ? [35, 170] : type === 'joint' ? [8, 65] : [3, 28];
    const day = int(0, 364), statusDraw = rng();
    const status = statusDraw < (day < 300 ? .85 : .45) ? 'repaired' : statusDraw < .93 ? 'in_progress' : 'open';
    const id = leaks.length + 1;
    leaks.push(feature(`leak-feature-${pad(id, 4)}`, 'Point', point, { leak_id: `LEAK-${pad(id, 4)}`,
      pipe_id: p.pipe_id, dma_id: p.dma_id, leak_type: type, reported_date: new Date(Date.UTC(YEAR, 0, 1 + day)).toISOString().slice(0, 10),
      repair_status: status, est_loss_m3_day: round(range(...lossRange)) }));
  }
  const counts = {};
  for (const issue of issues) counts[issue.issue_type] = (counts[issue.issue_type] || 0) + 1;
  return { 'dma.geojson': fc(dmas), 'pipes.geojson': fc(pipes), 'assets.geojson': fc(assets), 'leaks.geojson': fc(leaks),
    'water_balance.json': balances, 'qa_injected_issues.json': {
      notice: 'All data is synthetic, for demonstration only.', seed, reference_year: YEAR, crs: 'EPSG:4326', coordinate_order: '[longitude, latitude]',
      synthetic_extent: { west: 101.59, south: 3.49, east: 101.69, north: 3.54 }, target_issue_rate_pct: 3,
      denominator: 'Pipe features; each affected feature has one deliberate issue.', total_pipe_features: pipes.length,
      affected_pipe_features: affected.size, actual_issue_rate_pct: round(100 * affected.size / pipes.length, 4),
      feature_index_convention: 'Zero-based index in pipes.geojson.features; feature_id is the stable unique locator.',
      counts_by_issue_type: counts, problematic_dma_ids: ['DMA-004', 'DMA-005', 'DMA-007'], issues } };
}
function validateDataset(data) {
  const dmas = data['dma.geojson'].features, pipes = data['pipes.geojson'].features;
  const assets = data['assets.geojson'].features, leaks = data['leaks.geojson'].features;
  const balances = data['water_balance.json'], qa = data['qa_injected_issues.json'];
  const dmaMap = new Map(dmas.map(d => [d.properties.dma_id, d]));
  const issueMap = new Map(qa.issues.map(i => [i.feature_id, i]));
  const pipeIds = new Map(), nodes = new Map();
  const key = (dma, point) => `${dma}:${point.join(',')}`;
  const inside = (point, dma) => {
    const ring = dmaMap.get(dma).geometry.coordinates[0];
    return point[0] >= ring[0][0] && point[0] <= ring[2][0] && point[1] >= ring[0][1] && point[1] <= ring[2][1];
  };
  assert.equal(dmas.length, 8); assert.equal(balances.length, 96);
  assert.equal(qa.issues.length, Math.round(pipes.length * .03)); assert.equal(issueMap.size, qa.issues.length);
  for (const dma of dmas) {
    assert.deepEqual(dma.geometry.coordinates[0][0], dma.geometry.coordinates[0].at(-1));
    const rows = balances.filter(b => b.dma_id === dma.properties.dma_id);
    assert.equal(rows.length, 12); assert.equal(new Set(rows.map(b => b.month)).size, 12);
    assert.equal(assets.filter(a => a.properties.dma_id === dma.properties.dma_id && a.properties.asset_type === 'dma_inlet_meter').length, 1);
  }
  for (const pipe of pipes) {
    const p = pipe.properties, issue = issueMap.get(pipe.id);
    const dma = issue?.issue_type === 'invalid_dma_id' ? issue.original_value : p.dma_id;
    assert.ok(dmaMap.has(dma)); assert.ok(dmaMap.has(p.dma_id) || issue?.issue_type === 'invalid_dma_id');
    assert.ok(p.material !== null || issue?.issue_type === 'missing_material');
    assert.ok(p.install_year !== null || issue?.issue_type === 'missing_install_year');
    for (const point of pipe.geometry.coordinates) { assert.ok(inside(point, dma)); nodes.set(key(dma, point), (nodes.get(key(dma, point)) || 0) + 1); }
    assert.ok(Math.abs(p.length_m - distanceM(...pipe.geometry.coordinates)) < .006);
    pipeIds.set(p.pipe_id, [...(pipeIds.get(p.pipe_id) || []), pipe]);
  }
  for (const issue of qa.issues) {
    const pipe = pipes[issue.feature_index]; assert.equal(pipe.id, issue.feature_id);
    assert.deepEqual(issue.field === 'geometry' ? pipe.geometry : pipe.properties[issue.field], issue.injected_value);
  }
  let isolated = 0;
  for (const pipe of pipes) {
    const issue = issueMap.get(pipe.id), dma = issue?.issue_type === 'invalid_dma_id' ? issue.original_value : pipe.properties.dma_id;
    const disconnected = pipe.geometry.coordinates.every(p => nodes.get(key(dma, p)) === 1);
    if (disconnected) isolated++;
    assert.equal(disconnected, issue?.issue_type === 'disconnected_segment');
  }
  assert.equal(isolated, 2);
  for (const [id, matches] of pipeIds) if (matches.length > 1) {
    assert.equal(matches.length, 2);
    assert.equal(qa.issues.filter(i => i.issue_type === 'duplicate_pipe_id' && i.injected_value === id).length, 1);
  }
  for (const asset of assets) { assert.ok(inside(asset.geometry.coordinates, asset.properties.dma_id)); assert.ok(nodes.has(key(asset.properties.dma_id, asset.geometry.coordinates))); }
  for (const leak of leaks) {
    const matches = pipeIds.get(leak.properties.pipe_id); assert.equal(matches.length, 1);
    assert.equal(leak.properties.dma_id, matches[0].properties.dma_id); assert.ok(inside(leak.geometry.coordinates, leak.properties.dma_id));
    const [a, b] = matches[0].geometry.coordinates, p = leak.geometry.coordinates;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
    assert.ok(distanceM(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]) < 10.1);
  }
  const cents = n => Math.round(n * 100);
  for (const row of balances) {
    assert.ok(dmaMap.has(row.dma_id)); assert.ok(row.nrw_pct >= 20 && row.nrw_pct <= 55);
    assert.equal(cents(row.system_input_m3), cents(row.billed_authorised_m3) + cents(row.nrw_m3));
    assert.equal(cents(row.nrw_m3), cents(row.unbilled_authorised_m3) + cents(row.apparent_losses_m3) + cents(row.real_losses_m3));
    assert.equal(row.nrw_pct, round(100 * row.nrw_m3 / row.system_input_m3)); assert.ok(row.real_losses_m3 > 0);
  }
}
function main() {
  let seed = DEFAULT_SEED, outputDir = path.join(__dirname, 'data');
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { console.log('Usage: node generate-data.js [--seed UINT32] [--out-dir DIRECTORY]\nDefault seed: 20251023. Output: data/ beside this script.'); return; }
    if (args[i] === '--seed') { const value = args[++i]; if (!value || !/^\d+$/.test(value)) throw new Error('--seed requires an unsigned integer.'); seed = Number(value); }
    else if (args[i] === '--out-dir') { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('--out-dir requires a directory.'); outputDir = path.resolve(value); }
    else throw new Error(`Unknown option: ${args[i]}. Use --help.`);
  }
  const data = generateDataset(seed); validateDataset(data);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, value] of Object.entries(data)) fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`Generated and validated synthetic NRW data (seed ${seed}) in ${outputDir}`);
  console.log(`DMAs: 8; pipes: ${data['pipes.geojson'].features.length}; assets: ${data['assets.geojson'].features.length}; leaks: ${data['leaks.geojson'].features.length}; monthly balances: 96.`);
  console.log(`Injected issues: ${data['qa_injected_issues.json'].affected_pipe_features} (${data['qa_injected_issues.json'].actual_issue_rate_pct}% of pipes).`);
}
module.exports = { generateDataset, validateDataset, distanceM };
if (require.main === module) { try { main(); } catch (error) { console.error(`Generation failed: ${error.message}`); process.exitCode = 1; } }
