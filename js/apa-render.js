// apa-render.js — render ParsedModel(s) into APA tables + prose (HTML strings). Pure.
// Number format follows APA: leading zero stripped for |x|<1; χ² 2 dp; loadings/fit 3 dp.
import { apaNum, apaP } from './ui.js';

const f2 = (x) => apaNum(x, 2, false);   // χ², no strip
const f3 = (x) => apaNum(x, 3);          // CFI/TLI/RMSEA/SRMR/λ/ω, strip leading zero
const ci = (lo, hi) => (lo == null || hi == null ? '—' : `[${f3(lo)}, ${f3(hi)}]`);

// ---- regularized upper incomplete gamma → chi-square upper-tail p-value ----
function gammaln(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (let j = 0; j < 6; j++) s += c[j] / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
function pchisqUpper(x, k) {
  if (x <= 0 || k <= 0) return 1;
  const a = k / 2, xx = x / 2;
  if (xx < a + 1) { // series for lower P
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 200; n++) { ap++; del *= xx / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return 1 - sum * Math.exp(-xx + a * Math.log(xx) - gammaln(a));
  }
  let b = xx + 1 - a, c = 1e300, d = 1 / b, h = d; // continued fraction for upper Q
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return h * Math.exp(-xx + a * Math.log(xx) - gammaln(a));
}

/** Satorra–Bentler scaled χ² difference. mc = more constrained (larger df), mu = less constrained. */
export function sbChiSqDiff(mc, mu) {
  const { chi2: T0, scalingFactor: c0, df: df0 } = mc;
  const { chi2: T1, scalingFactor: c1, df: df1 } = mu;
  if ([T0, df0, T1, df1].some((v) => v == null) || df0 === df1) return null;
  const cc0 = c0 == null ? 1 : c0, cc1 = c1 == null ? 1 : c1;
  const cd = (df0 * cc0 - df1 * cc1) / (df0 - df1);
  if (!(cd > 0)) return null;
  const TRd = (T0 * cc0 - T1 * cc1) / cd;
  const ddf = Math.abs(df0 - df1);
  return { TRd, df: ddf, p: pchisqUpper(TRd, ddf), scaled: c0 != null || c1 != null };
}

function verdict(fit) {
  if (fit.cfi == null || fit.rmsea == null) return 'an estimable';
  if (fit.cfi >= 0.95 && fit.tli >= 0.95 && fit.rmsea <= 0.06) return 'excellent';
  if (fit.cfi >= 0.90 && fit.rmsea <= 0.08) return 'acceptable';
  return 'poor';
}

// ============================ Fit table ============================
/**
 * models: [{ label, parsed }]. deltaMode: 'consecutive' (each row vs the row above) | 'none'.
 * Δχ² uses the Satorra–Bentler scaling; the row above is treated as the more-constrained model
 * when it has the larger df.
 */
export function renderFitTable(models, { deltaMode = 'consecutive', caption = 'Goodness-of-fit statistics', wlsmv = null } = {}) {
  // Auto-detect WLSMV: no model reports SRMR but at least one reports WRMR.
  const useWrmr = wlsmv != null ? wlsmv : (!models.some((m) => m.parsed.fit.srmr != null) && models.some((m) => m.parsed.fit.wrmr != null));
  const fitCol = useWrmr ? 'WRMR' : 'SRMR';
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', fitCol];
  if (deltaMode !== 'none') head.push('Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔRMSEA');
  let rows = '';
  models.forEach((m, i) => {
    const f = m.parsed.fit;
    const cells = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli),
      `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`, f3(useWrmr ? f.wrmr : f.srmr)];
    if (deltaMode !== 'none') {
      if (i === 0) cells.push('—', '—', '—', '—');
      else {
        const prev = models[i - 1].parsed.fit, cur = f;
        const mc = (prev.df ?? 0) >= (cur.df ?? 0) ? prev : cur;
        const mu = mc === prev ? cur : prev;
        const sb = useWrmr ? null : sbChiSqDiff(mc, mu);  // SB scaled diff is MLR-only
        const dcfi = cur.cfi != null && prev.cfi != null ? cur.cfi - prev.cfi : null;
        const drmsea = cur.rmsea != null && prev.rmsea != null ? cur.rmsea - prev.rmsea : null;
        cells.push(
          sb ? `${f2(sb.TRd)}${sb.p < 0.05 ? '*' : ''}` : '—',
          sb ? sb.df : '—',
          dcfi != null ? signed(dcfi, 3) : '—',
          drmsea != null ? signed(drmsea, 3) : '—',
        );
      }
    }
    rows += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  });
  const note = `<p class="apa-note"><i>Note.</i> N = ${models[0]?.parsed.nObs ?? '—'}. CFI = comparative fit index; TLI = Tucker–Lewis index; RMSEA = root mean square error of approximation; ${fitCol} = ${useWrmr ? 'weighted' : 'standardized'} root mean square residual.${useWrmr ? ' For the WLSMV estimator, χ² differences require the DIFFTEST option; compare models via ΔCFI/ΔRMSEA.' : ' Δχ²(s) = Satorra–Bentler scaled χ² difference for the MLR estimator.'} * <i>p</i> &lt; .05.</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption>`
    + `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${note}`;
}

function signed(x, dp) { const s = apaNum(Math.abs(x), dp); return (x < 0 ? '−' : '+') + s; }

// ======================= Measurement-invariance table =======================
/** ΔCFI ≥ −.010 and ΔRMSEA ≤ .015 → invariance at this step is supported (Chen, 2007). */
export function invarianceDecision(prev, cur) {
  if (!prev) return { ok: null, text: '—', dcfi: null, drmsea: null };
  const dcfi = (cur.cfi != null && prev.cfi != null) ? cur.cfi - prev.cfi : null;
  const drmsea = (cur.rmsea != null && prev.rmsea != null) ? cur.rmsea - prev.rmsea : null;
  const ok = dcfi != null && drmsea != null && dcfi >= -0.010 && drmsea <= 0.015;
  return { ok, text: dcfi == null ? '—' : (ok ? 'Supported' : 'Not supported'), dcfi, drmsea };
}

export function renderInvarianceTable(models, { caption, longitudinal = false } = {}) {
  if (!caption) caption = longitudinal ? 'Tests of longitudinal measurement invariance' : 'Tests of measurement invariance across groups';
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', 'Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔRMSEA', 'Decision'];
  let rows = '';
  models.forEach((m, i) => {
    const f = m.parsed.fit, prev = i ? models[i - 1].parsed.fit : null;
    const dec = invarianceDecision(prev, f);
    let dchi = '—', ddf = '—';
    if (prev) { const mc = (prev.df ?? 0) >= (f.df ?? 0) ? prev : f; const mu = mc === prev ? f : prev; const sb = sbChiSqDiff(mc, mu); if (sb) { dchi = f2(sb.TRd) + (sb.p < 0.05 ? '*' : ''); ddf = sb.df; } }
    const colour = dec.ok === true ? 'color:var(--good)' : dec.ok === false ? 'color:var(--danger)' : '';
    const cells = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`,
      dchi, ddf, dec.dcfi != null ? signed(dec.dcfi, 3) : '—', dec.drmsea != null ? signed(dec.drmsea, 3) : '—',
      `<span style="${colour};font-weight:600">${dec.text}</span>`];
    rows += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  });
  const across = longitudinal ? 'across two time points' : `across ${models[0]?.parsed.nGroups ?? 2} groups`;
  const note = `<p class="apa-note"><i>Note.</i> N = ${models[0]?.parsed.nObs ?? '—'} ${across}. Models are ordered from least to most constrained; each Δ compares with the preceding model. Invariance is supported when ΔCFI ≥ −.010 and ΔRMSEA ≤ .015 (Chen, 2007). Δχ²(s) = Satorra–Bentler scaled difference. * <i>p</i> &lt; .05.</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${note}`;
}

export function renderInvarianceProse(models, { longitudinal = false } = {}) {
  if (models.length < 2) return '';
  const over = longitudinal ? 'across the two time points' : 'across groups';
  const supported = [], failedAt = [];
  models.forEach((m, i) => {
    if (i === 0) { supported.push(m.label); return; }
    const dec = invarianceDecision(models[i - 1].parsed.fit, m.parsed.fit);
    if (dec.ok) supported.push(m.label); else failedAt.push({ m, dec });
  });
  let s = `Configural invariance provided a baseline against which more constrained models were compared. `;
  if (!failedAt.length) {
    const held = joinList(supported.slice(1).map((x) => x.toLowerCase()));
    s += `All constraints were tenable: ${held} invariance were each supported (ΔCFI ≥ −.010, ΔRMSEA ≤ .015), indicating full measurement invariance ${over}.`;
  } else {
    const first = failedAt[0];
    const held = supported.slice(1).map((x) => x.toLowerCase());
    s += held.length ? `${joinList(held)} invariance ${held.length > 1 ? 'were' : 'was'} supported, but ` : '';
    s += `${first.m.label.toLowerCase()} invariance was not supported (ΔCFI = ${signed(first.dec.dcfi, 3)}, ΔRMSEA = ${signed(first.dec.drmsea, 3)}), indicating non-invariance at this level. Partial-invariance follow-ups (freeing the most divergent parameters via modification indices) are recommended before comparing ${longitudinal ? 'time points' : 'groups'} further.`;
  }
  return `<p class="apa-prose">${s}</p>`;
}

// ======================= Loadings table =======================
export function renderLoadingsTable(parsed, { targetMatrix = null, factorLabels = {}, caption = 'Standardized factor loadings (STDYX)' } = {}) {
  const factors = parsed.factorOrder;
  const lbl = (fid) => factorLabels[fid] || fid;
  const isTarget = (item, fid) => {
    if (targetMatrix) return !!targetMatrix[item]?.[fid];
    if (parsed.generalFactor) return fid === parsed.generalFactor || parsed.specificFactor[item] === fid;
    return parsed.primaryFactor[item] === fid;
  };

  const head = ['Item', ...factors.map(lbl), 'δ'];
  let body = '';
  for (const it of parsed.items) {
    const cells = [`<td>${it}</td>`];
    for (const fid of factors) {
      const v = parsed.loadings[fid]?.[it]?.est;
      const cls = isTarget(it, fid) ? 'target' : 'crossload';
      cells.push(`<td class="${cls}">${f3(v)}</td>`);
    }
    cells.push(`<td>${f3(parsed.uniqueness[it])}</td>`);
    body += `<tr>${cells.join('')}</tr>`;
  }
  // ω row
  let omegaRow = `<tr class="grp-rule"><td colspan="${head.length}"></td></tr><tr><td>ω</td>`;
  for (const fid of factors) omegaRow += `<td>${f3(parsed.omega[fid])}</td>`;
  omegaRow += '<td></td></tr>';

  // factor-correlation lower triangle, aligned under the factor columns
  const corr = corrLookup(parsed);
  let corrRows = '';
  factors.forEach((fid, i) => {
    if (i === 0) return; // first factor has no lower-triangle entries
    const cells = [`<td>${lbl(fid)}</td>`];
    factors.forEach((gid, j) => {
      if (j < i) cells.push(`<td>${f3(corr(fid, gid))}</td>`);
      else if (j === i) cells.push('<td>—</td>');
      else cells.push('<td></td>');
    });
    cells.push('<td></td>');
    corrRows += `<tr>${cells.join('')}</tr>`;
  });
  const corrHeader = `<tr class="grp-rule"><td colspan="${head.length}"></td></tr><tr><td colspan="${head.length}" style="text-align:left;font-style:italic">Factor correlations</td></tr>`;

  const note = `<p class="apa-note"><i>Note.</i> Target (primary) loadings in <b>bold</b>; cross-loadings in grey. δ = uniqueness (1 − R²); ω = McDonald's composite reliability.</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption>`
    + `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
    + `<tbody>${body}${omegaRow}${corrHeader}${corrRows}</tbody></table>${note}`;
}

function corrLookup(parsed) {
  const map = new Map();
  for (const c of parsed.factorCorr) { map.set(`${c.a}|${c.b}`, c.est); map.set(`${c.b}|${c.a}`, c.est); }
  return (a, b) => (map.has(`${a}|${b}`) ? map.get(`${a}|${b}`) : null);
}

// ============================ Prose ============================
export function renderProse(models, { factorLabels = {} } = {}) {
  const paras = [];
  for (const m of models) {
    const f = m.parsed.fit;
    const v = verdict(f);
    paras.push(`The ${esc(m.label)} model provided ${v} fit to the data, <span class="stat">χ²</span>(${f.df}) = ${f2(f.chi2)}, <span class="stat">p</span> ${apaP(f.p)}, CFI = ${f3(f.cfi)}, TLI = ${f3(f.tli)}, RMSEA = ${f3(f.rmsea)} [90% CI ${f3(f.rmseaLo)}, ${f3(f.rmseaHi)}], SRMR = ${f3(f.srmr)}. ${loadingsSentence(m.parsed)}`);
  }
  const cmp = models.length >= 2 ? comparisonSentence(models) : '';
  if (cmp) paras.push(cmp);
  return paras.map((p) => `<p class="apa-prose">${p}</p>`).join('');
}

function loadingsSentence(p) {
  const targets = [];
  for (const it of p.items) { const fid = p.primaryFactor[it]; const v = p.loadings[fid]?.[it]?.est; if (v != null) targets.push(Math.abs(v)); }
  const omegas = Object.values(p.omega).filter((x) => x != null);
  if (!targets.length) return '';
  const lmin = f3(Math.min(...targets)), lmax = f3(Math.max(...targets));
  const wmin = omegas.length ? f3(Math.min(...omegas)) : null, wmax = omegas.length ? f3(Math.max(...omegas)) : null;
  let s = `Target standardized loadings ranged from |λ| = ${lmin} to ${lmax}`;
  if (wmin) s += `, with composite reliabilities of ω = ${wmin} to ${wmax}`;
  return s + '.';
}

function comparisonSentence(models) {
  const corrMean = (p) => { const v = p.factorCorr.map((c) => Math.abs(c.est)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const a = models[0].parsed, b = models[models.length - 1].parsed;
  const ra = corrMean(a), rb = corrMean(b);
  if (ra == null || rb == null) return '';
  const dir = rb < ra ? 'lower' : 'higher';
  return `<p class="apa-prose">Relative to the ${esc(models[0].label)} solution (mean |r| = ${f3(ra)}), factor correlations were ${dir} in the ${esc(models[models.length - 1].label)} solution (mean |r| = ${f3(rb)}), consistent with the expected effect of freely estimating cross-loadings.</p>`;
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function joinList(arr) { if (arr.length <= 1) return arr[0] || ''; if (arr.length === 2) return arr.join(' and '); return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1]; }
