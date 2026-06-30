// docx-export.js — export APA results to Word. Three paths:
//   copyResultsToWord(models)  → rich clipboard HTML (paste into Word keeps tables + bold)
//   exportDocx(models)         → a real .docx via the `docx` UMD global
//   zipInputs(files)           → bundle generated .inp files via the `JSZip` UMD global
import { apaNum, apaP, toast, downloadBlob } from './ui.js';
import { sbChiSqDiff, invarianceDecision } from './apa-render.js';

const splitGroups = (models) => ({
  multi: models.filter((m) => (m.parsed.nGroups || 1) > 1).sort((a, b) => (a.parsed.fit.df ?? 0) - (b.parsed.fit.df ?? 0)),
  single: models.filter((m) => (m.parsed.nGroups || 1) <= 1),
});

function invRows(models) {
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', 'ΔCFI', 'ΔRMSEA', 'Decision'];
  const body = models.map((m, i) => {
    const f = m.parsed.fit, dec = invarianceDecision(i ? models[i - 1].parsed.fit : null, f);
    return [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`,
      dec.dcfi != null ? signed(dec.dcfi) : '—', dec.drmsea != null ? signed(dec.drmsea) : '—', dec.text];
  });
  return { head, body };
}
function invProseText(models) {
  if (models.length < 2) return [];
  const sup = [], fail = [];
  models.forEach((m, i) => { if (i === 0) { sup.push(m.label); return; } const d = invarianceDecision(models[i - 1].parsed.fit, m.parsed.fit); if (d.ok) sup.push(m.label); else fail.push({ m, d }); });
  if (!fail.length) return [`All invariance constraints were tenable across groups (ΔCFI ≥ −.010, ΔRMSEA ≤ .015), supporting full measurement invariance.`];
  const f = fail[0];
  return [`Measurement invariance held up to the ${sup[sup.length - 1].toLowerCase()} level, but ${f.m.label.toLowerCase()} invariance was not supported (ΔCFI = ${signed(f.d.dcfi)}, ΔRMSEA = ${signed(f.d.drmsea)}).`];
}

const f2 = (x) => apaNum(x, 2, false);
const f3 = (x) => apaNum(x, 3);
const ci = (lo, hi) => (lo == null || hi == null ? '—' : `[${f3(lo)}, ${f3(hi)}]`);
const isTarget = (p, it, fid, target) => {
  if (target) return !!target[it]?.[fid];
  if (p.generalFactor) return fid === p.generalFactor || p.specificFactor[it] === fid;
  return p.primaryFactor[it] === fid;
};

// ----------------------------------------------------------------------------
// Shared row model so the HTML and .docx builders stay in lockstep.
// ----------------------------------------------------------------------------
function fitRows(models) {
  const multi = models.length > 1;
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', 'SRMR'];
  if (multi) head.push('Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔRMSEA');
  const body = models.map((m, i) => {
    const f = m.parsed.fit;
    const r = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`, f3(f.srmr)];
    if (multi) {
      if (i === 0) r.push('—', '—', '—', '—');
      else {
        const prev = models[i - 1].parsed.fit, cur = f;
        const mc = (prev.df ?? 0) >= (cur.df ?? 0) ? prev : cur;
        const sb = sbChiSqDiff(mc, mc === prev ? cur : prev);
        const dcfi = cur.cfi != null && prev.cfi != null ? cur.cfi - prev.cfi : null;
        const drm = cur.rmsea != null && prev.rmsea != null ? cur.rmsea - prev.rmsea : null;
        r.push(sb ? f2(sb.TRd) + (sb.p < 0.05 ? '*' : '') : '—', sb ? sb.df : '—',
          dcfi != null ? signed(dcfi) : '—', drm != null ? signed(drm) : '—');
      }
    }
    return r;
  });
  return { head, body };
}
function signed(x) { return (x < 0 ? '−' : '+') + apaNum(Math.abs(x), 3); }

function loadingRows(p, target) {
  const factors = p.factorOrder;
  const head = ['Item', ...factors, 'δ'];
  const body = p.items.map((it) => ({
    cells: [it, ...factors.map((fid) => f3(p.loadings[fid]?.[it]?.est)), f3(p.uniqueness[it])],
    bold: [false, ...factors.map((fid) => isTarget(p, it, fid, target)), false],
  }));
  const omega = ['ω', ...factors.map((fid) => f3(p.omega[fid])), ''];
  // factor correlations (lower triangle)
  const cmap = new Map();
  for (const c of p.factorCorr) { cmap.set(`${c.a}|${c.b}`, c.est); cmap.set(`${c.b}|${c.a}`, c.est); }
  const corr = factors.map((fid, i) => {
    if (i === 0) return null;
    return [fid, ...factors.map((gid, j) => (j < i ? f3(cmap.get(`${fid}|${gid}`)) : j === i ? '—' : '')), ''];
  }).filter(Boolean);
  return { head, body, omega, corr };
}

// ----------------------------------------------------------------------------
// Word clipboard (HTML)
// ----------------------------------------------------------------------------
function buildWordHtml(models, { factorLabels = {} } = {}) {
  const { multi, single } = splitGroups(models);
  const lbl = (p, fid) => (factorLabels[fid] || fid);
  const TBL = 'border-collapse:collapse;font-family:Calibri,sans-serif;font-size:11pt;margin:6pt 0;';
  const top = 'border-top:1.5pt solid #000;', bot = 'border-bottom:1.5pt solid #000;', hbot = 'border-bottom:0.75pt solid #000;';
  const cell = (t, { b = false, l = false } = {}) => `<td style="padding:3pt 8pt;text-align:${l ? 'left' : 'right'};${b ? 'font-weight:bold;' : ''}">${t}</td>`;
  const simpleTable = (title, head, body, note) => {
    let h = `<p style="font-style:italic;margin:2pt 0">${title}</p><table style="${TBL}"><tr>${head.map((x, i) => `<th style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};${top}${hbot}">${x}</th>`).join('')}</tr>`;
    body.forEach((r, ri) => { h += `<tr>${r.map((c, i) => `<td style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};${ri === body.length - 1 ? bot : ''}">${c}</td>`).join('')}</tr>`; });
    return h + `</table><p style="font-size:9pt;margin:2pt 0 10pt"><i>Note.</i> ${note}</p>`;
  };

  // invariance table (multi-group)
  let inv = '';
  if (multi.length) { const ir = invRows(multi); inv = simpleTable('Table. Tests of measurement invariance', ir.head, ir.body, `N = ${multi[0]?.parsed.nObs ?? '—'} across ${multi[0]?.parsed.nGroups ?? 2} groups. Invariance supported when ΔCFI ≥ −.010 and ΔRMSEA ≤ .015 (Chen, 2007).`); }

  // fit table (single-group)
  let fit = '';
  if (single.length) { const fr = fitRows(single); fit = simpleTable('Table. Goodness-of-fit statistics', fr.head, fr.body, `N = ${single[0]?.parsed.nObs ?? '—'}. Δχ²(s) = Satorra–Bentler scaled difference (MLR). * p &lt; .05.`); }

  // loadings tables (single-group only)
  let loads = '';
  for (const m of single) {
    const p = m.parsed, lr = loadingRows(p, null);
    const head = ['Item', ...p.factorOrder.map((fid) => lbl(p, fid)), 'δ'];
    loads += `<p style="font-style:italic;margin:10pt 0 2pt">Table. Standardized factor loadings — ${m.label}</p><table style="${TBL}"><tr>${head.map((h, i) => `<th style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};${top}${hbot}">${h}</th>`).join('')}</tr>`;
    lr.body.forEach((row) => { loads += `<tr>${row.cells.map((c, i) => cell(c, { b: row.bold[i], l: i === 0 })).join('')}</tr>`; });
    loads += `<tr>${lr.omega.map((c, i) => `<td style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};border-top:0.75pt solid #000">${c}</td>`).join('')}</tr>`;
    lr.corr.forEach((row) => { loads += `<tr>${row.map((c, i) => cell(i === 0 ? lbl(p, c) : c, { l: i === 0 })).join('')}</tr>`; });
    loads += `</table><p style="font-size:9pt;margin:2pt 0 6pt"><i>Note.</i> Target loadings in <b>bold</b>; δ = uniqueness; ω = composite reliability.</p>`;
  }

  const proseParts = [...proseText(single), ...invProseText(multi)];
  const prose = proseParts.map((t) => `<p style="font-family:Calibri;font-size:11pt;line-height:1.5;margin:6pt 0">${t}</p>`).join('');
  return `<html><head><meta charset="utf-8"></head><body>${inv}${fit}${loads}<h3 style="font-family:Calibri">Suggested text</h3>${prose}</body></html>`;
}

export async function copyResultsToWord(models, opts) {
  const html = buildWordHtml(models, opts);
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })]);
    toast('Copied — paste into Word', 'ok');
  } catch {
    await navigator.clipboard.writeText(plain);
    toast('Copied as text (rich copy unavailable)', 'ok');
  }
}

// ----------------------------------------------------------------------------
// Prose (plain strings, shared by Word + .docx)
// ----------------------------------------------------------------------------
function verdict(f) {
  if (f.cfi == null || f.rmsea == null) return 'an estimable';
  if (f.cfi >= 0.95 && f.tli >= 0.95 && f.rmsea <= 0.06) return 'excellent';
  if (f.cfi >= 0.90 && f.rmsea <= 0.08) return 'acceptable';
  return 'poor';
}
function proseText(models) {
  const out = [];
  for (const m of models) {
    const f = m.parsed.fit;
    const targets = m.parsed.items.map((it) => Math.abs(m.parsed.loadings[m.parsed.primaryFactor[it]]?.[it]?.est)).filter((v) => v != null && !Number.isNaN(v));
    const omegas = Object.values(m.parsed.omega).filter((x) => x != null);
    let s = `The ${m.label} model provided ${verdict(f)} fit to the data, χ²(${f.df}) = ${f2(f.chi2)}, p ${apaP(f.p)}, CFI = ${f3(f.cfi)}, TLI = ${f3(f.tli)}, RMSEA = ${f3(f.rmsea)} [90% CI ${f3(f.rmseaLo)}, ${f3(f.rmseaHi)}], SRMR = ${f3(f.srmr)}.`;
    if (targets.length) s += ` Target standardized loadings ranged from |λ| = ${f3(Math.min(...targets))} to ${f3(Math.max(...targets))}${omegas.length ? `, with composite reliabilities of ω = ${f3(Math.min(...omegas))} to ${f3(Math.max(...omegas))}` : ''}.`;
    out.push(s);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Real .docx via the `docx` UMD global
// ----------------------------------------------------------------------------
export async function exportDocx(models, opts = {}) {
  const blob = await buildDocxBlob(models, opts);
  if (blob) { downloadBlob(blob, opts.fileName || 'esem-results.docx'); toast('Downloaded .docx', 'ok'); }
}

export async function buildDocxBlob(models, { factorLabels = {} } = {}) {
  const D = window.docx;
  if (!D) { toast('Word export library not loaded', 'err'); return null; }
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = D;
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const LINE = (sz) => ({ style: BorderStyle.SINGLE, size: sz, color: '000000' });

  const tc = (text, { bold = false, align = 'right', topB = false, botB = false } = {}) => new TableCell({
    borders: { top: topB ? LINE(12) : NONE, bottom: botB ? LINE(12) : NONE, left: NONE, right: NONE },
    margins: { top: 30, bottom: 30, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align === 'left' ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: String(text), bold, font: 'Calibri', size: 20 })] })],
  });
  const headCell = (text, align) => new TableCell({
    borders: { top: LINE(12), bottom: LINE(6), left: NONE, right: NONE },
    margins: { top: 30, bottom: 30, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align === 'left' ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: String(text), bold: true, font: 'Calibri', size: 20 })] })],
  });
  const tbl = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }, rows });
  const italic = (t) => new Paragraph({ spacing: { before: 160, after: 40 }, children: [new TextRun({ text: t, italics: true, font: 'Calibri', size: 22 })] });
  const note = (t) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: t, font: 'Calibri', size: 16 })] });
  const para = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, font: 'Calibri', size: 22 })] });

  const { multi, single } = splitGroups(models);
  const mkTable = (rows) => {
    const header = new TableRow({ children: rows.head.map((h, i) => headCell(h, i ? 'right' : 'left')) });
    const body = rows.body.map((r, ri) => new TableRow({ children: r.map((c, i) => tc(c, { align: i ? 'right' : 'left', botB: ri === rows.body.length - 1 })) }));
    return tbl([header, ...body]);
  };

  const blocks = [new Paragraph({ children: [new TextRun({ text: 'ESEM results', bold: true, font: 'Calibri', size: 28 })], spacing: { after: 120 } })];

  // invariance table (multi-group)
  if (multi.length) blocks.push(italic('Table. Tests of measurement invariance'), mkTable(invRows(multi)), note(`Note. N = ${multi[0]?.parsed.nObs ?? '—'} across ${multi[0]?.parsed.nGroups ?? 2} groups. Invariance supported when ΔCFI ≥ −.010 and ΔRMSEA ≤ .015 (Chen, 2007).`));

  // fit table (single-group)
  if (single.length) blocks.push(italic('Table. Goodness-of-fit statistics'), mkTable(fitRows(single)), note(`Note. N = ${single[0]?.parsed.nObs ?? '—'}. Δχ²(s) = Satorra–Bentler scaled difference (MLR). * p < .05.`));

  // loadings tables (single-group)
  for (const m of single) {
    const p = m.parsed, lr = loadingRows(p, null);
    const head = ['Item', ...p.factorOrder.map((fid) => factorLabels[fid] || fid), 'δ'];
    const hRow = new TableRow({ children: head.map((h, i) => headCell(h, i ? 'right' : 'left')) });
    const rows = lr.body.map((row) => new TableRow({ children: row.cells.map((c, i) => tc(c, { bold: row.bold[i], align: i ? 'right' : 'left' })) }));
    const omegaRow = new TableRow({ children: lr.omega.map((c, i) => tc(c, { align: i ? 'right' : 'left', topB: i === 0 || true })) });
    const corrRows = lr.corr.map((row) => new TableRow({ children: row.map((c, i) => tc(c, { align: i ? 'right' : 'left' })) }));
    // bottom rule on last corr row (or omega row if no corr)
    blocks.push(italic(`Table. Standardized factor loadings — ${m.label}`), tbl([hRow, ...rows, omegaRow, ...corrRows]), note('Note. Target loadings in bold; δ = uniqueness; ω = composite reliability.'));
  }

  blocks.push(new Paragraph({ children: [new TextRun({ text: 'Suggested text', bold: true, font: 'Calibri', size: 24 })], spacing: { before: 200, after: 80 } }));
  for (const t of [...proseText(single), ...invProseText(multi)]) blocks.push(para(t));

  const doc = new Document({ sections: [{ children: blocks }] });
  return Packer.toBlob(doc);
}

// ----------------------------------------------------------------------------
// Zip generated .inp files
// ----------------------------------------------------------------------------
export async function buildZipBlob(files) {
  const J = window.JSZip;
  if (!J) { toast('Zip library not loaded', 'err'); return null; }
  const zip = new J();
  for (const f of files) zip.file(f.name, f.text);
  return zip.generateAsync({ type: 'blob' });
}

export async function zipInputs(files, fileName = 'esem-syntax.zip') {
  const blob = await buildZipBlob(files);
  if (blob) { downloadBlob(blob, fileName); toast('Downloaded syntax .zip', 'ok'); }
}
