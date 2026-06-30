# ESEM Mplus Toolkit — *Simple Structure*

A small, **client-side** web app that removes the two most error-prone steps of an ESEM / bifactor-ESEM
workflow in **Mplus**:

1. **Writing the `.inp` syntax** — the `(*1)` ESEM blocks, `~0` target patterns, standardized-factor
   identification, and the measurement-invariance label bookkeeping.
2. **Turning the `.out` into journal tables** — fit indices, standardized loadings, ω, factor
   correlations, invariance comparisons, prose, and path diagrams.

It **does not run Mplus** and **never uploads your data** — everything happens in your browser. You run
the generated `.inp` files in your own licensed Mplus and drop the resulting `.out` back in.

The syntax and APA table format follow **Swami, Maïano & Morin (2023), _A guide to ESEM and bifactor-ESEM
in body image research_, _Body Image_ 47, 262–278.**

> **▶ Try it live (no install): https://cahitgs.github.io/esem-mplus-toolkit/**
> &nbsp;·&nbsp; **Guided demo (worked example): https://cahitgs.github.io/esem-mplus-toolkit/demo.html**

![Model builder — Λ target-pattern matrix, live syntax, conceptual diagram](docs/img/02-model-builder.png?v=3)

---

## What it does

| Step | You do | The app does |
|------|--------|--------------|
| **1 · Data** | Upload a `.dat` / `.csv` | Auto-detect columns, delimiter, header; export an Mplus-ready `.dat` |
| **2 · Model** | Sketch the factor model on a Λ grid | Pick factors, rotation (Geomin / Target), estimator, bifactor, grouping |
| **3 · Syntax** | — | Generate exact `.inp` for each model; download one file or a `.zip` |
| **4 · Results** | Drop your Mplus `.out` files | APA fit / loadings / bifactor / invariance tables + prose + path diagrams; copy to Word, `.docx` |

### Models supported

- **CFA** (independent-clusters, standardized-factor identification `F1 BY x1* …; F1@1;`)
- **ESEM** — Geomin (oblique/orthogonal, ε) and Target rotation
- **Bifactor-CFA** and **Bifactor-ESEM** (BI-GEOMIN orthogonal / orthogonal Target)
- **Measurement invariance** across groups — configural → metric → scalar → strict → variance–covariance → latent means (Satorra–Bentler scaled Δχ² for MLR; Chen 2007 ΔCFI/ΔRMSEA verdicts)
- **ESEM-within-CFA** — convert a rotated ESEM solution into an equivalent CFA you can embed in larger SEM/MIMIC/DIF models (Morin's referent method)

### Path diagrams

Faithful to the figures in Swami/Maïano/Morin (2023): factors, items, correlations, uniquenesses, and a
proper bifactor layout (specific factors one side, the global factor reaching every item the other side).
Diagrams are interactive — toggle cross-loadings / uniquenesses, show/hide factors, **drag the ellipses**
to reposition for reporting, and export SVG / PNG.

---

## ESEM-within-CFA

After you run an ESEM with `OUTPUT: SVALUES;` (the app adds this automatically), drop the `.out` back in
and the **Results** step offers a one-click conversion to ESEM-within-CFA: it reads the rotated solution's
unstandardized estimates, picks a referent indicator per factor, fixes that referent's cross-loadings to
their ESEM values (and, for bifactor, all factor correlations to 0), and writes a runnable `.inp`.

![ESEM-within-CFA card](docs/img/05-esem-within-cfa.png?v=3)

**Verified against real Mplus 8.3:** the generated oblique ESEM-within-CFA reproduces the source ESEM
*exactly* — identical number of free parameters, degrees of freedom, χ², and log-likelihood
(e.g. the bundled 3-factor ESEM: npar 72, df 63, LL −11107.13 in both). See [`GUIDE.md`](GUIDE.md).

---

## Quick start

It is a static site — any static server works.

```bash
# Node (recommended; sets no-store so a plain refresh reloads modules)
node serve.mjs            # → http://localhost:3000
PORT=3001 node serve.mjs  # if 3000 is taken

# or Python
python -m http.server 8000
```

Then open the URL and follow **Data → Model → Syntax → Results**. A ready-made example with real Mplus
outputs lives in [`example-dataset/`](example-dataset/) — open the app, choose **"Skip to reading .out
files →"**, and drop `example-dataset/2_ESEM_geomin.out`.

No build step, no backend, no dependencies to install. Tailwind, `docx`, and `JSZip` load from CDNs; the
four engines (syntax generator, `.out` parser, APA render, ESEM-within-CFA) are plain ES modules.

---

## Tested against real Mplus

The engines are unit-tested against **real Mplus `.out` fixtures**, and the generated syntax has been run
back through Mplus 8.3 to confirm it reproduces the intended models (matching degrees of freedom and fit).

```bash
node test/parser.test.mjs      # .out parser            (57)
node test/dataparse.test.mjs   # data-file detection    (9)
node test/ewc.test.mjs         # ESEM-within-CFA        (32)
```

---

## Project layout

```
index.html              shell (Tailwind config, fonts, 4-step stepper)
css/app.css             design system
js/
  state.js              ModelSpec + validation
  data-parse.js         .dat/.csv reader + Mplus-ready .dat export
  model-builder.js      Λ target-pattern grid + controls
  syntax-generator.js   buildInp(spec, modelType) — exact Mplus templates
  out-parser.js         parseOut(text) → ParsedModel
  ewc.js                ESEM-within-CFA (parse SVALUES, build EWC .inp)
  apa-render.js         APA tables + prose + Satorra–Bentler Δχ²
  diagram.js            SVG path diagrams (interactive)
  docx-export.js        copy-to-Word, .docx, .zip
test/                   node test runners + real .out fixtures
example-dataset/        synthetic 3-factor data + ready .inp/.out
docs/img/               screenshots used in the docs
```

See the full walkthrough in **[`GUIDE.md`](GUIDE.md)**.

---

## Notes & disclaimer

- This is an independent helper. It is **not affiliated with or endorsed by** Muthén & Muthén (Mplus) or
  the authors of Swami, Maïano & Morin (2023). You need your own licensed copy of Mplus to run the syntax.
- Your data and output files never leave the browser; the app makes no network requests with them.
- The reference article and its supplement are © their publisher and are **not** redistributed here.

## License

[MIT](LICENSE) © 2026 Mehmet Cahit Marangoz
