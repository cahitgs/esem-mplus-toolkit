// syntax-generator.js — build Mplus .inp text from a ModelSpec. Pure (no DOM).
// Templates verified against the user's ESEM example library:
//   ESEM-Geomin:  ROTATION=GEOMIN(OBLIQUE[, .5]);  MODEL: F1-Fk BY <items> (*1);
//   ESEM-Target:  ROTATION=TARGET(OBLIQUE);         MODEL: Fj BY <items, cross~0> (*1);
//   CFA:          (no ROTATION)                      MODEL: Fj BY <its main items>;
// Mplus truncates input lines > 90 chars, so token lists are wrapped < 88.

import { factorIds, mainItemsForFactor } from './state.js';

const WRAP = 86;

/** Join words into a `;`-terminated statement, wrapping long lines with a 2-space continuation. */
function stmt(words) {
  const out = [];
  let cur = '';
  for (const w of words) {
    const piece = cur ? cur + ' ' + w : w;
    if (piece.length > WRAP && cur) { out.push(cur); cur = '  ' + w; }
    else cur = piece;
  }
  out.push(cur + ';');
  return out.join('\n');
}

/** Wrap a list of already-terminated mini-statements (e.g. "F1*;") to ≤ WRAP chars per line.
 *  Identical to a plain "; "-join for a handful of factors; only wraps when there are many. */
function wrapList(parts) {
  const out = [];
  let cur = '';
  for (const p of parts) { const piece = cur ? cur + ' ' + p : p; if (piece.length > WRAP && cur) { out.push(cur); cur = p; } else cur = piece; }
  if (cur) out.push(cur);
  return out.join('\n');
}

/** Emit equality-labelled intercept/uniqueness statements split into ONE-LINE chunks.
 *  Mplus associates a trailing "(labels)" only with the LAST physical line of a wrapped statement,
 *  so `[M1 … M24] (i1-i24)` spanning two lines silently labels just M24 ("more labels than
 *  parameters") and leaves M1–M23 unconstrained → the invariance model is mis-identified. Keeping
 *  each labelled statement on a single line (chunked) fixes this for any number of items.
 *  bracket=true → "[a b] (p1-p2);" (intercepts); false → "a b (p1-p2);" (residual variances). */
function chunkLabeled(items, prefix, bracket) {
  const open = bracket ? '[' : '', close = bracket ? ']' : '';
  const make = (i, end) => `${open}${items.slice(i, end + 1).join(' ')}${close} (${prefix}${i + 1}${end > i ? `-${prefix}${end + 1}` : ''});`;
  const lines = [];
  let i = 0;
  while (i < items.length) {
    let j = i;
    while (j + 1 < items.length && make(i, j + 1).length <= WRAP) j++;
    lines.push(make(i, j));
    i = j + 1;
  }
  return lines.join('\n');
}

function fmtEpsilon(e) {
  if (e == null) return '';
  let s = String(e);
  if (Math.abs(e) < 1) s = s.replace(/^(-?)0\./, '$1.');
  return ', ' + s;
}

function rotationLine(spec) {
  const kind = spec.rotation.oblique ? 'OBLIQUE' : 'ORTHOGONAL';
  if (spec.rotation.type === 'TARGET') return `ROTATION=TARGET(${kind});`;
  return `ROTATION=GEOMIN(${kind}${fmtEpsilon(spec.rotation.epsilon)});`;
}

function headerBlocks(spec, { rotation, rotationOverride, iterations } = {}) {
  // Point at the Mplus-ready .dat (space-delimited, no header) the app exports — the original
  // upload may be a semicolon CSV or carry a header, which Mplus cannot read directly.
  const file = spec.data.mplusFile || spec.data.fileName || 'data.dat';
  const lines = [];
  lines.push('DATA:');
  // Mplus truncates lines > 90 chars; keep a long path on its own line.
  const fileLine = `FILE = "${file}";`;
  lines.push(fileLine.length > WRAP ? `FILE =\n"${file}";` : fileLine);
  lines.push('VARIABLE:');
  lines.push(stmt(['NAMES ARE', ...spec.data.varNames]));
  lines.push(stmt(['USEVARIABLES ARE', ...spec.items]));
  if (spec.data.categorical?.length) lines.push(stmt(['CATEGORICAL ARE', ...spec.data.categorical]));
  if (spec.data.missingCode != null && spec.data.missingCode !== '') lines.push(`MISSING ARE ALL (${spec.data.missingCode});`);
  if (spec.groups?.enabled && spec.groups.variable) {
    const codes = spec.groups.codes.map((c) => `${c.code} = ${c.label}`).join(' ');
    lines.push(`GROUPING IS ${spec.groups.variable} (${codes});`);
  }
  lines.push('ANALYSIS:');
  lines.push(`ESTIMATOR IS ${spec.estimator};`);
  if (rotationOverride) lines.push(rotationOverride);
  else if (rotation) lines.push(rotationLine(spec));
  if (iterations) lines.push(`ITERATIONS = ${iterations};`);
  return lines;
}

function outputBlock(spec, { svalues = false } = {}) {
  // SVALUES prints the "MODEL COMMAND WITH FINAL ESTIMATES USED AS STARTING VALUES" block —
  // required to convert an ESEM solution into ESEM-within-CFA (see js/ewc.js). Harmless elsewhere.
  let words = spec.output.line.split(/\s+/);
  if (svalues && !words.some((w) => /^SVALUES$/i.test(w))) {
    const insertAt = words.findIndex((w) => /^(MODINDICES|TECH\d|CINTERVAL)$/i.test(w));
    words = insertAt < 0 ? [...words, 'SVALUES'] : [...words.slice(0, insertAt), 'SVALUES', ...words.slice(insertAt)];
  }
  return ['OUTPUT:', stmt(words)];
}

function titleLine(text) { return ['TITLE:', text]; }

// Morin's standardized-factor identification: free the first loading (*) and fix the factor
// variance to 1, instead of Mplus's default marker (first loading fixed to 1). This keeps the
// CFA metric consistent with ESEM (where factor variances are fixed to 1).
function cfaByLine(fid, items) {
  return stmt([`${fid} BY`, `${items[0]}*`, ...items.slice(1)]);
}

// ESEM measurement block(s), rotation-aware. Geomin → one range line; Target → one line per
// factor with cross-loadings given the target value 0 via "~0".
function esemByBlocks(spec, tag) {
  const ids = factorIds(spec);
  if (spec.rotation.type === 'TARGET') {
    return spec.factors.map((f) => stmt([`${f.id} BY`, ...spec.items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`)), tag]));
  }
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  return [stmt([`${range} BY`, ...spec.items, tag])];
}

// ---------- CFA ----------
function buildCFA(spec) {
  const ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const lines = [...titleLine(`CFA - ${spec.factors.length} factors`), ...headerBlocks(spec, { rotation: false }), 'MODEL:'];
  for (const f of spec.factors) lines.push(cfaByLine(f.id, mainItemsForFactor(spec, f.id)));
  lines.push(`${range}@1;`); // fix factor variances to 1 (first loading freed above)
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// ---------- ESEM (Geomin) ----------
function buildESEMGeomin(spec) {
  const ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const lines = [
    ...titleLine(`ESEM (Geomin ${spec.rotation.oblique ? 'oblique' : 'orthogonal'}) - ${ids.length} factors`),
    ...headerBlocks(spec, { rotation: true }), 'MODEL:',
    stmt([`${range} BY`, ...spec.items, '(*1)']),
    ...outputBlock(spec, { svalues: true }),
  ];
  return lines.join('\n') + '\n';
}

// ---------- ESEM (Target) ----------
function buildESEMTarget(spec) {
  const lines = [
    ...titleLine(`ESEM (Target ${spec.rotation.oblique ? 'oblique' : 'orthogonal'}) - ${spec.factors.length} factors`),
    ...headerBlocks(spec, { rotation: true }), 'MODEL:',
  ];
  for (const f of spec.factors) {
    const toks = spec.items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`));
    lines.push(stmt([`${f.id} BY`, ...toks, '(*1)']));
  }
  lines.push(...outputBlock(spec, { svalues: true }));
  return lines.join('\n') + '\n';
}

// ---------- Bifactor-CFA (orthogonal general + specific factors) ----------
function orthogonalityLines(ids) {
  const out = [];
  for (let i = 0; i < ids.length - 1; i++) out.push(stmt([`${ids[i]} WITH`, ...ids.slice(i + 1).map((x) => `${x}@0`)]));
  return out;
}
function buildBifactorCfa(spec) {
  const ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const lines = [...titleLine(`Bifactor-CFA - ${spec.factors.length} specific factors`), ...headerBlocks(spec, { rotation: false }), 'MODEL:'];
  lines.push(cfaByLine('G', spec.items));                                  // general factor on all items
  for (const f of spec.factors) lines.push(cfaByLine(f.id, mainItemsForFactor(spec, f.id)));
  lines.push(`G@1;`, `${range}@1;`);                                       // fix all factor variances to 1
  lines.push(...orthogonalityLines(['G', ...ids]));                        // bifactor: all factors orthogonal
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// ---------- Bifactor-ESEM ----------
// Geomin → Morin's primary BI-GEOMIN(ORTHOGONAL) rotation (the first factor is auto-estimated
// as the G-factor). Target → orthogonal target rotation with an all-main G block + target S blocks.
function buildBifactorEsem(spec) {
  const ids = factorIds(spec);
  if (spec.rotation.type === 'TARGET') {
    const lines = [
      ...titleLine(`Bifactor-ESEM (target orthogonal) - ${spec.factors.length} specific factors`),
      ...headerBlocks(spec, { rotationOverride: 'ROTATION=TARGET(ORTHOGONAL);' }), 'MODEL:',
      stmt(['G BY', ...spec.items, '(*1)']),
    ];
    for (const f of spec.factors) lines.push(stmt([`${f.id} BY`, ...spec.items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`)), '(*1)']));
    lines.push(...outputBlock(spec, { svalues: true }));
    return lines.join('\n') + '\n';
  }
  // BI-GEOMIN: list the general factor (G) plus the specific-factor range in one ESEM set.
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const eps = fmtEpsilon(spec.rotation.epsilon).replace(/^,\s*/, ' ');     // "BI-GEOMIN(ORTHOGONAL .5)"
  const lines = [
    ...titleLine(`Bifactor-ESEM (BI-GEOMIN orthogonal) - ${spec.factors.length} specific factors`),
    ...headerBlocks(spec, { rotationOverride: `ROTATION=BI-GEOMIN(ORTHOGONAL${eps});` }), 'MODEL:',
    stmt([`G ${range} BY`, ...spec.items, '(*1)']),
    ...outputBlock(spec, { svalues: true }),
  ];
  return lines.join('\n') + '\n';
}

// ---------- Multi-group measurement invariance (ESEM) ----------
export const INV_SEQUENCE = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
export const INV_META = {
  configural: { label: 'Configural', short: 'configural' },
  metric: { label: 'Metric (loadings)', short: 'weak (metric)' },
  scalar: { label: 'Scalar (intercepts)', short: 'strong (scalar)' },
  strict: { label: 'Strict (residuals)', short: 'strict' },
  varcov: { label: 'Factor var/cov', short: 'variance–covariance' },
  latentmean: { label: 'Latent means', short: 'latent mean' },
};

// Measurement invariance following Morin et al. (2023): explicit per-group sections, the
// ESEM block in the user's rotation, factor variances fixed to 1 (freed in non-reference
// groups from weak onward), factor means fixed to 0 (freed from strong onward, refixed for
// the latent-mean test), and alphanumeric equality labels (i# intercepts, u# uniquenesses,
// cov# covariances). Loadings are invariant by default from weak onward (BY omitted in groups).
function buildInvariance(spec, step) {
  const items = spec.items, N = items.length, ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const by = esemByBlocks(spec, '(*1)');
  const brackets = (label) => stmt([`[${items[0]}`, ...items.slice(1, -1), `${items[N - 1]}]${label ? ' ' + label : ''}`]);
  const intFree = brackets('');                       // unlabelled bracket may wrap (Mplus reads all vars)
  const intInv = chunkLabeled(items, 'i', true);      // labelled → one line per chunk (see chunkLabeled)
  const uniqFree = stmt(items);
  const uniqInv = chunkLabeled(items, 'u', false);
  const varFix = `${range}@1;`, meanFix = `[${range}@0];`;
  const varFree = wrapList(spec.factors.map((f) => `${f.id}*;`));
  const meanFree = wrapList(spec.factors.map((f) => `[${f.id}*];`));
  const covLabels = [];
  let c = 1;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) covLabels.push(`${ids[i]} WITH ${ids[j]} (cov${c++});`);

  let main, grp;
  switch (step) {
    case 'configural': main = [...by, varFix, meanFix, intFree, uniqFree]; grp = [...by, varFix, meanFix, intFree, uniqFree]; break;
    case 'metric':     main = [...by, varFix, meanFix, intFree, uniqFree]; grp = [varFree, meanFix, intFree, uniqFree]; break;
    case 'scalar':     main = [...by, varFix, meanFix, intInv, uniqFree];  grp = [varFree, meanFree, intInv, uniqFree]; break;
    case 'strict':     main = [...by, varFix, meanFix, intInv, uniqInv];   grp = [varFree, meanFree, intInv, uniqInv]; break;
    case 'varcov':     main = [...by, varFix, ...covLabels, meanFix, intInv, uniqInv]; grp = [varFix, ...covLabels, meanFree, intInv, uniqInv]; break;
    case 'latentmean': main = [...by, varFix, ...covLabels, meanFix, intInv, uniqInv]; grp = [varFix, ...covLabels, meanFix, intInv, uniqInv]; break;
    default: throw new Error(`Unknown invariance step: ${step}`);
  }

  // ESEM measurement invariance is iteration-heavy (rotation re-estimated under cross-group
  // constraints); raise the optimizer cap so complex models (many factors/items) still converge.
  const lines = [...titleLine(`MG invariance - ${INV_META[step].label}`), ...headerBlocks(spec, { rotation: true, iterations: 10000 }), 'MODEL:', ...main];
  for (const code of spec.groups.codes.slice(1)) { lines.push(`MODEL ${code.label}:`, ...grp); }
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

/** Dispatch. */
export function buildInp(spec, modelType) {
  if (modelType.startsWith('inv:')) return buildInvariance(spec, modelType.slice(4));
  switch (modelType) {
    case 'cfa': return buildCFA(spec);
    case 'esem': return spec.rotation.type === 'TARGET' ? buildESEMTarget(spec) : buildESEMGeomin(spec);
    case 'bifactorCfa': return buildBifactorCfa(spec);
    case 'bifactorEsem': return buildBifactorEsem(spec);
    default: throw new Error(`Unknown model type: ${modelType}`);
  }
}

/** Which models the spec asks for, in display order. */
export function requestedModels(spec) {
  // Measurement-invariance workflow: when grouping is on, generate the invariance sequence.
  if (spec.groups?.enabled && spec.groups.variable) {
    return (spec.groups.invariance.sequence || INV_SEQUENCE).map((step, i) => ({
      key: `inv:${step}`, label: INV_META[step].label, file: `Inv_${i + 1}_${step}.inp`, step,
    }));
  }
  const out = [];
  if (spec.modelTypes.cfa) out.push({ key: 'cfa', label: 'CFA', file: `CFA_${spec.factors.length}f.inp` });
  if (spec.modelTypes.esem) out.push({ key: 'esem', label: `ESEM (${spec.rotation.type === 'TARGET' ? 'Target' : 'Geomin'})`, file: `ESEM_${spec.rotation.type.toLowerCase()}_${spec.factors.length}f.inp` });
  if (spec.modelTypes.bifactorCfa) out.push({ key: 'bifactorCfa', label: 'Bifactor-CFA', file: `BifactorCFA_${spec.factors.length}s.inp` });
  if (spec.modelTypes.bifactorEsem) out.push({ key: 'bifactorEsem', label: 'Bifactor-ESEM', file: `BifactorESEM_${spec.factors.length}s.inp` });
  return out;
}

/** Longest line length — used by tests to assert the 90-char Mplus limit. */
export function maxLineLength(inp) {
  return inp.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
}
