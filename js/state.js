// state.js — the ModelSpec (single source of truth) + helpers + validation.
// Mplus factor names are always F1..Fk (valid identifiers, contiguous so the
// "F1-Fk BY ..." range syntax holds). The user's factor labels are cosmetic
// (used only in APA output), never in the generated syntax.

export function createModelSpec(data) {
  const items = (data?.varNames || []).slice(0, 6); // sensible default selection
  const spec = {
    data: data || { fileName: null, delimiter: 'whitespace', hasHeader: false, nCols: 0, nRows: 0, varNames: [], categorical: [], missingCode: null },
    items,
    factors: [],            // [{ id:'F1', label:'F1' }]
    target: {},             // target[item][factorId] = true(main) | false(cross→~0)
    rotation: { type: 'GEOMIN', oblique: true, epsilon: 0.5 },
    estimator: 'MLR',
    modelTypes: { cfa: true, esem: true, bifactorCfa: false, bifactorEsem: false },
    bifactor: { gLabel: 'G' },
    groups: { enabled: false, variable: null, codes: [], invariance: { sequence: ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'] } },
    // Longitudinal (within-person, 2-wave) invariance: single group, two ESEM/CFA blocks sharing one
    // factor pattern. waves[0]=Time 1 columns drive the Λ grid (= spec.items); waves[1]=Time 2 columns
    // are positionally matched (waves[1][k] is the same indicator as waves[0][k], measured again).
    longitudinal: {
      enabled: false,
      waveLabels: ['Time 1', 'Time 2'],
      waves: [[], []],
      correlatedUniqueness: true, // emit "T1items PWITH T2items" (same indicator's residual across waves)
      invariance: { sequence: ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'] },
    },
    output: { line: 'SAMPSTAT STANDARDIZED RESIDUAL CINTERVAL MODINDICES (3.0) TECH2 TECH4' },
  };
  setFactorCount(spec, 2);
  return spec;
}

export function factorIds(spec) { return spec.factors.map((f) => f.id); }

/** Resize factors to k, preserving existing labels, and (re)seed the target matrix block-diagonally. */
export function setFactorCount(spec, k) {
  k = Math.max(1, Math.min(k, Math.max(1, spec.items.length - 1)));
  const old = spec.factors;
  spec.factors = Array.from({ length: k }, (_, i) => old[i] || { id: `F${i + 1}`, label: `F${i + 1}` });
  spec.factors.forEach((f, i) => { f.id = `F${i + 1}`; });
  seedTargetIfEmpty(spec);
  // drop target entries for factors that no longer exist
  const ids = new Set(factorIds(spec));
  for (const it of spec.items) {
    spec.target[it] = spec.target[it] || {};
    for (const fid of Object.keys(spec.target[it])) if (!ids.has(fid)) delete spec.target[it][fid];
    for (const fid of ids) if (!(fid in spec.target[it])) spec.target[it][fid] = false;
  }
  return spec;
}

/** Block-diagonal seed: split items evenly across factors as their main loadings. */
function seedTargetIfEmpty(spec) {
  const anyMain = spec.items.some((it) => spec.target[it] && Object.values(spec.target[it]).some(Boolean));
  if (anyMain) return;
  const ids = factorIds(spec);
  const per = Math.ceil(spec.items.length / ids.length);
  spec.items.forEach((it, idx) => {
    spec.target[it] = {};
    const fIdx = Math.min(ids.length - 1, Math.floor(idx / per));
    ids.forEach((fid, j) => { spec.target[it][fid] = j === fIdx; });
  });
}

export function setItems(spec, items) {
  spec.items = items.slice();
  // prune & extend target rows
  for (const it of items) if (!spec.target[it]) spec.target[it] = {};
  for (const it of Object.keys(spec.target)) if (!items.includes(it)) delete spec.target[it];
  // if the new selection invalidated factor count, clamp
  setFactorCount(spec, Math.min(spec.factors.length, Math.max(1, items.length - 1)));
  // re-seed cleanly when the item set changed substantially
  if (!items.some((it) => Object.values(spec.target[it]).some(Boolean))) { spec.target = {}; items.forEach((it)=>spec.target[it]={}); seedTargetIfEmpty(spec); }
  return spec;
}

/** Assign a wave's indicator columns. Wave 0 (Time 1) drives the shared Λ pattern / factors / target. */
export function setWaveItems(spec, waveIdx, cols) {
  spec.longitudinal.waves[waveIdx] = cols.slice();
  if (waveIdx === 0) setItems(spec, cols.slice()); // T1 columns ARE the shared item set / Λ grid
  return spec;
}

/** The Time-2 indicator positionally matching a Time-1 item (used by the CFA longitudinal builder). */
export function waveCounterpart(spec, t1item) {
  const i = spec.longitudinal.waves[0].indexOf(t1item);
  return i < 0 ? null : spec.longitudinal.waves[1][i];
}

export function toggleTarget(spec, item, factorId) {
  spec.target[item] = spec.target[item] || {};
  spec.target[item][factorId] = !spec.target[item][factorId];
  return spec;
}

export function mainItemsForFactor(spec, factorId) {
  return spec.items.filter((it) => spec.target[it]?.[factorId]);
}

/** Validate identification & sanity. Returns { errors:[], warnings:[] }. */
export function validateSpec(spec) {
  const errors = [], warnings = [];
  const m = spec.factors.length, n = spec.items.length;
  if (n < 3) errors.push(`Select at least 3 items (you have ${n}).`);
  if (m < 1) errors.push('Define at least one factor.');
  if (m >= n) errors.push(`Too many factors: ${m} factors for ${n} items is not identified.`);

  for (const f of spec.factors) {
    const mains = mainItemsForFactor(spec, f.id).length;
    if (mains === 0) errors.push(`${f.label} has no target (main) loadings — mark at least one cell.`);
    else if (mains < 2) warnings.push(`${f.label} has only ${mains} target item; factors are usually defined by ≥ 3.`);
  }

  if (spec.rotation.type === 'TARGET') {
    // oblique target rotation needs ≥ m(m−1) targeted zeros for rotational identification
    const needed = spec.rotation.oblique ? m * (m - 1) : (m * (m - 1)) / 2;
    let zeros = 0;
    for (const it of spec.items) for (const f of spec.factors) if (spec.target[it]?.[f.id] === false) zeros++;
    if (zeros < needed) warnings.push(`Target rotation usually needs ≥ ${needed} fixed (~0) cross-loadings for ${m} factors; you have ${zeros}.`);
  }

  if (spec.estimator === 'WLSMV' && spec.data.categorical.length === 0) warnings.push('WLSMV is selected but no items are flagged categorical.');

  if (spec.groups.enabled) {
    if (!spec.groups.variable) errors.push('Choose a grouping variable for invariance testing.');
    else if (spec.items.includes(spec.groups.variable)) errors.push(`${spec.groups.variable} is both an item and the grouping variable — remove it from the items.`);
    if ((spec.groups.codes?.length || 0) < 2) errors.push('The grouping variable needs at least two groups.');
    if ((spec.groups.invariance.sequence?.length || 0) === 0) errors.push('Select at least one invariance step (start with Configural).');
    if (spec.data.categorical.length) warnings.push('Categorical invariance constrains thresholds rather than intercepts; review the generated syntax before use.');
  }

  if (spec.longitudinal?.enabled) {
    const [w1, w2] = spec.longitudinal.waves;
    if (spec.groups.enabled) errors.push('Run either multi-group or longitudinal invariance, not both at once.');
    if ((w1?.length || 0) < 2 || (w2?.length || 0) < 2) errors.push('Assign at least two indicators to each time point.');
    else if (w1.length !== w2.length) errors.push(`Each wave needs the same number of indicators (Time 1 has ${w1.length}, Time 2 has ${w2.length}).`);
    const overlap = (w1 || []).filter((x) => (w2 || []).includes(x));
    if (overlap.length) errors.push(`Time 1 and Time 2 must use different columns (shared: ${overlap.join(', ')}).`);
    if ((spec.longitudinal.invariance.sequence?.length || 0) === 0) errors.push('Select at least one invariance step (start with Configural).');
    // (factor-count and ≥2-target-per-factor checks above already apply: spec.items === Time-1 columns.)
  }
  return { errors, warnings };
}
