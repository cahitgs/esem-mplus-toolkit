# Example dataset — `data.dat`

A **fully synthetic** dataset that mirrors the 3-factor / bifactor structure of the ACSS example in
Swami, Maïano & Morin (2023). No real participants, and the article's own data is not redistributed.

- **600 rows × 16 columns**, space-delimited, no header, dot decimals (Mplus free format).
- Columns `i1 … i15` = 15 items; `gender` = a 2-level grouping variable (`1` men / `2` women).
- **Structure:** a true bifactor population — one general factor (G) plus **3 specific factors of five
  items each** (i1–i5 → F1, i6–i10 → F2, i11–i15 → F3), λ_G ≈ .45, λ_S ≈ .55. So it fits a 3-factor
  CFA/ESEM well and a bifactor model even better.

## Ready-made Mplus inputs and outputs

Every `.inp` was produced by the toolkit; every `.out` is a **real Mplus 8.3 run** of it (all converged,
full SE + fit). Drop any `.out` into the app's **Results** step for APA tables, prose, and path diagrams.

| File | Model | Note |
|------|-------|------|
| `1_CFA.out` | 3-factor CFA | independent-clusters |
| `2_ESEM_geomin.out` | 3-factor ESEM, Geomin (.5) | carries a **SVALUES** block → ESEM-within-CFA |
| `3_ESEM_target.out` | 3-factor ESEM, Target | carries a SVALUES block |
| `4_Bifactor_CFA.out` | Bifactor-CFA (G + 3 S) | orthogonal general + specific factors |
| `5_Bifactor_ESEM.out` | Bifactor-ESEM (G + 3 S), BI-GEOMIN | carries a SVALUES block |
| `inv_1_configural.out … inv_6_latentmean.out` | Measurement invariance across `gender` | configural → metric → scalar → strict → var/cov → latent means |

## Try it (in the app)

1. Open the app → **"Skip to reading .out files →"**.
2. Drop `1_CFA.out` + `2_ESEM_geomin.out` + `5_Bifactor_ESEM.out` together → one fit-comparison table plus
   standardized loadings and diagrams for each; the ESEM card also offers an **ESEM-within-CFA** conversion.
3. Drop all six `inv_*.out` together → an invariance table with Satorra–Bentler Δχ², ΔCFI / ΔRMSEA verdicts.
4. To build syntax from scratch: **Data** → `data.dat` → **Model** (3 factors, i1–i5 → F1, i6–i10 → F2, i11–i15 → F3).

A guided walkthrough of all of this is at [`/demo.html`](../demo.html).
