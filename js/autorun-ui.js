// autorun-ui.js — "Run in Mplus — auto mode" card on the Syntax step. Writes the generated
// file set into a user-picked working folder, tells the user to double-click RUN-ALL.bat,
// and imports the .out files live as Mplus finishes them (js/autorun.js does the watching).
import { el, toast, downloadText } from './ui.js';
import { supportsFolderMode, pickWorkFolder, restoreWorkFolder, reRequestPermission, writeRunSet, clearStaleOuts, watchForOuts } from './autorun.js';
import { buildRunAllBat, buildRunAllSh, expectedOutName } from './run-scripts.js';

// One watch survives step navigation (renderSyntaxStep rebuilds this card on every visit);
// module-level state lets a re-rendered card re-attach to the live run.
let active = null; // { handle, watcher, statuses: Map<key,state>, expected, folderName, done }

export function renderAutoRunCard(host, ctx) {
  const card = el('div', { class: 'surface p-6 mt-6' });
  card.append(el('p', { class: 'eyebrow mb-3' }, 'Run in Mplus — auto mode'));

  if (!supportsFolderMode()) {
    card.append(el('p', { class: 'text-[0.84rem]', style: { color: 'var(--ink-faint)', maxWidth: '70ch' } },
      'Needs Chrome or Edge on desktop (File System Access API). In this browser, use the download buttons above — everything else works the same.'));
    host.append(card);
    return;
  }

  card.append(el('p', { class: 'text-[0.84rem] mb-4', style: { color: 'var(--ink-soft)', maxWidth: '72ch' } }, [
    'Pick a working folder: the app writes every .inp, the Mplus-ready data file, and a ',
    el('code', { style: { fontFamily: 'var(--font-mono)' } }, 'RUN-ALL.bat'),
    ' there. Double-click that file once — results below fill in automatically as each model finishes. Nothing is uploaded; the folder is on this computer.',
  ]));

  const dyn = el('div');
  card.append(dyn);
  host.append(card);

  let handle = active?.handle || null;
  let needsPermission = false;
  const expected = ctx.models.map((m) => ({ key: m.key, label: m.label, inp: m.file, out: expectedOutName(m.file) }));

  const stateLabel = { pending: 'waiting for .out', running: 'Mplus writing…', imported: 'imported ✓' };
  function statusRows() {
    const box = el('div', { class: 'flex flex-col gap-1.5 mt-3' });
    for (const m of active.expected) {
      const s = active.statuses.get(m.key) || 'pending';
      box.append(el('div', { class: 'flex items-center gap-2.5 text-[0.84rem]' }, [
        el('span', { class: `run-dot ${s}` }),
        el('span', { class: 'flex-1', style: { color: 'var(--ink)' } }, m.label),
        el('span', { class: 'font-mono text-[0.74rem]', style: { color: s === 'imported' ? 'var(--petrol)' : 'var(--ink-faint)' } }, stateLabel[s] || s),
      ]));
    }
    return box;
  }

  async function startRun() {
    try {
      if (!handle) { handle = await pickWorkFolder(); needsPermission = false; }
      else if (needsPermission) {
        if (!(await reRequestPermission(handle))) { toast('Folder permission denied', 'err'); return; }
        needsPermission = false;
      }
      const files = ctx.buildFiles();
      const inpNames = files.filter((f) => /\.inp$/i.test(f.name)).map((f) => f.name);
      await clearStaleOuts(handle, expected.map((e) => e.out));
      await writeRunSet(handle, files);
      const scripts = [
        { name: 'RUN-ALL.bat', text: buildRunAllBat(inpNames) },
        { name: 'run-all.sh', text: buildRunAllSh(inpNames) },
      ];
      try { await writeRunSet(handle, scripts); }
      catch { // script writes can be blocked by browser/enterprise policy — hand them over as downloads
        for (const s of scripts) downloadText(s.text, s.name, 'text/plain');
        toast('Could not write RUN-ALL scripts into the folder — downloaded instead; move them next to the .inp files', 'err');
      }
      active = { handle, statuses: new Map(expected.map((e) => [e.key, 'pending'])), expected, folderName: handle.name, watcher: null, done: false };
      active.watcher = watchForOuts(handle, expected, {
        onStatus: (m, s) => { active.statuses.set(m.key, s); sync(); },
        onOut: (m, text) => ctx.onOutText(m.out, text),
        onDone: () => { active.done = true; sync(); toast('All models imported', 'ok'); },
        onError: (why) => {
          if (why === 'permission') { needsPermission = true; toast('Folder permission lost — reconnect and watch again', 'err'); }
          else toast('Auto mode stopped: ' + why, 'err');
          active = null;
          sync();
        },
      });
      // paint 'running' updates through the shared statuses map
      active.watcher && sync();
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the picker
      toast('Auto mode: ' + ((e && e.message) || e), 'err');
    }
  }

  function stopRun() {
    active?.watcher?.stop();
    active = null;
    sync();
  }

  function sync() {
    dyn.innerHTML = '';
    if (active) {
      // live run view — folder line, per-model status, stop/results actions
      dyn.append(el('div', { class: 'flex items-center gap-2 text-[0.84rem]' }, [
        el('span', { style: { color: 'var(--ink-faint)' } }, 'Working folder:'),
        el('span', { class: 'font-mono', style: { color: 'var(--petrol)' } }, active.folderName),
        el('span', { class: 'flex-1' }),
        active.done
          ? el('button', { class: 'btn btn-accent', onclick: () => ctx.openResults() }, 'View results →')
          : el('button', { class: 'btn btn-ghost', onclick: stopRun }, 'Stop watching'),
      ]));
      if (!active.done) {
        dyn.append(el('p', { class: 'text-[0.8rem] mt-2 px-3 py-2 rounded-lg', style: { background: 'var(--petrol-tint)', color: 'var(--petrol-deep)' } },
          'Now open the folder and double-click RUN-ALL.bat (first run: if SmartScreen appears, choose “More info → Run anyway”; macOS: run “sh run-all.sh” in Terminal). Keep this tab visible — imports may pause while it is in the background.'));
      }
      dyn.append(statusRows());
    } else {
      const row = el('div', { class: 'flex flex-wrap items-center gap-2' });
      row.append(el('button', { class: 'btn btn-accent', onclick: startRun },
        handle ? 'Write files & watch' : 'Choose working folder…'));
      if (handle) {
        row.append(el('span', { class: 'text-[0.82rem]', style: { color: 'var(--ink-faint)' } }, [
          'folder: ', el('span', { class: 'font-mono', style: { color: 'var(--petrol)' } }, handle.name),
          needsPermission ? ' (permission needed — the button will ask)' : '',
        ]));
        row.append(el('button', {
          class: 'btn btn-ghost', style: { padding: '0.4rem 0.8rem' },
          onclick: async () => { try { handle = await pickWorkFolder(); needsPermission = false; sync(); } catch {} },
        }, 'Change folder'));
      }
      dyn.append(row);
      dyn.append(el('p', { class: 'text-[0.76rem] mt-2', style: { color: 'var(--ink-faint)' } },
        'Existing files with the same names in that folder are overwritten; leftover .out files from a previous run are cleared before watching.'));
    }
  }

  // a live run from an earlier visit re-attaches; otherwise try to restore last session's folder
  if (active) sync();
  else {
    sync();
    restoreWorkFolder().then((r) => {
      if (!r || active || handle) return;
      handle = r.handle;
      needsPermission = r.state !== 'granted';
      sync();
    });
  }
}
