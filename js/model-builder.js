// model-builder.js — Step 2 UI: factor controls, the Λ target-pattern grid, and a live
// syntax preview. Mutates the shared ModelSpec via state.js helpers and re-renders.
import { el, $, $$ } from './ui.js';
import { setFactorCount, setItems, setWaveItems, toggleTarget, factorIds, validateSpec } from './state.js';
import { buildInp, requestedModels, INV_SEQUENCE, INV_META } from './syntax-generator.js';
import { distinctValues } from './data-parse.js';
import { conceptDiagramSVG } from './diagram.js';

let SPEC = null;
let onChange = () => {};

export function mountModelBuilder(host, spec, opts = {}) {
  SPEC = spec; onChange = opts.onChange || (() => {});
  host.innerHTML = '';
  host.append(buildLayout());
  refresh();
}

function buildLayout() {
  const wrap = el('div', { class: 'grid lg:grid-cols-[360px_1fr] gap-7 items-start' });

  // ---------- left: controls ----------
  const controls = el('div', { class: 'surface p-6 flex flex-col gap-6' });

  // item selection
  controls.append(sectionTitle('1', 'Items', 'Variables that load on the factors'));
  const itemBox = el('div', { id: 'mb-items', class: 'flex flex-wrap gap-1.5' });
  controls.append(itemBox);

  // factors
  controls.append(sectionTitle('2', 'Factors', 'How many latent factors'));
  const facRow = el('div', { class: 'flex items-center gap-3' }, [
    stepperControl('mb-nfac', SPEC.factors.length, (k) => { setFactorCount(SPEC, k); refresh(); }),
    el('div', { id: 'mb-faclabels', class: 'flex-1 flex flex-wrap gap-1.5' }),
  ]);
  controls.append(facRow);

  // rotation
  controls.append(sectionTitle('3', 'Rotation & estimator', 'How the solution is rotated'));
  controls.append(rotationControls());

  // model types
  controls.append(sectionTitle('4', 'Models to generate', 'One .inp per checked model'));
  controls.append(modelTypeControls());

  // measurement invariance
  controls.append(sectionTitle('5', 'Measurement invariance', 'Across groups or time (optional)'));
  controls.append(el('div', { id: 'mb-groups' }));

  // validation messages
  controls.append(el('div', { id: 'mb-validation', class: 'flex flex-col gap-1.5' }));

  // continue
  const cont = el('button', { class: 'btn btn-primary w-full', id: 'mb-continue', onclick: () => onChange({ continue: true }) }, 'Generate syntax →');
  controls.append(cont);

  // ---------- right: grid + preview ----------
  const right = el('div', { class: 'flex flex-col gap-6' });
  const gridCard = el('div', { class: 'surface p-6' });
  gridCard.append(el('div', { class: 'flex items-center justify-between mb-4' }, [
    el('span', { class: 'eyebrow' }, 'Λ  target-pattern matrix'),
    el('span', { class: 'text-[0.74rem] font-mono', style: { color: 'var(--ink-faint)' }, id: 'mb-grid-hint' }, ''),
  ]));
  gridCard.append(el('div', { id: 'mb-grid' }));
  gridCard.append(gridLegend());
  right.append(gridCard);

  const prevCard = el('div', { class: 'surface p-6' });
  prevCard.append(el('div', { class: 'flex items-center justify-between mb-3' }, [
    el('span', { class: 'eyebrow' }, 'Live syntax preview'),
    el('div', { class: 'flex gap-1.5', id: 'mb-prev-tabs' }),
  ]));
  prevCard.append(el('pre', { class: 'code-pane', id: 'mb-preview', style: { maxHeight: '300px' } }));
  right.append(prevCard);

  // conceptual (theoretical) diagram of the active model — pure structure, no estimates yet
  const diagCard = el('div', { class: 'surface p-6' });
  diagCard.append(el('div', { class: 'flex items-center justify-between mb-3' }, [
    el('span', { class: 'eyebrow' }, 'Conceptual model'),
    el('span', { class: 'text-[0.74rem]', style: { color: 'var(--ink-faint)' } }, 'blank structure — matches the preview tab'),
  ]));
  diagCard.append(el('div', { id: 'mb-diagram', class: 'overflow-auto', style: { padding: '4px' } }));
  right.append(diagCard);

  wrap.append(controls, right);
  return wrap;
}

// ---------- pieces ----------
function sectionTitle(n, title, sub) {
  return el('div', {}, [
    el('div', { class: 'flex items-baseline gap-2' }, [
      el('span', { class: 'font-mono text-[0.72rem]', style: { color: 'var(--ochre)' } }, n),
      el('h3', { class: 'text-[1.02rem]' }, title),
    ]),
    el('p', { class: 'text-[0.8rem] mt-0.5', style: { color: 'var(--ink-faint)' } }, sub),
  ]);
}

function stepperControl(id, value, onset) {
  const out = el('div', { class: 'inline-flex items-center rounded-lg overflow-hidden', style: { border: '1px solid var(--line-strong)' } });
  const val = el('span', { id, class: 'font-mono text-[1rem] w-10 text-center tnum', style: { color: 'var(--ink)' } }, String(value));
  const mk = (txt, d) => el('button', {
    class: 'px-3 py-2 font-mono', style: { background: 'var(--surface-2)', color: 'var(--petrol)' },
    onclick: () => { const cur = parseInt(val.textContent, 10); onset(cur + d); },
    'aria-label': d > 0 ? 'more factors' : 'fewer factors',
  }, txt);
  out.append(mk('−', -1), val, mk('+', +1));
  return out;
}

function rotationControls() {
  const box = el('div', { class: 'flex flex-col gap-3' });
  // type
  box.append(segmented('mb-rot', [
    { v: 'GEOMIN', t: 'Geomin' }, { v: 'TARGET', t: 'Target' },
  ], SPEC.rotation.type, (v) => { SPEC.rotation.type = v; if (v === 'GEOMIN' && SPEC.rotation.epsilon == null) SPEC.rotation.epsilon = 0.5; refresh(); }));
  // oblique/orthogonal + epsilon
  const row = el('div', { class: 'flex items-center gap-2' });
  row.append(segmented('mb-obl', [
    { v: 'OBLIQUE', t: 'Oblique' }, { v: 'ORTHOGONAL', t: 'Orthogonal' },
  ], SPEC.rotation.oblique ? 'OBLIQUE' : 'ORTHOGONAL', (v) => { SPEC.rotation.oblique = v === 'OBLIQUE'; refresh(); }));
  box.append(row);
  box.append(el('div', { id: 'mb-eps-wrap', class: 'flex items-center gap-2 text-[0.82rem]' }, [
    el('label', { for: 'mb-eps', style: { color: 'var(--ink-soft)' } }, 'Geomin ε'),
    el('input', {
      id: 'mb-eps', type: 'number', step: '0.1', min: '0',
      value: SPEC.rotation.epsilon ?? '', placeholder: 'default',
      class: 'w-24 px-2 py-1 rounded font-mono', style: { border: '1px solid var(--line-strong)', background: 'var(--surface)' },
      oninput: (e) => { const v = e.target.value.trim(); SPEC.rotation.epsilon = v === '' ? null : parseFloat(v); updatePreview(); },
    }),
  ]));
  // estimator
  box.append(segmented('mb-est', [
    { v: 'MLR', t: 'MLR' }, { v: 'WLSMV', t: 'WLSMV' },
  ], SPEC.estimator, (v) => { SPEC.estimator = v; refresh(); }));
  return box;
}

function modelTypeControls() {
  const types = [
    { k: 'cfa', t: 'CFA', d: 'independent-cluster confirmatory model' },
    { k: 'esem', t: 'ESEM', d: 'all cross-loadings freely estimated' },
    { k: 'bifactorCfa', t: 'Bifactor-CFA', d: 'orthogonal general + specific factors' },
    { k: 'bifactorEsem', t: 'Bifactor-ESEM', d: 'general + specific factors (BI-GEOMIN / target)' },
  ];
  const box = el('div', { class: 'flex flex-col gap-2' });
  for (const ty of types) {
    const id = `mt-${ty.k}`;
    box.append(el('label', { class: 'flex items-start gap-2.5 cursor-pointer', for: id }, [
      el('input', { id, type: 'checkbox', checked: SPEC.modelTypes[ty.k], class: 'mt-0.5', style: { accentColor: 'var(--petrol)' }, onchange: (e) => { SPEC.modelTypes[ty.k] = e.target.checked; updatePreview(); refresh(); } }),
      el('span', {}, [
        el('span', { class: 'font-semibold text-[0.92rem]', style: { color: 'var(--ink)' } }, ty.t),
        el('span', { class: 'block text-[0.78rem]', style: { color: 'var(--ink-faint)' } }, ty.d),
      ]),
    ]));
  }
  return box;
}

function segmented(id, opts, current, onpick) {
  const box = el('div', { id, class: 'inline-flex rounded-lg p-0.5 gap-0.5', style: { background: 'var(--surface-2)', border: '1px solid var(--line)' } });
  for (const o of opts) {
    const active = o.v === current;
    box.append(el('button', {
      class: 'px-3 py-1.5 rounded-md text-[0.84rem] font-semibold transition', 'data-v': o.v,
      style: active
        ? { background: 'linear-gradient(155deg,var(--petrol-bright),var(--petrol-deep))', color: '#EAF3F1', boxShadow: 'var(--shadow-sm)' }
        : { background: 'transparent', color: 'var(--ink-soft)' },
      onclick: () => onpick(o.v),
    }, o.t));
  }
  return box;
}

function gridLegend() {
  return el('div', { class: 'flex items-center gap-4 mt-4 text-[0.74rem]', style: { color: 'var(--ink-soft)' } }, [
    legendSwatch('linear-gradient(155deg,var(--ochre-soft),var(--ochre))', 'target (main) loading'),
    legendSwatch('var(--petrol-tint)', 'free cross-loading (ESEM)'),
    legendSwatch('var(--surface)', 'fixed to 0'),
  ]);
}
function legendSwatch(bg, label) {
  return el('span', { class: 'inline-flex items-center gap-1.5' }, [
    el('span', { style: { width: '12px', height: '12px', borderRadius: '4px', background: bg, border: '1px solid var(--line-strong)', display: 'inline-block' } }),
    label,
  ]);
}

// ---------- render/update ----------
function refresh() {
  // items chips
  const itemBox = $('#mb-items');
  if (itemBox) {
    itemBox.innerHTML = '';
    for (const v of SPEC.data.varNames) {
      const on = SPEC.items.includes(v);
      itemBox.append(el('button', {
        class: 'chip', style: on
          ? { background: 'var(--petrol)', color: '#EAF3F1', borderColor: 'transparent', cursor: 'pointer' }
          : { background: 'var(--surface)', color: 'var(--ink-faint)', borderColor: 'var(--line)', cursor: 'pointer' },
        onclick: () => {
          const next = on ? SPEC.items.filter((x) => x !== v) : SPEC.data.varNames.filter((x) => SPEC.items.includes(x) || x === v);
          if (next.length >= 1) { setItems(SPEC, next); refresh(); }
        },
      }, v));
    }
  }
  // factor count + labels
  const nf = $('#mb-nfac'); if (nf) nf.textContent = String(SPEC.factors.length);
  const fl = $('#mb-faclabels');
  if (fl) {
    fl.innerHTML = '';
    SPEC.factors.forEach((f) => {
      fl.append(el('input', {
        value: f.label, 'aria-label': `label for ${f.id}`,
        class: 'w-16 px-2 py-1 rounded text-[0.8rem] font-mono', style: { border: '1px solid var(--line)', background: 'var(--surface)' },
        oninput: (e) => { f.label = e.target.value || f.id; updatePreview(); },
      }));
    });
  }
  // epsilon visibility
  const epsWrap = $('#mb-eps-wrap'); if (epsWrap) epsWrap.style.display = SPEC.rotation.type === 'GEOMIN' ? 'flex' : 'none';
  // re-render segmented states by rebuilding (simplest): update active styles
  syncSegmented('mb-rot', SPEC.rotation.type);
  syncSegmented('mb-obl', SPEC.rotation.oblique ? 'OBLIQUE' : 'ORTHOGONAL');
  syncSegmented('mb-est', SPEC.estimator);

  renderGroups();
  renderGrid();
  renderValidation();
  updatePreview();
}

function renderGroups() {
  const host = $('#mb-groups'); if (!host) return;
  host.innerHTML = '';
  const invOn = SPEC.groups.enabled || SPEC.longitudinal.enabled;

  // master enable
  host.append(el('label', { class: 'flex items-center gap-2.5 cursor-pointer' }, [
    el('input', { type: 'checkbox', checked: invOn, style: { accentColor: 'var(--petrol)' }, onchange: (e) => {
      if (e.target.checked) setInvMode('groups'); else { SPEC.groups.enabled = false; SPEC.longitudinal.enabled = false; }
      refresh();
    } }),
    el('span', { class: 'font-semibold text-[0.9rem]', style: { color: 'var(--ink)' } }, 'Test measurement invariance'),
  ]));
  if (!invOn) return;

  // mode: across groups ↔ across time points (mutually exclusive)
  const mode = SPEC.longitudinal.enabled ? 'time' : 'groups';
  host.append(el('div', { class: 'mt-3' }, segmented('mb-invmode', [
    { v: 'groups', t: 'Across groups' }, { v: 'time', t: 'Across time' },
  ], mode, (v) => { setInvMode(v); refresh(); })));

  if (mode === 'time') renderTimeMode(host);
  else renderGroupsMode(host);

  // shared: invariance steps
  const seqHolder = mode === 'time' ? SPEC.longitudinal.invariance : SPEC.groups.invariance;
  const seqBox = el('div', { class: 'flex flex-col gap-1 mt-2' });
  for (const step of INV_SEQUENCE) {
    seqBox.append(el('label', { class: 'flex items-center gap-2 cursor-pointer text-[0.82rem]' }, [
      el('input', { type: 'checkbox', checked: seqHolder.sequence.includes(step), style: { accentColor: 'var(--ochre)' }, onchange: (e) => { toggleStep(seqHolder, step, e.target.checked); updatePreview(); } }),
      INV_META[step].label,
    ]));
  }
  host.append(el('p', { class: 'text-[0.78rem] mt-3 mb-1', style: { color: 'var(--ink-faint)' } }, 'Invariance steps (in order)'), seqBox);

  const banner = mode === 'time'
    ? 'With time on, “Generate syntax” produces a longitudinal invariance sequence (one .inp per step, for each checked CFA/ESEM model). The Λ grid above is the Time-1 pattern, mirrored to Time 2; matching indicators’ residuals are correlated across waves.'
    : 'With grouping on, “Generate syntax” produces this invariance sequence (using the ESEM measurement model above), one .inp per step.';
  host.append(el('p', { class: 'text-[0.76rem] mt-3 px-3 py-2 rounded-lg', style: { background: 'var(--petrol-tint)', color: 'var(--petrol-deep)' } }, banner));
}

function renderGroupsMode(host) {
  const avail = SPEC.data.varNames.filter((v) => !SPEC.items.includes(v));
  if (!avail.length) { host.append(el('p', { class: 'text-[0.8rem] mt-2', style: { color: 'var(--danger)' } }, 'Leave a variable unselected as items to use it for grouping.')); return; }
  if (!SPEC.groups.variable) pickGroupVar(avail[0]);
  const sel = el('select', { class: 'px-2.5 py-1.5 rounded text-[0.84rem] mt-2', style: { border: '1px solid var(--line-strong)', background: 'var(--surface)' }, onchange: (e) => { pickGroupVar(e.target.value); refresh(); } },
    avail.map((v) => el('option', { value: v, selected: v === SPEC.groups.variable }, v)));
  host.append(el('div', { class: 'flex items-center gap-2 mt-2' }, [el('span', { class: 'text-[0.8rem]', style: { color: 'var(--ink-soft)' } }, 'Grouping variable'), sel]));

  if (SPEC.groups.codes.length) {
    const codeBox = el('div', { class: 'flex flex-col gap-1.5 mt-2' });
    SPEC.groups.codes.forEach((c) => codeBox.append(el('div', { class: 'flex items-center gap-2' }, [
      el('span', { class: 'font-mono text-[0.74rem] w-8', style: { color: 'var(--ink-faint)' } }, `=${c.code}`),
      el('input', { value: c.label, class: 'flex-1 px-2 py-1 rounded text-[0.8rem]', style: { border: '1px solid var(--line)', background: 'var(--surface)' }, oninput: (e) => { c.label = e.target.value.trim() || ('g' + c.code); updatePreview(); } }),
    ])));
    host.append(el('p', { class: 'text-[0.78rem] mt-3 mb-1', style: { color: 'var(--ink-faint)' } }, 'Group labels'), codeBox);
  }
}

function renderTimeMode(host) {
  const L = SPEC.longitudinal;
  // wave labels + indicator pickers (Time-1 columns drive the Λ grid; Time-2 are positionally matched)
  [0, 1].forEach((idx) => {
    const labelInput = el('input', { value: L.waveLabels[idx] || '', class: 'w-28 px-2 py-1 rounded text-[0.8rem]', style: { border: '1px solid var(--line)', background: 'var(--surface)' }, oninput: (e) => { L.waveLabels[idx] = e.target.value || (idx ? 'Time 2' : 'Time 1'); updatePreview(); } });
    host.append(el('div', { class: 'flex items-center gap-2 mt-3' }, [
      el('span', { class: 'text-[0.78rem] font-semibold', style: { color: 'var(--petrol)' } }, idx ? 'Time 2' : 'Time 1'),
      el('span', { class: 'text-[0.74rem]', style: { color: 'var(--ink-faint)' } }, 'label'), labelInput,
    ]));
    host.append(wavePicker(idx));
  });
  host.append(el('label', { class: 'flex items-center gap-2.5 cursor-pointer mt-3' }, [
    el('input', { type: 'checkbox', checked: L.correlatedUniqueness, style: { accentColor: 'var(--petrol)' }, onchange: (e) => { L.correlatedUniqueness = e.target.checked; updatePreview(); } }),
    el('span', {}, [
      el('span', { class: 'text-[0.84rem] font-semibold', style: { color: 'var(--ink)' } }, 'Correlated uniquenesses'),
      el('span', { class: 'block text-[0.76rem]', style: { color: 'var(--ink-faint)' } }, 'Correlate each indicator’s residual across the two waves (recommended).'),
    ]),
  ]));
}

// Indicator chips for one wave; a column used in the other wave is disabled (waves must be disjoint).
function wavePicker(waveIdx) {
  const L = SPEC.longitudinal;
  const mine = new Set(L.waves[waveIdx]);
  const other = new Set(L.waves[1 - waveIdx]);
  const box = el('div', { class: 'flex flex-wrap gap-1.5 mt-1' });
  for (const v of SPEC.data.varNames) {
    const disabled = other.has(v);
    const on = mine.has(v);
    box.append(el('button', {
      class: 'chip', disabled,
      style: {
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? '0.3' : '1',
        ...(on ? { background: 'var(--petrol)', color: '#EAF3F1', borderColor: 'transparent' } : { background: 'var(--surface)', color: 'var(--ink-faint)', borderColor: 'var(--line)' }),
      },
      onclick: disabled ? undefined : () => {
        const next = new Set(mine); if (on) next.delete(v); else next.add(v);
        setWaveItems(SPEC, waveIdx, SPEC.data.varNames.filter((x) => next.has(x)));
        refresh();
      },
    }, v));
  }
  return box;
}

// Switch invariance mode, keeping groups/longitudinal mutually exclusive and seeding sensible defaults.
function setInvMode(mode) {
  if (mode === 'time') {
    SPEC.groups.enabled = false;
    SPEC.longitudinal.enabled = true;
    const L = SPEC.longitudinal;
    if (!L.waves[0]?.length) L.waves[0] = SPEC.items.slice();
    if (!L.waves[1]?.length) {
      const used = new Set(L.waves[0]);
      L.waves[1] = SPEC.data.varNames.filter((v) => !used.has(v)).slice(0, L.waves[0].length);
    }
    setWaveItems(SPEC, 0, L.waves[0]); // bind the Λ grid / factors to the Time-1 indicators
    if (!L.invariance.sequence?.length) L.invariance.sequence = INV_SEQUENCE.slice();
  } else {
    SPEC.longitudinal.enabled = false;
    SPEC.groups.enabled = true;
    const avail = SPEC.data.varNames.filter((v) => !SPEC.items.includes(v));
    if (!SPEC.groups.variable && avail.length) pickGroupVar(avail[0]);
  }
}
function pickGroupVar(v) {
  SPEC.groups.variable = v;
  const vals = distinctValues(SPEC.data, v);
  SPEC.groups.codes = vals.length ? vals.map((x) => ({ code: String(x.value), label: `group${x.value}` })) : [{ code: '1', label: 'group1' }, { code: '2', label: 'group2' }];
  if (!SPEC.groups.invariance.sequence?.length) SPEC.groups.invariance.sequence = INV_SEQUENCE.slice();
}
function toggleStep(seqHolder, step, on) {
  let seq = seqHolder.sequence.filter((s) => s !== step);
  if (on) { seq.push(step); seq = INV_SEQUENCE.filter((s) => seq.includes(s)); }
  seqHolder.sequence = seq;
}

function syncSegmented(id, current) {
  const box = $('#' + id); if (!box) return;
  $$('button', box).forEach((b) => {
    const active = b.dataset.v === current;
    Object.assign(b.style, active
      ? { background: 'linear-gradient(155deg,var(--petrol-bright),var(--petrol-deep))', color: '#EAF3F1', boxShadow: 'var(--shadow-sm)' }
      : { background: 'transparent', color: 'var(--ink-soft)', boxShadow: 'none' });
  });
}

function renderGrid() {
  const host = $('#mb-grid'); if (!host) return;
  const ids = factorIds(SPEC);
  const isTarget = SPEC.rotation.type === 'TARGET';
  const hint = $('#mb-grid-hint');
  if (hint) hint.textContent = isTarget ? 'click: main ↔ ~0' : 'click: set primary loading';
  host.innerHTML = '';
  const grid = el('div', { class: 'lam-grid', style: { gridTemplateColumns: `2.6rem repeat(${ids.length}, 54px)`, width: 'max-content', maxWidth: '100%' } });
  grid.append(el('div'));
  for (const f of SPEC.factors) grid.append(el('div', { class: 'text-center font-mono text-[0.74rem]', style: { color: 'var(--petrol)' } }, f.label));
  for (const it of SPEC.items) {
    grid.append(el('div', { class: 'font-mono text-[0.72rem] flex items-center', style: { color: 'var(--ink-faint)' } }, it));
    for (const fid of ids) {
      const main = !!SPEC.target[it]?.[fid];
      const cell = el('button', {
        class: 'lam-cell' + (main ? '' : (isTarget ? '' : ' cross')),
        'aria-pressed': main ? 'true' : 'false',
        'aria-label': `${it} on ${fid}: ${main ? 'main' : (isTarget ? 'fixed to 0' : 'free cross-loading')}`,
        onclick: () => { toggleTarget(SPEC, it, fid); refresh(); },
      }, el('span', { class: 'dot' }));
      grid.append(cell);
    }
  }
  host.append(grid);
}

function renderValidation() {
  const host = $('#mb-validation'); if (!host) return;
  const { errors, warnings } = validateSpec(SPEC);
  host.innerHTML = '';
  for (const e of errors) host.append(msg(e, 'err'));
  for (const w of warnings) host.append(msg(w, 'warn'));
  const cont = $('#mb-continue'); if (cont) cont.disabled = errors.length > 0;
}
function msg(text, kind) {
  const color = kind === 'err' ? 'var(--danger)' : '#9A551C';
  const bg = kind === 'err' ? 'var(--danger-tint)' : 'var(--ochre-tint)';
  return el('div', { class: 'text-[0.8rem] px-3 py-2 rounded-lg flex items-start gap-2', style: { background: bg, color } }, [
    el('span', { style: { fontWeight: '700' } }, kind === 'err' ? '!' : '△'),
    el('span', {}, text),
  ]);
}

function updatePreview() {
  const pre = $('#mb-preview'); const tabs = $('#mb-prev-tabs'); if (!pre) return;
  const models = requestedModels(SPEC);
  if (!models.length) { pre.textContent = '— select at least one model —'; if (tabs) tabs.innerHTML = ''; renderConcept(null); return; }
  if (!pre._active || !models.find((m) => m.key === pre._active)) pre._active = models[0].key;
  if (tabs) {
    tabs.innerHTML = '';
    for (const m of models) {
      const active = m.key === pre._active;
      tabs.append(el('button', {
        class: 'px-2.5 py-1 rounded text-[0.74rem] font-semibold',
        style: active ? { background: 'var(--petrol)', color: '#EAF3F1' } : { background: 'var(--surface-2)', color: 'var(--ink-soft)' },
        onclick: () => { pre._active = m.key; updatePreview(); },
      }, m.label));
    }
  }
  pre.innerHTML = highlight(buildInp(SPEC, pre._active));
  renderConcept(pre._active);
}

// Theoretical structure diagram of the active model (or the first requested one).
function renderConcept(activeKey) {
  const host = $('#mb-diagram'); if (!host) return;
  const models = requestedModels(SPEC);
  if (!models.length) { host.innerHTML = '<p style="color:var(--ink-faint);font-size:0.84rem;margin:0">Select a model above to see its structure.</p>'; return; }
  const key = activeKey || models[0].key;
  // invariance uses the ESEM measurement model; longitudinal keys carry their model type (linv:<mt>:<step>)
  const LINV_TYPE = { esem: 'esem', cfa: 'cfa', besem: 'bifactorEsem' };
  const modelType = key.startsWith('linv:') ? (LINV_TYPE[key.split(':')[1]] || 'esem') : key.startsWith('inv:') ? 'esem' : key;
  host.innerHTML = conceptDiagramSVG(SPEC, modelType, { showResiduals: false });
}

// minimal Mplus syntax highlighter for the preview
function highlight(text) {
  return text.split('\n').map((line) => {
    const esc = line.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    if (/^\s*!/.test(line)) return `<span class="c-cmt">${esc}</span>`;
    return esc
      .replace(/^(TITLE|DATA|VARIABLE|ANALYSIS|MODEL|OUTPUT|SAVEDATA)(:|\b)/i, '<span class="c-key">$1</span>$2')
      .replace(/(~0|\(\*\d+\)|@[\d.]+|\bBY\b|\bWITH\b|\bON\b|\bPWITH\b)/g, '<span class="c-op">$1</span>');
  }).join('\n');
}
