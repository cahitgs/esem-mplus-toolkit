// syntax-generator.js — build Mplus .inp text from a ModelSpec. Pure (no DOM).
// Templates verified against the user's ESEM example library:
//   ESEM-Geomin:  ROTATION=GEOMIN(OBLIQUE[, .5]);  MODEL: F1-Fk BY <items> (*1);
//   ESEM-Target:  ROTATION=TARGET(OBLIQUE);         MODEL: Fj BY <items, cross~0> (*1);
//   CFA:          (no ROTATION)                      MODEL: Fj BY <its main items>;
// Mplus truncates input lines > 90 chars, so token lists are wrapped < 88.

import { factorIds, mainItemsForFactor, waveCounterpart } from './state.js';

const WRAP = 86;

/** Join words into a `;`-terminated statement, wrapping long lines with a 2-space continuation.
 *  A trailing parenthesized token — an ESEM set flag "(*1)"/"(*t1 1)" or an equality label —
 *  must NEVER start a continuation line by itself: Mplus silently ignores a flag/label that
 *  does not share a physical line with at least one variable (verified in Mplus 8.3 — the
 *  metric step then fits the configural model with no warning). When the flag would wrap
 *  alone, the last variable is moved down with it. */
function stmt(words) {
  const out = [];
  let cur = '';
  for (const w of words) {
    const piece = cur ? cur + ' ' + w : w;
    if (piece.length > WRAP && cur) { out.push(cur); cur = '  ' + w; }
    else cur = piece;
  }
  out.push(cur + ';');
  // keep a trailing "(...)" token attached to at least one preceding word
  const last = out[out.length - 1];
  if (out.length > 1 && /^\s*\([^()]*\);$/.test(last)) {
    const prev = out[out.length - 2].trimEnd();
    const cut = prev.lastIndexOf(' ');
    const keep = prev.slice(0, cut).trimEnd();
    const moved = '  ' + prev.slice(cut + 1) + ' ' + last.trim();
    out.splice(out.length - 2, 2, ...(keep ? [keep, moved] : [moved]));
  }
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

function headerBlocks(spec, { rotation, rotationOverride, iterations, useVars } = {}) {
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
  lines.push(stmt(['USEVARIABLES ARE', ...(useVars || spec.items)])); // longitudinal passes both waves' items
  if (spec.data.categorical?.length) lines.push(stmt(['CATEGORICAL ARE', ...spec.data.categorical]));
  if (spec.data.missingCode != null && spec.data.missingCode !== '') lines.push(`MISSING ARE ALL (${spec.data.missingCode});`);
  // Longitudinal models are single-group (explicit useVars): never emit a GROUPING line for them.
  if (!useVars && spec.groups?.enabled && spec.groups.variable) {
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

// ---------- Longitudinal (2-wave, within-person) measurement invariance ----------
// Single group, two measurement blocks (one per wave) sharing ONE factor pattern. Loadings are
// equated across waves via the ESEM block flag "(*tN 1)" (Morin et al.) or, for CFA, via shared BY
// labels. Residual & intercept invariance reuse chunkLabeled, whose labels are POSITION-based
// (i1-i6 / u1-u6) and therefore identical for both waves → cross-wave equality for free. Each
// indicator's residual is correlated across the two waves with PWITH. The app's CUMULATIVE step
// order (configural→metric→scalar→strict→varcov→latentmean) reproduces Morin's per-block syntax but
// bundles it so df increases monotonically for the comparison table (his M-numbering is not cumulative).
function longRanges(k) {
  return { t1: k > 1 ? `F1-F${k}` : 'F1', t2: k > 1 ? `F${k + 1}-F${2 * k}` : `F${k + 1}` };
}
// Correlated uniquenesses across waves: one "WITH" per matching indicator. Equivalent to Mplus
// PWITH, but PWITH requires its two lists to stay on a single line — they break ("mismatched
// variables for PWITH") once wrapped for many indicators — so we emit explicit pairwise statements,
// which are robust for any indicator count and stay well under the 90-char limit.
function pwithLines(a, b) { return a.map((it, i) => `${it} WITH ${b[i]};`); }
// Cross-sectional factor covariance equality: each matching within-wave pair shares one label.
function longCovLabels(k) {
  const out = [];
  let c = 1;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    out.push(`F${i + 1} WITH F${j + 1} (lcov${c});`);
    out.push(`F${k + i + 1} WITH F${k + j + 1} (lcov${c});`);
    c++;
  }
  return out;
}
// Which cumulative constraints a step adds (shared by the ESEM and CFA builders).
function longFlags(step) {
  return {
    equate: step !== 'configural',                                          // loadings equal across waves
    residuals: step === 'strict' || step === 'varcov' || step === 'latentmean',
    intercepts: step === 'scalar' || step === 'strict' || step === 'varcov' || step === 'latentmean',
    varcov: step === 'varcov' || step === 'latentmean',                     // T2 var refixed @1 + cov equal
    meanFix: step === 'latentmean',                                         // T2 latent means refixed @0
  };
}
// Intercept / mean lines common to both builders (only when intercepts are equated).
function longInterceptMeanLines(t1, t2, t1r, t2r, meanFix) {
  return [
    chunkLabeled(t1, 'i', true), chunkLabeled(t2, 'i', true), // [..] (i1-i6) on both waves → equal intercepts
    `[${t1r}@0];`,                                            // Time-1 latent means fixed (identification)
    meanFix ? `[${t2r}@0];` : `[${t2r}];`,                    // free Time-2 means (refix @0 for the mean test)
  ];
}

function buildLongInvarianceESEM(spec, step) {
  const [t1, t2] = spec.longitudinal.waves;
  const k = spec.factors.length;
  const { t1: t1r, t2: t2r } = longRanges(k);
  const f = longFlags(step);
  const lines = [
    ...titleLine(`Longitudinal invariance - ${INV_META[step].label}`),
    ...headerBlocks(spec, { rotation: true, iterations: 10000, useVars: [...t1, ...t2] }),
    'MODEL:',
    stmt([`${t1r} BY`, ...t1, `(*t1${f.equate ? ' 1' : ''})`]),
    stmt([`${t2r} BY`, ...t2, `(*t2${f.equate ? ' 1' : ''})`]),
  ];
  if (f.residuals) { lines.push(chunkLabeled(t1, 'u', false)); lines.push(chunkLabeled(t2, 'u', false)); }
  if (f.varcov) { lines.push(`${t2r}@1;`); lines.push(...longCovLabels(k)); } // T1 vars @1 by ESEM default
  if (f.intercepts) lines.push(...longInterceptMeanLines(t1, t2, t1r, t2r, f.meanFix));
  if (spec.longitudinal.correlatedUniqueness) lines.push(...pwithLines(t1, t2));
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// Bifactor-ESEM longitudinal invariance (Morin, Hoyle Handbook Ch. 27, T28–T41): per wave one
// general factor on all indicators plus one target block per specific factor, all in a single
// orthogonal-target ESEM set — G1/F1..Fk at Time 1 (*t1), G2/F(k+1)..F2k at Time 2 (*t2).
// varcov refixes the T2 variances AND equates every within-wave factor covariance across waves
// (G included): Mplus rejects a variances-only refix for an EFA set (error 1001) — the full
// var-cov pattern must be specified together. ITERATIONS raised per Morin's own settings for
// this model family. NOTE: Morin's published Data-2 strong→means models are PARTIAL (his z2
// intercept is non-invariant by design); the app emits FULL invariance, so on data with a truly
// non-invariant intercept the scalar/strict/varcov steps may not converge — that is the data
// speaking, not the syntax.
function buildLongInvarianceBifactorEsem(spec, step) {
  const [t1, t2] = spec.longitudinal.waves;
  const k = spec.factors.length;
  const { t1: t1r, t2: t2r } = longRanges(k);
  const f = longFlags(step);
  const flag = (w) => `(*${w}${f.equate ? ' 1' : ''})`;
  const lines = [
    ...titleLine(`Longitudinal invariance (bifactor-ESEM) - ${INV_META[step].label}`),
    ...headerBlocks(spec, { rotationOverride: 'ROTATION=TARGET(ORTHOGONAL);', iterations: 100000, useVars: [...t1, ...t2] }),
    'MODEL:',
  ];
  // one wave's measurement set: G on all items, then each specific factor's target block
  const waveBlocks = (items, gid, fBase, tag) => {
    const out = [stmt([`${gid} BY`, ...items, tag])];
    spec.factors.forEach((fac, fi) => {
      const mains = new Set(mainItemsForFactor(spec, fac.id).map((it) => items === t1 ? it : waveCounterpart(spec, it)));
      out.push(stmt([`F${fBase + fi} BY`, ...items.map((it) => (mains.has(it) ? it : `${it}~0`)), tag]));
    });
    return out;
  };
  lines.push(...waveBlocks(t1, 'G1', 1, flag('t1')));
  lines.push(...waveBlocks(t2, 'G2', k + 1, flag('t2')));
  if (f.residuals) { lines.push(chunkLabeled(t1, 'u', false)); lines.push(chunkLabeled(t2, 'u', false)); }
  if (f.varcov) {
    lines.push(`${t2r}@1;`, 'G2@1;');
    const fact1 = ['G1', ...Array.from({ length: k }, (_, i) => `F${i + 1}`)];
    const fact2 = ['G2', ...Array.from({ length: k }, (_, i) => `F${k + i + 1}`)];
    let c = 1;
    for (let i = 0; i < fact1.length; i++) for (let j = i + 1; j < fact1.length; j++) {
      lines.push(`${fact1[i]} WITH ${fact1[j]} (lcov${c});`);
      lines.push(`${fact2[i]} WITH ${fact2[j]} (lcov${c});`);
      c++;
    }
  }
  if (f.intercepts) {
    lines.push(chunkLabeled(t1, 'i', true), chunkLabeled(t2, 'i', true));
    lines.push(`[${t1r}@0];`, '[G1@0];');
    lines.push(f.meanFix ? `[${t2r}@0];` : `[${t2r}];`, f.meanFix ? '[G2@0];' : '[G2];');
  }
  if (spec.longitudinal.correlatedUniqueness) lines.push(...pwithLines(t1, t2));
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

function buildLongInvarianceCFA(spec, step) {
  const [t1, t2] = spec.longitudinal.waves;
  const k = spec.factors.length;
  const { t1: t1r, t2: t2r } = longRanges(k);
  const f = longFlags(step);
  const lines = [
    ...titleLine(`Longitudinal invariance (CFA) - ${INV_META[step].label}`),
    ...headerBlocks(spec, { rotation: false, useVars: [...t1, ...t2] }),
    'MODEL:',
  ];
  // BY lines, standardized-factor identification (first loading free *). Loadings are equated
  // across waves via shared labels (Lf_p). Mplus rejects inline per-item labels on one BY line
  // ("F1 BY X1* (L1_1) X2 ..."), so when labelling we emit ONE BY statement per loading. Time-1
  // factors (F1..Fk) are defined BEFORE Time-2 factors (F(k+1)..F2k) so the "F1-Fk"/"F(k+1)-F2k"
  // range syntax used below for variances/means stays contiguous in Mplus factor order.
  const byLines = (fNum, items, fi) => {
    if (!f.equate) return [stmt([`F${fNum} BY`, ...items.map((it, p) => (p === 0 ? `${it}*` : it))])];
    return items.map((it, p) => stmt([`F${fNum} BY`, p === 0 ? `${it}*` : it, `(L${fi + 1}_${p + 1})`]));
  };
  spec.factors.forEach((fac, fi) => lines.push(...byLines(fi + 1, mainItemsForFactor(spec, fac.id), fi)));
  spec.factors.forEach((fac, fi) => lines.push(...byLines(k + fi + 1, mainItemsForFactor(spec, fac.id).map((it) => waveCounterpart(spec, it)), fi)));
  lines.push(`${t1r}@1;`);                                    // Time-1 factor variances fix the metric
  if (!f.equate || f.varcov) lines.push(`${t2r}@1;`);         // T2 vars: @1 at configural & varcov+, else free
  if (f.residuals) { lines.push(chunkLabeled(t1, 'u', false)); lines.push(chunkLabeled(t2, 'u', false)); }
  if (f.varcov) lines.push(...longCovLabels(k));
  if (f.intercepts) lines.push(...longInterceptMeanLines(t1, t2, t1r, t2r, f.meanFix));
  if (spec.longitudinal.correlatedUniqueness) lines.push(...pwithLines(t1, t2));
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

/** Dispatch. */
export function buildInp(spec, modelType) {
  if (modelType.startsWith('linv:')) {
    const [, mt, step] = modelType.split(':');
    if (mt === 'cfa') return buildLongInvarianceCFA(spec, step);
    if (mt === 'besem') return buildLongInvarianceBifactorEsem(spec, step);
    return buildLongInvarianceESEM(spec, step);
  }
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
  // Longitudinal invariance: single-group ESEM and/or CFA sequence across two waves.
  if (spec.longitudinal?.enabled && spec.longitudinal.waves?.[0]?.length) {
    const seq = spec.longitudinal.invariance.sequence || INV_SEQUENCE;
    const MT_LABEL = { esem: 'ESEM', cfa: 'CFA', besem: 'Bifactor-ESEM' };
    const want = [];
    if (spec.modelTypes.esem) want.push('esem');
    if (spec.modelTypes.cfa) want.push('cfa');
    if (spec.modelTypes.bifactorEsem) want.push('besem');
    if (!want.length) want.push('esem');
    const out = [];
    for (const mt of want) seq.forEach((step, i) => out.push({
      key: `linv:${mt}:${step}`, step, modelType: mt,
      label: `${MT_LABEL[mt]} · ${INV_META[step].label}`,
      file: `LongInv_${mt}_${i + 1}_${step}.inp`,
    }));
    return out;
  }
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
