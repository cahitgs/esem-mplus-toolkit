// main.js — bootstrap: owns appState, wires the 4-step flow (Data → Model → Syntax → Results).
import { $, $$, el, toast, downloadText, downloadSvgAsPng } from './ui.js';
import { pathDiagramSVG } from './diagram.js';
import { parseDataFile, buildDat } from './data-parse.js';
import { createModelSpec } from './state.js';
import { mountModelBuilder } from './model-builder.js';
import { buildInp, requestedModels } from './syntax-generator.js';
import { parseOut } from './out-parser.js';
import { parseSvalues, suggestReferents, buildEwcInp, fixedCrossCount } from './ewc.js';
import { renderFitTable, renderLoadingsTable, renderProse, renderInvarianceTable, renderInvarianceProse } from './apa-render.js';
import { copyResultsToWord, exportDocx, zipInputs, buildDocxBlob, buildZipBlob } from './docx-export.js';

const STEPS = ['data', 'model', 'syntax', 'results'];
const appState = { step: 'data', reached: { data: true }, data: null, spec: null, parsed: [] };
window.appState = appState;

// ============================ Stepper ============================
function goStep(step) {
  if (!STEPS.includes(step) || !appState.reached[step]) return;
  appState.step = step;
  for (const s of STEPS) { const p = $(`#step-${s}`); if (p) p.hidden = s !== step; }
  $$('#stepper .step').forEach((btn) => {
    const s = btn.dataset.step;
    btn.toggleAttribute('disabled', !appState.reached[s]);
    btn.toggleAttribute('aria-current', s === step ? 'step' : false);
    if (s === step) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
    btn.classList.toggle('is-done', !!appState.reached[s] && STEPS.indexOf(s) < STEPS.indexOf(step));
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function unlock(step) { appState.reached[step] = true; goStep(step); }

// ============================ Step 1 · Data ============================
function wireDropzone() {
  const dz = $('#data-dropzone'), input = $('#data-file-input');
  if (!dz || !input) return;
  const open = () => input.click();
  $('#data-browse-btn')?.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  dz.addEventListener('click', open);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handleDataFile(f); });
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) handleDataFile(f); });
}

async function handleDataFile(file) {
  try {
    const text = await file.text();
    const data = parseDataFile(text, file.name);
    appState.data = data;
    renderDataReview(data);
    toast(`Loaded ${file.name} — ${data.nRows} rows × ${data.nCols} columns`, 'ok');
  } catch (err) {
    toast('Could not read that file: ' + err.message, 'err');
  }
}

function renderDataReview(data) {
  $('#data-intake').hidden = true;
  const host = $('#data-review'); host.hidden = false; host.innerHTML = '';

  const summary = el('div', { class: 'surface p-6 mb-6 flex flex-wrap items-center gap-x-8 gap-y-3' }, [
    metric(data.nRows, 'observations'), metric(data.nCols, 'columns'),
    metric(data.delimiter === 'comma' ? 'CSV' : 'free', 'format'),
    metric(data.hasHeader ? 'yes' : 'no', 'header row'),
    el('div', { class: 'ml-auto flex gap-2' }, [
      el('button', { class: 'btn btn-ghost', onclick: resetData }, '← Different file'),
      el('button', { class: 'btn btn-primary', onclick: continueToModel }, 'Continue to model →'),
    ]),
  ]);
  host.append(summary);

  const grid = el('div', { class: 'grid lg:grid-cols-[1fr_1.1fr] gap-6' });

  // variable editor
  const varCard = el('div', { class: 'surface p-6' });
  varCard.append(el('div', { class: 'flex items-center justify-between mb-1' }, [
    el('h3', { class: 'text-[1.05rem]' }, 'Variables'),
    el('span', { class: 'text-[0.78rem]', style: { color: 'var(--ink-faint)' } }, data.hasHeader ? 'named from header' : 'name your columns'),
  ]));
  varCard.append(el('p', { class: 'text-[0.8rem] mb-4', style: { color: 'var(--ink-faint)' } }, 'These names map to your data columns in order, and appear in the generated NAMES list.'));
  const list = el('div', { class: 'flex flex-col gap-1.5', style: { maxHeight: '340px', overflow: 'auto' } });
  data.varNames.forEach((name, i) => {
    list.append(el('div', { class: 'flex items-center gap-2.5' }, [
      el('span', { class: 'font-mono text-[0.72rem] w-7 text-right', style: { color: 'var(--ink-faint)' } }, String(i + 1)),
      el('input', {
        value: name, class: 'flex-1 px-2.5 py-1.5 rounded font-mono text-[0.84rem]',
        style: { border: '1px solid var(--line-strong)', background: 'var(--surface)' },
        oninput: (e) => { data.varNames[i] = e.target.value.trim() || `V${i + 1}`; },
      }),
      el('label', { class: 'flex items-center gap-1.5 text-[0.74rem] cursor-pointer', style: { color: 'var(--ink-soft)' }, title: 'treat as categorical (→ WLSMV)' }, [
        el('input', { type: 'checkbox', style: { accentColor: 'var(--ochre)' }, onchange: (e) => toggleCategorical(data, name, i, e.target.checked) }),
        'cat',
      ]),
    ]));
  });
  varCard.append(list);
  varCard.append(el('div', { class: 'flex items-center gap-2 mt-4 text-[0.82rem]' }, [
    el('label', { for: 'miss', style: { color: 'var(--ink-soft)' } }, 'Missing value code'),
    el('input', { id: 'miss', placeholder: 'e.g. 999 or .', class: 'w-28 px-2 py-1 rounded font-mono', style: { border: '1px solid var(--line-strong)', background: 'var(--surface)' }, oninput: (e) => { data.missingCode = e.target.value.trim() || null; } }),
  ]));
  grid.append(varCard);

  // preview
  const prevCard = el('div', { class: 'surface p-6' });
  prevCard.append(el('h3', { class: 'text-[1.05rem] mb-3' }, 'Preview'));
  const tbl = el('table', { class: 'tnum', style: { fontSize: '0.78rem', fontFamily: 'var(--font-mono)', borderCollapse: 'collapse', width: '100%' } });
  const thead = el('tr', {});
  data.varNames.forEach((n) => thead.append(el('th', { style: { padding: '4px 6px', textAlign: 'right', color: 'var(--petrol)', borderBottom: '1px solid var(--line)' } }, n)));
  tbl.append(thead);
  data.preview.forEach((row) => {
    const tr = el('tr', {});
    row.forEach((c) => tr.append(el('td', { style: { padding: '3px 6px', textAlign: 'right', color: 'var(--ink-soft)' } }, c)));
    tbl.append(tr);
  });
  prevCard.append(el('div', { style: { overflow: 'auto' } }, tbl));
  grid.append(prevCard);

  host.append(grid);
}

function toggleCategorical(data, name, i, on) {
  const v = data.varNames[i];
  data.categorical = data.categorical.filter((x) => x !== v);
  if (on) data.categorical.push(v);
}
function metric(value, label) {
  return el('div', {}, [
    el('div', { class: 'font-display text-[1.5rem] tnum', style: { color: 'var(--petrol)', lineHeight: '1' } }, String(value)),
    el('div', { class: 'text-[0.74rem]', style: { color: 'var(--ink-faint)' } }, label),
  ]);
}
function resetData() {
  $('#data-review').hidden = true; $('#data-intake').hidden = false;
  appState.data = null; $('#data-file-input').value = '';
}
function continueToModel() {
  // de-dup categorical names and finalize estimator default
  appState.data.categorical = [...new Set(appState.data.categorical)];
  appState.spec = createModelSpec(appState.data);
  if (appState.data.categorical.length) appState.spec.estimator = 'WLSMV';
  unlock('model');
  mountModelBuilder($('#model-host'), appState.spec, { onChange: onModelChange });
}

// ============================ Step 2 · Model ============================
function onModelChange(ev) {
  if (ev?.continue) { unlock('syntax'); renderSyntaxStep(); }
}

// ============================ Step 3 · Syntax ============================
function renderSyntaxStep() {
  const host = $('#syntax-host'); host.innerHTML = '';
  const spec = appState.spec;
  const models = requestedModels(spec);

  host.append(el('div', { class: 'mb-6' }, [
    el('p', { class: 'eyebrow mb-2' }, 'Step 3 · generated Mplus input'),
    el('h2', { class: 'text-2xl mb-2' }, 'Download, run in Mplus, return with the output'),
    el('p', { class: 'lede', style: { maxWidth: '60ch' } }, 'Save each .inp next to your data file and run it in Mplus. Then come back and drop the resulting .out files into Results.'),
  ]));

  const card = el('div', { class: 'surface p-6' });
  const tabsRow = el('div', { class: 'flex flex-wrap items-center gap-2 mb-4' });
  const pre = el('pre', { class: 'code-pane', style: { maxHeight: '460px' } });
  let active = models[0]?.key;
  const draw = () => {
    pre.innerHTML = escapeHtml(buildInp(spec, active));
    $$('button', tabsRow).forEach((b) => { const on = b.dataset.k === active; Object.assign(b.style, on ? { background: 'var(--petrol)', color: '#EAF3F1' } : { background: 'var(--surface-2)', color: 'var(--ink-soft)' }); });
  };
  for (const m of models) {
    tabsRow.append(el('button', { class: 'px-3 py-1.5 rounded text-[0.82rem] font-semibold', 'data-k': m.key, onclick: () => { active = m.key; draw(); } }, m.label));
  }
  const data = spec.data;
  const datName = data.mplusFile || 'data.dat';
  const hasData = !!(data._matrix && data._matrix.length);
  const spacer = el('span', { class: 'flex-1' });
  const copyBtn = el('button', { class: 'btn btn-ghost', onclick: async () => { await navigator.clipboard.writeText(buildInp(spec, active)); toast('Syntax copied', 'ok'); } }, 'Copy');
  const dlBtn = el('button', { class: 'btn btn-ghost', onclick: () => { const m = models.find((x) => x.key === active); downloadText(buildInp(spec, active), m.file, 'text/plain'); } }, 'Download .inp');
  const datBtn = hasData ? el('button', { class: 'btn btn-ghost', onclick: () => { downloadText(buildDat(data), datName, 'text/plain'); toast(`Saved ${datName}`, 'ok'); } }, 'Download data (.dat)') : null;
  const dlAll = el('button', { class: 'btn btn-accent', onclick: () => {
    const files = models.map((m) => ({ name: m.file, text: buildInp(spec, m.key) }));
    if (hasData) files.push({ name: datName, text: buildDat(data) });
    zipInputs(files);
  } }, 'Download all (.zip)');
  tabsRow.append(spacer, copyBtn, dlBtn, datBtn, dlAll);
  card.append(tabsRow, pre);
  host.append(card);

  // Mplus can't read a semicolon CSV or a file with a header row — tell the user to use the .dat.
  if (hasData) {
    const why = data.needsMplusDat
      ? `Your data file ${data.hasHeader ? 'has a header row' : ''}${data.hasHeader && data.delimiter === 'semicolon' ? ' and ' : ''}${data.delimiter === 'semicolon' ? 'uses “;” separators' : ''} — Mplus can't read it directly.`
      : 'A clean, Mplus-formatted copy of your data.';
    const note = el('div', { class: 'mt-4 px-4 py-3 rounded-xl text-[0.84rem]', style: { background: data.needsMplusDat ? 'var(--ochre-tint)' : 'var(--petrol-tint)', color: data.needsMplusDat ? '#8a4f1a' : 'var(--petrol-deep)' } }, [
      el('b', {}, data.needsMplusDat ? '⚠ Use the exported data file. ' : 'ℹ Data file. '),
      `${why} The .inp reads `, el('code', { style: { fontFamily: 'var(--font-mono)' } }, `FILE = "${datName}"`),
      `. Use the “Download data (.dat)” button (or “Download all”) and keep `, el('code', { style: { fontFamily: 'var(--font-mono)' } }, datName),
      ' in the same folder as the .inp.',
      data.matrixTruncated ? el('span', { style: { display: 'block', marginTop: '4px', fontWeight: '600' } }, `Note: only the first ${data._matrix.length.toLocaleString()} rows were exported.`) : null,
    ]);
    host.append(note);
  }

  host.append(el('div', { class: 'flex justify-end mt-6' }, [
    el('button', { class: 'btn btn-primary', onclick: () => { unlock('results'); renderResultsStep(); } }, 'I have my .out files →'),
  ]));
  draw();
}

// ============================ Step 4 · Results ============================
function renderResultsStep() {
  const host = $('#results-host'); host.innerHTML = '';
  host.append(el('div', { class: 'mb-6' }, [
    el('p', { class: 'eyebrow mb-2' }, 'Step 4 · APA results'),
    el('h2', { class: 'text-2xl mb-2' }, 'Drop your Mplus output'),
    el('p', { class: 'lede', style: { maxWidth: '60ch' } }, 'Add one or more .out files. Each is parsed in your browser into a fit row and a standardized loadings table, with auto-written APA text.'),
  ]));

  const dz = el('div', { class: 'dropzone mb-6', tabindex: '0', role: 'button' }, [
    el('p', { class: 'font-display font-semibold', style: { color: 'var(--ink)' } }, 'Drop .out files here'),
    el('p', { class: 'text-[0.84rem]', style: { color: 'var(--ink-faint)' } }, 'Mplus output — multiple files welcome'),
  ]);
  const input = el('input', { type: 'file', accept: '.out,.txt', multiple: true, hidden: true, onchange: (e) => addOutFiles(e.target.files) });
  dz.append(input);
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
  dz.addEventListener('drop', (e) => { e.preventDefault(); addOutFiles(e.dataTransfer?.files); });
  host.append(dz);
  host.append(el('div', { id: 'results-output' }));
  renderResultsOutput();
}

async function addOutFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    try {
      const text = await f.text();
      const p = parseOut(text);
      const label = deriveLabel(p, f.name);
      appState.parsed.push({ label, parsed: p, fileName: f.name, raw: text });
      if (!p.converged) toast(`${f.name}: model may not have converged`, 'err');
    } catch (err) { toast(`${f.name}: ${err.message}`, 'err'); }
  }
  renderResultsOutput();
}

function deriveLabel(p, fileName) {
  if (p.invStep) return p.invStep; // longitudinal step name parsed from the TITLE
  const t = p.title || '';
  const inv = t.match(/invariance\s*[-:]\s*(.+)/i);
  if (inv) return inv[1].trim();
  if (/configural/i.test(t)) return 'Configural';
  if (/bifactor/i.test(t)) return /esem/i.test(t) ? 'Bifactor-ESEM' : 'Bifactor-CFA';
  if (/target/i.test(t)) return 'ESEM (Target)';
  if (/geomin|esem/i.test(t)) return 'ESEM (Geomin)';
  if (/cfa/i.test(t)) return 'CFA';
  if (t) return t.length <= 28 ? t : t.slice(0, 26) + '…';
  return fileName.replace(/\.out$/i, '');
}

function renderResultsOutput() {
  const out = $('#results-output'); if (!out) return;
  out.innerHTML = '';
  if (!appState.parsed.length) {
    out.append(el('div', { class: 'surface p-8 text-center', style: { color: 'var(--ink-faint)' } }, 'No output yet — drop a .out file above to see APA tables.'));
    return;
  }
  const factorLabelsFor = (p) => {
    const spec = appState.spec;
    if (spec && spec.factors.length === p.factorOrder.length) {
      const map = {}; p.factorOrder.forEach((fid, idx) => { map[fid] = spec.factors[idx].label; });
      return map;
    }
    return {};
  };
  const exportLabels = appState.parsed[0] ? factorLabelsFor(appState.parsed[0].parsed) : {};

  // chips for loaded models (removable) + export bar
  const bar = el('div', { class: 'flex flex-wrap items-center gap-2 mb-6' });
  appState.parsed.forEach((m, i) => {
    bar.append(el('span', { class: 'chip', style: { cursor: 'default' } }, [
      `${m.label}`,
      el('button', { 'aria-label': 'remove', style: { marginLeft: '4px', color: 'inherit', cursor: 'pointer' }, onclick: () => { appState.parsed.splice(i, 1); renderResultsOutput(); } }, '×'),
    ]));
  });
  bar.append(el('span', { class: 'flex-1' }));
  bar.append(el('button', { class: 'btn btn-ghost', onclick: () => copyResultsToWord(appState.parsed, { factorLabels: exportLabels }) }, 'Copy for Word'));
  bar.append(el('button', { class: 'btn btn-accent', onclick: () => exportDocx(appState.parsed, { factorLabels: exportLabels }) }, 'Download .docx'));
  out.append(bar);

  // Route parsed outputs three ways: longitudinal invariance sequences (single-group, recognized by
  // TITLE), multi-group invariance (nGroups > 1), and plain single-group models.
  const byDf = (a, b) => (a.parsed.fit.df ?? 0) - (b.parsed.fit.df ?? 0);
  const longi = appState.parsed.filter((m) => m.parsed.invKind === 'longitudinal');
  const multi = appState.parsed.filter((m) => m.parsed.invKind !== 'longitudinal' && (m.parsed.nGroups || 1) > 1).sort(byDf);
  const single = appState.parsed.filter((m) => m.parsed.invKind !== 'longitudinal' && (m.parsed.nGroups || 1) <= 1);

  // Longitudinal: one comparison table per measurement model (ESEM vs CFA), least→most constrained.
  const renderLongiBlock = (models, modelLabel) => {
    if (!models.length) return;
    const set = models.slice().sort(byDf);
    const cap = `Tests of longitudinal measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`;
    const card = el('div', { class: 'surface p-6 mb-6 apa' });
    card.innerHTML = renderInvarianceTable(set, { caption: cap, longitudinal: true });
    out.append(card);
    const prose = renderInvarianceProse(set, { longitudinal: true });
    if (prose) {
      const c = el('div', { class: 'surface p-6 mb-6 apa' });
      c.innerHTML = `<div class="eyebrow mb-3" style="font-family:var(--font-mono)">Suggested APA text — longitudinal invariance${modelLabel ? ` (${modelLabel})` : ''}</div>` + prose;
      out.append(c);
    }
  };
  if (longi.length) {
    const esem = longi.filter((m) => !['cfa', 'besem'].includes(m.parsed.invModel));
    const cfa = longi.filter((m) => m.parsed.invModel === 'cfa');
    const besem = longi.filter((m) => m.parsed.invModel === 'besem');
    // Only tag the model when several kinds are present; a single sequence needs no qualifier.
    const kinds = [esem, cfa, besem].filter((s) => s.length).length;
    renderLongiBlock(esem, kinds > 1 ? 'ESEM' : '');
    renderLongiBlock(cfa, kinds > 1 ? 'CFA' : '');
    renderLongiBlock(besem, kinds > 1 ? 'Bifactor-ESEM' : '');
  }

  if (multi.length) {
    const invCard = el('div', { class: 'surface p-6 mb-6 apa' });
    invCard.innerHTML = renderInvarianceTable(multi);
    out.append(invCard);
    const invProse = renderInvarianceProse(multi);
    if (invProse) {
      const c = el('div', { class: 'surface p-6 mb-6 apa' });
      c.innerHTML = `<div class="eyebrow mb-3" style="font-family:var(--font-mono)">Suggested APA text — invariance</div>` + invProse;
      out.append(c);
    }
  }

  if (single.length) {
    const fitCard = el('div', { class: 'surface p-6 mb-6 apa' });
    fitCard.innerHTML = renderFitTable(single, { deltaMode: single.length > 1 ? 'consecutive' : 'none' });
    out.append(fitCard);
    for (const m of single) {
      const card = el('div', { class: 'surface p-6 mb-6 apa' });
      card.innerHTML = `<div class="eyebrow mb-3" style="font-family:var(--font-mono)">${escapeHtml(m.label)}</div>` + renderLoadingsTable(m.parsed, { factorLabels: factorLabelsFor(m.parsed) });
      out.append(card);
      out.append(renderDiagramCard(m, factorLabelsFor(m.parsed)));
      const ewc = renderEwcCard(m);
      if (ewc) out.append(ewc);
    }
    const proseCard = el('div', { class: 'surface p-6 mb-6 apa' });
    proseCard.innerHTML = `<div class="eyebrow mb-3" style="font-family:var(--font-mono)">Suggested APA text</div>` + renderProse(single);
    out.append(proseCard);
  }
}

// ESEM-within-CFA: when a dropped ESEM/bifactor-ESEM .out carries a SVALUES block, offer to
// convert its rotated solution into a runnable CFA-syntax model (Morin's referent method).
function renderEwcCard(m) {
  if (!m.raw) return null;
  const model = parseSvalues(m.raw);
  if (!model.found || model.factors.length < 2) return null;

  const card = el('div', { class: 'surface p-6 mb-6' });
  const refs = { ...suggestReferents(model) };
  const fLabel = (f) => (/^(g|fg)$/i.test(f) ? `${f} (general)` : f);

  card.append(el('div', { class: 'eyebrow mb-2', style: { fontFamily: 'var(--font-mono)' } }, 'ESEM-within-CFA'));
  card.append(el('p', { class: 'text-[0.9rem] mb-4', style: { color: 'var(--ink-soft)', maxWidth: '70ch' } },
    model.isBifactor
      ? 'This bifactor-ESEM carries a SVALUES block. Freeze it into a CFA you can extend (predictive paths, MIMIC/DIF). One referent per factor is picked; its cross-loadings are fixed to the ESEM values and all factor correlations to 0.'
      : 'This ESEM carries a SVALUES block. Freeze the rotated solution into an equivalent CFA (same fit) that you can embed in larger SEM/MIMIC/DIF models. One referent indicator per factor is picked; its cross-loadings are fixed to the ESEM values.'));

  // Referent pickers — one <select> per factor.
  const pickRow = el('div', { class: 'flex flex-wrap gap-3 mb-4' });
  const pre = el('pre', {
    class: 'overflow-auto', style: {
      fontFamily: 'var(--font-mono)', fontSize: '0.78rem', lineHeight: '1.5', background: 'var(--ink)',
      color: 'var(--paper)', padding: '16px 18px', borderRadius: '12px', maxHeight: '420px', margin: '0',
    },
  });
  const note = el('p', { class: 'text-[0.82rem] mt-3', style: { color: 'var(--ink-faint)' } });
  const fileBase = (m.fileName || 'model').replace(/\.out$/i, '');

  const refresh = () => {
    const inp = buildEwcInp(model, { referents: refs, title: model.isBifactor ? 'Bifactor-ESEM-within-CFA' : 'ESEM-within-CFA' });
    pre.textContent = inp;
    const fixed = fixedCrossCount(model, refs), need = model.factors.length * (model.factors.length - 1);
    const identified = fixed === need;
    note.style.color = identified ? 'var(--ink-faint)' : 'var(--ochre)';
    note.textContent = identified
      ? `${fixed} cross-loadings fixed to identify the rotation (m(m−1) = ${need}). Factor variances fixed to 1${model.isBifactor ? '; factor correlations fixed to 0' : ''}. Run this in Mplus, then drop its .out back here for APA tables.`
      : `⚠ Only ${fixed} of the ${need} cross-loadings are fixed — give each factor a distinct referent, or the model is under-identified.`;
    card._ewcInp = inp;
  };

  // Each factor needs its OWN referent: an item used as referent for one factor is disabled in
  // the other dropdowns, so the user can never pick duplicates (which would drop the model below
  // m(m−1) fixed cross-loadings and leave it under-identified). Rebuilt on every change.
  const buildPickers = () => {
    pickRow.innerHTML = '';
    for (const f of model.factors) {
      const usedByOthers = new Set(model.factors.filter((o) => o !== f).map((o) => refs[o]));
      const sel = el('select', {
        class: 'px-2.5 py-1.5 rounded text-[0.84rem]', style: { border: '1px solid var(--line-strong)', background: 'var(--surface)' },
        'aria-label': `Referent for ${f}`,
        onchange: (e) => { refs[f] = e.target.value; buildPickers(); refresh(); },
      }, model.items.map((it) => el('option', { value: it, selected: refs[f] === it, disabled: usedByOthers.has(it) }, it)));
      pickRow.append(el('label', { class: 'flex items-center gap-2 text-[0.84rem]', style: { color: 'var(--ink-soft)' } },
        [el('span', { style: { fontFamily: 'var(--font-mono)' } }, `${fLabel(f)} referent:`), sel]));
    }
  };
  buildPickers();
  card.append(pickRow);
  card.append(pre);
  card.append(note);

  const actions = el('div', { class: 'flex flex-wrap gap-2 mt-4' });
  actions.append(el('button', {
    class: 'btn btn-ghost', onclick: async () => {
      try { await navigator.clipboard.writeText(card._ewcInp); toast('ESEM-within-CFA syntax copied', 'ok'); }
      catch { toast('Copy failed — select the text manually', 'err'); }
    },
  }, 'Copy syntax'));
  actions.append(el('button', {
    class: 'btn btn-accent', onclick: () => downloadText(card._ewcInp, `EWC_${fileBase}.inp`),
  }, 'Download .inp'));
  card.append(actions);

  refresh();
  return card;
}

function renderDiagramCard(m, factorLabels) {
  const card = el('div', { class: 'surface p-6 mb-6' });
  const state = { showCross: true, showResiduals: true, theoretical: false, hidden: new Set(), crossThreshold: 0.10, positions: {} };
  const holder = el('div', { class: 'overflow-auto', style: { padding: '4px', textAlign: 'center' } });
  const optsNow = () => ({ factorLabels, showCross: state.showCross, showResiduals: state.showResiduals, theoretical: state.theoretical, hiddenFactors: [...state.hidden], crossThreshold: state.crossThreshold, positions: state.positions });
  const draw = () => { holder.innerHTML = pathDiagramSVG(m.parsed, optsNow()); };
  const svgNow = () => pathDiagramSVG(m.parsed, optsNow());

  // ── free-drag the factor ellipses (cosmetic only — never changes the model or syntax) ──
  // Listeners live on the persistent holder (the SVG is rebuilt each frame), so pointer capture
  // survives re-renders. Dragged positions go into state.positions and feed back through optsNow.
  let dragF = null, grabDX = 0, grabDY = 0, rafPending = false;
  const scheduleDraw = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); };
  const toSvg = (e) => { const svg = holder.querySelector('svg'); if (!svg) return null; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : null; };
  holder.addEventListener('pointerdown', (e) => {
    const grp = e.target.closest && e.target.closest('[data-factor]'); if (!grp) return;
    const f = grp.getAttribute('data-factor'), p = toSvg(e); if (!p) return;
    const cx = state.positions[f]?.x ?? parseFloat(grp.getAttribute('data-cx'));
    const cy = state.positions[f]?.y ?? parseFloat(grp.getAttribute('data-cy'));
    dragF = f; grabDX = p.x - cx; grabDY = p.y - cy; state.positions[f] = { x: cx, y: cy };
    holder.style.cursor = 'grabbing';
    try { holder.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  holder.addEventListener('pointermove', (e) => {
    if (!dragF) return; const p = toSvg(e); if (!p) return;
    state.positions[dragF] = { x: p.x - grabDX, y: p.y - grabDY }; scheduleDraw();
  });
  const endDrag = (e) => { if (!dragF) return; dragF = null; holder.style.cursor = ''; try { holder.releasePointerCapture(e.pointerId); } catch {} };
  holder.addEventListener('pointerup', endDrag);
  holder.addEventListener('pointercancel', endDrag);

  const toggle = (label, key) => el('label', { class: 'flex items-center gap-1.5 text-[0.8rem] cursor-pointer', style: { color: 'var(--ink-soft)' } }, [
    el('input', { type: 'checkbox', checked: state[key], style: { accentColor: 'var(--petrol)' }, onchange: (e) => { state[key] = e.target.checked; draw(); } }), label,
  ]);
  const head = el('div', { class: 'flex flex-wrap items-center gap-3 mb-3' }, [
    el('span', { class: 'eyebrow' }, `Path diagram — ${m.label}`),
    el('span', { class: 'flex-1' }),
    toggle('theoretical (blank)', 'theoretical'),
    toggle('cross-loadings', 'showCross'),
    toggle('uniquenesses', 'showResiduals'),
    el('button', { class: 'btn btn-ghost', style: { padding: '0.4rem 0.8rem' }, onclick: () => downloadText(svgNow(), `diagram_${m.label.replace(/\W+/g, '_')}.svg`, 'image/svg+xml') }, 'SVG'),
    el('button', { class: 'btn btn-accent', style: { padding: '0.4rem 0.8rem' }, onclick: () => downloadSvgAsPng(svgNow(), `diagram_${m.label.replace(/\W+/g, '_')}.png`) }, 'PNG'),
  ]);

  // Per-factor show/hide chips + a cross-loading threshold slider, so the user can tailor the
  // figure for their report (e.g. isolate the G-factor, or hide small cross-loadings).
  const controls = el('div', { class: 'flex flex-wrap items-center gap-2 mb-4' });
  controls.append(el('span', { class: 'text-[0.74rem] font-mono mr-1', style: { color: 'var(--ink-faint)' } }, 'show:'));
  for (const f of m.parsed.factorOrder) {
    const isG = m.parsed.generalFactor === f;
    const chip = el('button', { class: 'chip', style: { cursor: 'pointer', userSelect: 'none' } }, factorLabels[f] || f);
    const sync = () => Object.assign(chip.style, state.hidden.has(f)
      ? { background: 'var(--surface)', color: 'var(--ink-faint)', borderColor: 'var(--line)', opacity: '0.6', textDecoration: 'line-through' }
      : { background: isG ? 'var(--ochre)' : 'var(--petrol)', color: '#fff', borderColor: 'transparent', opacity: '1', textDecoration: 'none' });
    chip.onclick = () => { state.hidden.has(f) ? state.hidden.delete(f) : state.hidden.add(f); sync(); draw(); };
    sync();
    controls.append(chip);
  }
  const resetBtn = el('button', { class: 'btn btn-ghost', style: { padding: '0.3rem 0.7rem', fontSize: '0.74rem' }, title: 'Faktör konumlarını otomatik yerleşime döndür', onclick: () => { state.positions = {}; draw(); } }, '↺ reset layout');
  controls.append(el('span', { class: 'text-[0.72rem]', style: { color: 'var(--ink-faint)', fontStyle: 'italic' } }, 'drag the ellipses to reposition'), resetBtn);
  const fmtTh = (x) => (x <= 0 ? '0' : '.' + String(Math.round(x * 100)).padStart(2, '0'));
  const thVal = el('span', { class: 'text-[0.74rem] font-mono', style: { color: 'var(--ink-soft)', minWidth: '2.2em', textAlign: 'right' } }, fmtTh(state.crossThreshold));
  const slider = el('input', { type: 'range', min: '0', max: '0.5', step: '0.05', value: String(state.crossThreshold), style: { accentColor: 'var(--petrol)', width: '120px' }, oninput: (e) => { state.crossThreshold = parseFloat(e.target.value); thVal.textContent = fmtTh(state.crossThreshold); draw(); } });
  controls.append(el('span', { class: 'flex-1' }), el('span', { class: 'text-[0.74rem] font-mono', style: { color: 'var(--ink-faint)' } }, 'cross-loadings ≥'), slider, thVal);

  card.append(head, controls, holder);
  draw();
  return card;
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ============================ dev bootstrap (screenshots) ============================
const SAMPLE_DATA = {
  fileName: 'ESEM.dat', mplusFile: 'ESEM.dat', needsMplusDat: false, delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 4500,
  varNames: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'GV'],
  categorical: [], missingCode: null,
  preview: [
    ['0.66', '0.45', '0.46', '0.71', '0.43', '0.57', '0.51', '0.38', '0.49', '0.66', '0.40', '0.55', '1'],
    ['-1.2', '0.88', '1.13', '2.04', '0.92', '0.34', '0.77', '1.10', '0.21', '1.42', '0.88', '0.63', '1'],
    ['1.84', '0.64', '-0.39', '0.16', '1.43', '2.04', '0.55', '0.48', '0.34', '0.71', '0.43', '0.57', '2'],
    ['0.20', '1.10', '0.46', '0.71', '0.21', '0.34', '0.88', '0.21', '1.42', '0.16', '1.43', '0.34', '2'],
    ['0.51', '0.38', '0.49', '0.66', '0.40', '0.55', '0.66', '0.45', '0.46', '0.71', '0.43', '0.57', '1'],
  ],
};
SAMPLE_DATA._matrix = SAMPLE_DATA.preview;
async function devBootstrap(which) {
  appState.data = JSON.parse(JSON.stringify(SAMPLE_DATA));
  if (which === 'data') { renderDataReview(appState.data); goStep('data'); return; }
  appState.spec = createModelSpec(appState.data);
  if (which === 'modelinv') { appState.spec.groups.enabled = true; appState.spec.groups.variable = 'GV'; appState.spec.groups.codes = [{ code: '1', label: 'group1' }, { code: '2', label: 'Group2' }]; }
  unlock('model'); mountModelBuilder($('#model-host'), appState.spec, { onChange: onModelChange });
  if (which === 'model' || which === 'modelinv') return;
  unlock('syntax'); renderSyntaxStep();
  if (which === 'syntax') { goStep('syntax'); return; }
  const fixtures = which === 'resultsbf' ? ['bifactor_esem.out', 'bifactor_cfa.out']
    : which === 'resultsewc' ? ['esem_svalues.out']
    : (which === 'resultsinv' || which === 'exportinv') ? ['inv_configural.out', 'inv_metric.out', 'inv_scalar.out', 'inv_strict.out', 'inv_varcov.out', 'inv_latentmean.out']
    : ['cfa_2f.out', 'esem_geomin.out'];
  for (const n of fixtures) {
    try { const t = await fetch('test/fixtures/' + n).then((r) => r.text()); const p = parseOut(t); appState.parsed.push({ label: deriveLabel(p, n), parsed: p, fileName: n, raw: t }); } catch {}
  }
  unlock('results'); renderResultsStep();
  if (which === 'exporttest' || which === 'exportinv') {
    try {
      await new Promise((r) => setTimeout(r, 600)); // let CDN UMD libs settle
      const post = async (name, blob) => { if (blob) await fetch('/save?name=' + name, { method: 'POST', body: blob }); };
      await post('devtest.docx', await buildDocxBlob(appState.parsed, {}));
      await post('devtest.zip', await buildZipBlob([{ name: 'CFA.inp', text: buildInp(appState.spec, 'cfa') }, { name: 'ESEM.inp', text: buildInp(appState.spec, 'esem') }]));
      document.title = 'EXPORT_DONE';
    } catch (e) { /* dev-only helper */ }
  }
}

// Public demo mode: load the bundled 3-factor example .out files straight into Results so a
// first-time visitor sees real APA tables, diagrams, and the ESEM-within-CFA card in one click.
// (Distinct from the developer-only `?dev=` fixtures.)
const DEMO_SETS = {
  results: ['1_CFA.out', '2_ESEM_geomin.out', '5_Bifactor_ESEM.out'],
  measurement: ['1_CFA.out', '2_ESEM_geomin.out', '3_ESEM_target.out', '4_Bifactor_CFA.out', '5_Bifactor_ESEM.out'],
  esem: ['2_ESEM_geomin.out'],
  target: ['3_ESEM_target.out'],
  bifactorcfa: ['4_Bifactor_CFA.out'],
  bifactor: ['5_Bifactor_ESEM.out'],
  ewc: ['2_ESEM_geomin.out'],
  invariance: ['inv_1_configural.out', 'inv_2_metric.out', 'inv_3_scalar.out', 'inv_4_strict.out', 'inv_5_varcov.out', 'inv_6_latentmean.out'],
};
async function demoBootstrap(which) {
  // Model / Syntax: rebuild the 3-factor example spec from the bundled data file so the
  // builder and the generated syntax are shown on the same 15-item / 3-factor example.
  if (which === 'model' || which === 'syntax') {
    try {
      const text = await fetch('example-dataset/data.dat').then((r) => r.text());
      const data = parseDataFile(text, 'data.dat');
      data.varNames = Array.from({ length: 15 }, (_, i) => 'i' + (i + 1)).concat('gender');
      data.mplusFile = 'data.dat';
      appState.data = data;
      const spec = createModelSpec(data);
      spec.items = data.varNames.slice(0, 15);
      spec.factors = [1, 2, 3].map((i) => ({ id: 'F' + i, label: 'F' + i }));
      spec.target = {};
      spec.items.forEach((it, i) => { spec.target[it] = {}; spec.factors.forEach((f, fi) => { spec.target[it][f.id] = fi === Math.floor(i / 5); }); });
      spec.rotation = { type: 'GEOMIN', oblique: true, epsilon: 0.5 };
      appState.spec = spec;
      unlock('model'); mountModelBuilder($('#model-host'), spec, { onChange: onModelChange });
      if (which === 'syntax') { unlock('syntax'); renderSyntaxStep(); goStep('syntax'); }
    } catch { toast('Demo: could not load data.dat', 'err'); }
    return;
  }
  // Results: load the bundled 3-factor .out files straight into Results.
  appState.reached.model = appState.reached.syntax = true;
  unlock('results'); renderResultsStep();
  const files = DEMO_SETS[which] || DEMO_SETS.results;
  for (const n of files) {
    try {
      const t = await fetch('example-dataset/' + n).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
      const p = parseOut(t);
      appState.parsed.push({ label: deriveLabel(p, n), parsed: p, fileName: n, raw: t });
    } catch { toast(`Demo: could not load ${n}`, 'err'); }
  }
  renderResultsOutput();
}

// ============================ init ============================
function init() {
  $$('#stepper .step').forEach((btn) => btn.addEventListener('click', () => goStep(btn.dataset.step)));
  wireDropzone();
  // Shortcut for users who already have .out files and don't need to build a model.
  $('#skip-to-results')?.addEventListener('click', () => { appState.reached.model = appState.reached.syntax = true; unlock('results'); renderResultsStep(); });
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo'), dev = params.get('dev');
  if (demo) demoBootstrap(demo);
  else if (dev) devBootstrap(dev);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
