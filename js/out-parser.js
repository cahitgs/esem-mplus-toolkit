// out-parser.js — parse an Mplus .out into a ParsedModel. Pure (no DOM); Node-testable.
//
// Strategy: split into lines and scan on verbatim Mplus section headers.
//  - fit: anchor the EXACT "Chi-Square Test of Model Fit" (skip "...for the Baseline Model"),
//    read forward a few lines; same for RMSEA / CFI/TLI / SRMR / Loglikelihood / IC.
//  - loadings: take the FIRST "STDYX Standardization" block and stop at the next "STD*"
//    header so the STDY/STD copies aren't double-read; track the current sub-block
//    (Fk BY / Fj WITH / Intercepts / Variances / Residual Variances).
//  - R-SQUARE → communality; δ (uniqueness) = STDYX residual variance (= 1 − R²).
//
// Verified against a real ESEM .out (ESEM.dat, Geomin oblique, MLR).

const NUMLIKE = /^(-?\d+(?:\.\d+)?|\*+)$/;

// Labeled fit lines put the value LAST (and labels like "H0"/"AIC" contain digits),
// so always take the final numeric token, e.g. "H0 Value  -32781.176" → -32781.176.
function num(s) {
  if (s == null) return null;
  const ms = String(s).match(/-?\d+(?:\.\d+)?/g);
  return ms ? parseFloat(ms[ms.length - 1]) : null;
}

function findLine(lines, re, from = 0, to = lines.length) {
  for (let i = Math.max(0, from); i < to; i++) if (re.test(lines[i])) return i;
  return -1;
}

/**
 * Tokenize a results data row. Column-count-flexible so it handles:
 *   4 cols  "X1  0.820  0.012  69.976  0.000"  (Est, S.E., Est/S.E., P) — normal
 *   3 cols  "X1  0.479  0.479  0.519"          (StdYX, StdY, Std)       — no-SE standardized
 *   1 col   "X1  1.000"                          (Estimate only)        — no-SE unstandardized
 * The first value column is always the point estimate; S.E./z/p exist only in 4-col blocks.
 */
function dataRow(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 2) return null;
  const name = t[0];
  if (/^[\d.\-]/.test(name)) return null;          // first token must be a label, not a number
  const valsTok = t.slice(1);
  if (!valsTok.every((v) => NUMLIKE.test(v))) return null;
  const toN = (v) => (/^\*+$/.test(v) ? null : parseFloat(v));
  const vals = valsTok.map(toN);
  const four = vals.length >= 4;
  return { name, est: vals[0], se: four ? vals[1] : null, z: four ? vals[2] : null, p: four ? vals[3] : null, ncol: vals.length };
}

/** Parse one standardized/unstandardized parameter region into structured blocks. */
function parseParamRegion(lines, start, end) {
  const out = { loadings: {}, factorCorr: [], residual: {}, intercepts: {}, variances: {}, regressions: [], factorOrder: [], items: [] };
  let block = null; // {kind, factor?}
  const seenItem = new Set();
  for (let i = start; i < end; i++) {
    const L = lines[i];
    if (!L || !L.trim()) continue;
    let m;
    if ((m = L.match(/^\s+(\S+)\s+BY\s*$/))) { block = { kind: 'loading', factor: m[1] }; if (!out.loadings[m[1]]) { out.loadings[m[1]] = {}; out.factorOrder.push(m[1]); } continue; }
    if ((m = L.match(/^\s+(\S+)\s+WITH\s*$/))) { block = { kind: 'with', factor: m[1] }; continue; }
    if ((m = L.match(/^\s+(\S+)\s+ON\s*$/)))   { block = { kind: 'on', factor: m[1] }; continue; }
    const trimmed = L.trim();
    if (/^(Intercepts|Means|Thresholds|Scales)$/.test(trimmed)) { block = { kind: 'intercepts' }; continue; }
    if (/^Variances$/.test(trimmed))           { block = { kind: 'variances' }; continue; }
    if (/^Residual Variances$/.test(trimmed))  { block = { kind: 'residual' }; continue; }

    const row = dataRow(L);
    if (!row || !block) continue;
    switch (block.kind) {
      case 'loading':
        out.loadings[block.factor][row.name] = row;
        if (!seenItem.has(row.name)) { seenItem.add(row.name); out.items.push(row.name); }
        break;
      case 'with':
        out.factorCorr.push({ a: block.factor, b: row.name, ...row });
        break;
      case 'on':
        out.regressions.push({ dv: block.factor, iv: row.name, ...row });
        break;
      case 'residual':   out.residual[row.name] = row.est; break;
      case 'intercepts': out.intercepts[row.name] = row.est; break;
      case 'variances':  out.variances[row.name] = row.est; break;
    }
  }
  return out;
}

export function parseOut(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const res = {
    title: null, estimator: null, rotation: null, nObs: null, nFreeParams: null,
    invKind: null, invStep: null, invModel: null,
    fit: {}, loadings: {}, factorOrder: [], items: [], factorCorr: [],
    residualVariances: {}, intercepts: {}, factorVariances: {}, rSquare: {},
    uniqueness: {}, omega: {}, primaryFactor: {}, regressions: [],
    converged: false, hasError: false, warnings: [],
  };

  res.converged = /THE MODEL ESTIMATION TERMINATED NORMALLY/.test(text);
  res.hasError = /(DID NOT TERMINATE NORMALLY|NO CONVERGENCE|PROBLEM OCCURRED|fatal error)/i.test(text);
  res.seComputed = !/STANDARD ERRORS OF THE MODEL PARAMETER ESTIMATES COULD NOT BE\s+COMPUTED/i.test(text);
  res.chiSquareComputed = !/CHI-SQUARE COULD NOT BE COMPUTED/i.test(text);
  if (!res.seComputed) res.warnings.push('Standard errors could not be computed — the model may not be identified.');
  if (!res.chiSquareComputed) res.warnings.push('Robust χ² and fit indices could not be computed for this model.');
  if (/NOT POSITIVE DEFINITE/i.test(text)) res.warnings.push('A covariance matrix was not positive definite — inspect the solution.');

  // ---- title ---- (last non-empty line before SUMMARY OF ANALYSIS)
  const summaryIdx = findLine(lines, /^SUMMARY OF ANALYSIS\s*$/);
  if (summaryIdx > 0) {
    for (let i = summaryIdx - 1; i >= 0; i--) { if (lines[i].trim()) { res.title = lines[i].trim(); break; } }
  }
  // Recognize app-generated longitudinal invariance outputs by their TITLE so the Results step can
  // group a dropped set into one sequential comparison table (these models are single-group, so
  // nGroups can't be used). "Longitudinal invariance [(CFA)] - <Step>".
  if (res.title && /^Longitudinal invariance/i.test(res.title)) {
    res.invKind = 'longitudinal';
    res.invModel = /\(CFA\)/i.test(res.title) ? 'cfa' : /\(bifactor-ESEM\)/i.test(res.title) ? 'besem' : 'esem';
    const m = res.title.match(/-\s*(.+)$/);
    res.invStep = m ? m[1].trim() : null; // e.g. "Metric (loadings)"
  }
  let mm;
  for (const L of lines.slice(0, summaryIdx > 0 ? summaryIdx + 40 : 60)) {
    if ((mm = L.match(/^Estimator\s+(\S+)/))) res.estimator = mm[1];
    if ((mm = L.match(/^Rotation\s+(\S+)/))) res.rotation = mm[1];
    if (res.nObs == null && (mm = L.match(/^Number of observations\s+(\d+)/))) res.nObs = parseInt(mm[1], 10);
  }
  // Multi-group lists per-group sizes plus a "Total sample size" line.
  const totalIdx = findLine(lines, /^\s*Total sample size\s+\d+/);
  if (totalIdx >= 0) res.nObs = num(lines[totalIdx]);
  const ngIdx = findLine(lines, /^Number of groups\s+(\d+)/);
  res.nGroups = ngIdx >= 0 ? parseInt(lines[ngIdx].match(/(\d+)\s*$/)?.[1] || '1', 10) : 1;

  // ---- fit ----
  const fitStart = findLine(lines, /^MODEL FIT INFORMATION\s*$/);
  const fit = res.fit;
  if (fitStart >= 0) {
    let i;
    if ((i = findLine(lines, /^Number of Free Parameters\s+\d+/, fitStart)) >= 0) res.nFreeParams = num(lines[i]);

    const li = findLine(lines, /^Loglikelihood\s*$/, fitStart);
    if (li >= 0) for (let j = li + 1; j < li + 10 && j < lines.length; j++) {
      if (/^\s*H0 Value\s/.test(lines[j])) fit.logLik = num(lines[j]);
      if (/^\s*H0 Scaling Correction Factor/.test(lines[j])) fit.logLikScaling = num(lines[j]);
    }
    let k;
    if ((k = findLine(lines, /^\s*Akaike \(AIC\)/, fitStart)) >= 0) fit.aic = num(lines[k]);
    if ((k = findLine(lines, /^\s*Bayesian \(BIC\)/, fitStart)) >= 0) fit.bic = num(lines[k]);
    if ((k = findLine(lines, /^\s*Sample-Size Adjusted BIC/, fitStart)) >= 0) fit.abic = num(lines[k]);

    // Chi-square — EXACT header avoids the Baseline-Model chi-square block
    const ci = findLine(lines, /^Chi-Square Test of Model Fit\s*$/, fitStart);
    if (ci >= 0) for (let j = ci + 1; j < ci + 8 && j < lines.length; j++) {
      const L = lines[j];
      if (/^\s*Value\s/.test(L)) fit.chi2 = num(L.replace('*', ''));
      else if (/^\s*Degrees of Freedom\s/.test(L)) fit.df = num(L);
      else if (/^\s*P-Value\s/.test(L)) fit.p = num(L);
      else if (/^\s*Scaling Correction Factor\s/.test(L)) fit.scalingFactor = num(L);
    }

    const ri = findLine(lines, /^RMSEA \(Root Mean Square/, fitStart);
    if (ri >= 0) for (let j = ri + 1; j < ri + 6 && j < lines.length; j++) {
      const L = lines[j];
      if (/^\s*Estimate\s/.test(L)) fit.rmsea = num(L);
      else if (/^\s*90 Percent C\.I\./.test(L)) { const ms = L.match(/(-?\d+\.\d+)\s+(-?\d+\.\d+)/); if (ms) { fit.rmseaLo = parseFloat(ms[1]); fit.rmseaHi = parseFloat(ms[2]); } }
      else if (/Probability RMSEA/.test(L)) fit.rmseaPClose = num(L);
    }

    const ti = findLine(lines, /^CFI\/TLI\s*$/, fitStart);
    if (ti >= 0) for (let j = ti + 1; j < ti + 5 && j < lines.length; j++) {
      if (/^\s*CFI\s/.test(lines[j])) fit.cfi = num(lines[j]);
      else if (/^\s*TLI\s/.test(lines[j])) fit.tli = num(lines[j]);
    }

    const si = findLine(lines, /^SRMR \(Standardized Root Mean/, fitStart);
    if (si >= 0) for (let j = si + 1; j < si + 4 && j < lines.length; j++) if (/^\s*Value\s/.test(lines[j])) { fit.srmr = num(lines[j]); break; }

    const wi = findLine(lines, /^WRMR \(Weighted Root Mean/, fitStart);
    if (wi >= 0) for (let j = wi + 1; j < wi + 4 && j < lines.length; j++) if (/^\s*Value\s/.test(lines[j])) { fit.wrmr = num(lines[j]); break; }
  }

  // ---- standardized (STDYX) parameter block ----
  const stdyxIdx = findLine(lines, /^STDYX Standardization\s*$/);
  if (stdyxIdx >= 0) {
    let end = findLine(lines, /^STDY Standardization\s*$/, stdyxIdx + 1);
    if (end < 0) end = findLine(lines, /^STD Standardization\s*$/, stdyxIdx + 1);
    if (end < 0) end = findLine(lines, /^R-SQUARE\s*$/, stdyxIdx + 1);
    if (end < 0) end = lines.length;
    const blk = parseParamRegion(lines, stdyxIdx + 1, end);
    res.loadings = blk.loadings;
    res.factorOrder = blk.factorOrder;
    res.items = blk.items;
    res.factorCorr = blk.factorCorr;
    res.residualVariances = blk.residual;
    res.intercepts = blk.intercepts;
    res.factorVariances = blk.variances;
    res.regressions = blk.regressions;
  } else if (findLine(lines, /^STANDARDIZED MODEL RESULTS\s*$/) >= 0) {
    // No-SE degraded form: a single "STANDARDIZED MODEL RESULTS" block with
    // StdYX/StdY/Std estimate columns and no "STDYX Standardization" sub-header.
    const sIdx = findLine(lines, /^STANDARDIZED MODEL RESULTS\s*$/);
    let end = findLine(lines, /^(R-SQUARE|QUALITY OF NUMERICAL|MODEL MODIFICATION|TECHNICAL|CONFIDENCE INTERVALS|RESIDUAL OUTPUT)/, sIdx + 1);
    if (end < 0) end = lines.length;
    const blk = parseParamRegion(lines, sIdx + 1, end);
    res.loadings = blk.loadings; res.factorOrder = blk.factorOrder; res.items = blk.items;
    res.factorCorr = blk.factorCorr; res.residualVariances = blk.residual;
    res.intercepts = blk.intercepts; res.factorVariances = blk.variances; res.regressions = blk.regressions;
    res.warnings.push('Standardized estimates shown without standard errors.');
  } else {
    // Fall back to unstandardized MODEL RESULTS if no standardized output requested.
    const mrIdx = findLine(lines, /^MODEL RESULTS\s*$/);
    if (mrIdx >= 0) {
      const end = findLine(lines, /^(STANDARDIZED MODEL RESULTS|R-SQUARE|QUALITY OF NUMERICAL)/, mrIdx + 1);
      const blk = parseParamRegion(lines, mrIdx + 1, end < 0 ? lines.length : end);
      res.loadings = blk.loadings; res.factorOrder = blk.factorOrder; res.items = blk.items;
      res.factorCorr = blk.factorCorr; res.residualVariances = blk.residual;
      res.intercepts = blk.intercepts; res.factorVariances = blk.variances; res.regressions = blk.regressions;
      res.warnings.push('No STANDARDIZED output found; loadings shown are unstandardized.');
    }
  }

  // ---- R-SQUARE → communality; δ = STDYX residual variance ----
  const rsIdx = findLine(lines, /^R-SQUARE\s*$/);
  if (rsIdx >= 0) {
    const end = findLine(lines, /^(QUALITY OF NUMERICAL|CONFIDENCE INTERVALS|MODEL MODIFICATION|TECHNICAL|RESIDUAL OUTPUT|DIAGRAM)/, rsIdx + 1);
    for (let i = rsIdx + 1; i < (end < 0 ? lines.length : end); i++) {
      const row = dataRow(lines[i]);
      if (row && res.items.includes(row.name)) res.rSquare[row.name] = row.est;
    }
  }
  for (const it of res.items) {
    res.uniqueness[it] = res.residualVariances[it] != null ? res.residualVariances[it]
      : (res.rSquare[it] != null ? 1 - res.rSquare[it] : null);
  }

  // ---- primary factor per item (dominant loading) ----
  for (const it of res.items) {
    let best = null, bestF = null;
    for (const f of res.factorOrder) { const v = res.loadings[f]?.[it]?.est; if (v != null && (best == null || Math.abs(v) > Math.abs(best))) { best = v; bestF = f; } }
    res.primaryFactor[it] = bestF;
  }

  // ---- detect a bifactor general factor ----
  // True bifactor: one factor loads substantially on ALL items while the others are
  // specific (load on subsets), and the factors are orthogonal. A factor literally
  // named "G" that loads on all items is also taken as the general factor (our own
  // generated bifactor models name it G).
  const substantial = (f, it) => { const v = res.loadings[f]?.[it]?.est; return v != null && Math.abs(v) >= 0.2; };
  const loadsAll = (f) => res.items.every((it) => substantial(f, it));
  const isOrthogonal = res.factorCorr.length === 0 || res.factorCorr.every((c) => Math.abs(c.est) < 0.05);
  res.generalFactor = null;
  if (res.factorOrder.length >= 2 && res.items.length >= 4) {
    let g = res.factorOrder.find((f) => f === 'G' && loadsAll(f));
    if (!g && isOrthogonal) g = res.factorOrder.find((f) => loadsAll(f)) || null;
    if (g) { const others = res.factorOrder.filter((f) => f !== g); if (others.length && others.every((f) => !loadsAll(f))) res.generalFactor = g; }
  }
  res.isBifactor = !!res.generalFactor;

  // ---- composite reliability (McDonald's ω) ----
  const omegaOver = (items, f) => {
    let sumL = 0, sumD = 0;
    for (const it of items) { const l = res.loadings[f]?.[it]?.est; const d = res.uniqueness[it]; if (l == null || d == null) return null; sumL += l; sumD += d; }
    return items.length ? (sumL * sumL) / (sumL * sumL + sumD) : null;
  };
  res.specificFactor = {};
  if (res.generalFactor) {
    const g = res.generalFactor, specifics = res.factorOrder.filter((f) => f !== g);
    res.omega[g] = omegaOver(res.items, g);                       // ω over all items for the general factor
    for (const it of res.items) {                                 // assign each item to its dominant specific factor
      let best = null, bf = null;
      for (const f of specifics) { const v = res.loadings[f]?.[it]?.est; if (v != null && (best == null || Math.abs(v) > Math.abs(best))) { best = v; bf = f; } }
      res.specificFactor[it] = bf;
    }
    for (const f of specifics) res.omega[f] = omegaOver(res.items.filter((it) => res.specificFactor[it] === f), f);
  } else {
    for (const f of res.factorOrder) res.omega[f] = omegaOver(res.items.filter((it) => res.primaryFactor[it] === f), f);
  }

  return res;
}

/** Convenience for tests / debugging. */
export function summarizeFit(p) {
  const f = p.fit;
  return `chi2=${f.chi2} df=${f.df} p=${f.p} CFI=${f.cfi} TLI=${f.tli} RMSEA=${f.rmsea}[${f.rmseaLo},${f.rmseaHi}] SRMR=${f.srmr} N=${p.nObs}`;
}
