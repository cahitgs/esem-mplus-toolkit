# A walkthrough — *Simple Structure* (ESEM Mplus Toolkit)

This guide goes through the whole workflow with the bundled [`example-dataset/`](example-dataset/): build
the syntax, run it in your own Mplus, and turn the output into APA tables, prose, and diagrams — including
**ESEM-within-CFA**. Every syntax pattern below has been run back through Mplus 8.3 to confirm it reproduces
the intended model.

**Try it live:** <https://cahitgs.github.io/esem-mplus-toolkit/> · or `node serve.mjs` locally.

The app keeps everything in the browser: it generates Mplus input and reads Mplus output, but it never runs
Mplus and never uploads your data.

---

## 1 · Data

Upload a `.dat` or `.csv`. The app auto-detects the column count, the delimiter (space / comma / semicolon /
tab), and whether the first row is a header, and it can export an **Mplus-ready `.dat`** (space-delimited, no
header, dot decimals) — handy when your file is a semicolon CSV or uses comma decimals, which Mplus cannot
read directly.

For this walkthrough you can skip data entry: open the app and click **"Skip to reading .out files →"**, or
use the example file `example-dataset/data.dat` (600 × 16, a synthetic 3-factor / bifactor dataset).

## 2 · Model

Sketch the measurement model on the **Λ target-pattern matrix**. Rows are items, columns are factors; click
a cell to set the primary (target) loading. Choose the number of factors, the rotation, the estimator, which
models to generate, and (optionally) a grouping variable for invariance.

![Model builder](docs/img/02-model-builder.png?v=4)

**Geomin vs Target — what the grid means.** Under **Geomin** every item loads on every factor freely (the
rotation decides the pattern); the orange marks only label which loading you consider *primary* (for bolding,
the diagram, and ω) and do **not** change the syntax. Under **Target** the grid *is* the model: marked cells
are free, unmarked cells are given a target value of `~0`. The app warns if a Target pattern has too few `~0`
constraints to identify the rotation, or if a factor has no main items.

## 3 · Syntax

The app writes exact Mplus `.inp` for each requested model. Download a single file or a `.zip` of all of
them; lines are wrapped to stay under Mplus's 90-character limit.

![Generated syntax](docs/img/03-syntax.png?v=5)

A few load-bearing conventions, matched to Swami/Maïano/Morin (2023):

- **CFA** uses standardized-factor identification: `F1 BY x1* x2 x3; F1@1;`
- **ESEM (Geomin):** `ROTATION = GEOMIN(OBLIQUE, .5);` and `F1-Fk BY <items> (*1);`
- **ESEM (Target):** one `BY` line per factor with `~0` on the cross-loadings.
- **Bifactor-ESEM:** `ROTATION = BI-GEOMIN(ORTHOGONAL .5);` with `G F1-Fk BY <items> (*1);`
- **Invariance** uses the standardized-factors approach (`F@1`/`[F@0]` freed to `*`/`[*]` from weak
  invariance on) with alphanumeric equality labels `(i1-i#)`, `(u1-u#)`, `(cov#)`.
- ESEM outputs include `SVALUES`, which you need for ESEM-within-CFA (below).

Now run the `.inp` files in **your own Mplus** and save the `.out` files.

## 4 · Results

Drop one or many `.out` files. Each is parsed in the browser into a fit row, a standardized-loadings table
(target loadings bold, δ uniqueness, McDonald's ω, factor correlations), auto-written APA prose, and a path
diagram. Multiple invariance models become a single comparison table with Δχ² (Satorra–Bentler scaled for
MLR), ΔCFI, and ΔRMSEA, and a "supported / not supported" verdict (Chen, 2007). Export with **Copy for
Word** or **Download .docx**.

![Results — fit, loadings, diagram](docs/img/04-results.png?v=5)

The diagrams follow the article's figures and are interactive — toggle cross-loadings / uniquenesses,
show/hide factors, drag the ellipses to reposition for reporting, and export SVG or PNG. The bifactor layout
puts the specific factors on one side and the global factor on the other, reaching every item:

![Bifactor diagram](docs/img/06-bifactor-diagram.png?v=5)

The six invariance models (men vs women) collapse into one comparison table with the Δ statistics and a
per-step verdict:

![Measurement invariance comparison table](docs/img/07-invariance.png?v=5)

## 5 · ESEM-within-CFA

When a dropped ESEM (or bifactor-ESEM) `.out` carries a `SVALUES` block, the Results step shows an
**ESEM-within-CFA** card. It reads the rotated solution's *unstandardized* estimates ("CFA MODEL COMMAND
WITH FINAL ROTATED ESTIMATES USED AS STARTING VALUES"), picks a referent indicator per factor, fixes that
referent's cross-loadings to their ESEM values (`@`), fixes the factor variances to 1, and — for bifactor —
fixes all factor correlations to 0. Choose a different referent per factor from the dropdowns; copy or
download the runnable `.inp`.

![ESEM-within-CFA card](docs/img/05-esem-within-cfa.png?v=5)

This is Morin's referent method (Technical Supplement, pp. T10–T13). With the same referents, the toolkit
reproduces the published ESEM-within-CFA byte-for-byte at the parameter level.

### Why you can trust it — exact reproduction in Mplus 8.3

The generated **oblique** ESEM-within-CFA is an exact reparameterization of the ESEM it came from:

| Model (example dataset) | npar | df | χ² (MLR) | log-likelihood |
|---|---|---|---|---|
| 3-factor ESEM (Geomin) — `2_ESEM_geomin.out` | 72 | 63 | 68.83 | −11107.13 |
| → its ESEM-within-CFA | **72** | **63** | **68.82** | **−11107.13** |

Same parameter count, same degrees of freedom, same fit. (For an orthogonal bifactor solution the
within-CFA reproduces the same log-likelihood and estimates via the referent method; its df can sit
m(m−1)/2 above the rotated bifactor-ESEM — a known property of the orthogonal referent parameterization.)

---

## Reference

Swami, V., Maïano, C., & Morin, A. J. S. (2023). A guide to exploratory structural equation modeling (ESEM)
and bifactor-ESEM in body image research. *Body Image, 47,* 262–278.

*Independent tool; not affiliated with or endorsed by Muthén & Muthén or the article authors. The article
and its supplement are not redistributed here.*
