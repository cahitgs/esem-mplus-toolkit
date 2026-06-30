# Example dataset — `data.dat`

A **fully synthetic** dataset generated for testing the toolkit. No real participants.

- **500 rows × 25 columns**, space-delimited, no header, dot decimals (Mplus free format).
- Columns `M1 … M24` = 24 items; `GRP` = a 2-level grouping variable (`1` / `2`).
- **Structure:** a true bifactor population model — one general factor (G) plus **4 specific
  factors of 6 items each** (M1–M6 → F1, M7–M12 → F2, M13–M18 → F3, M19–M24 → F4), λ_G ≈ .30,
  λ_S ≈ .67. So it fits a 4-factor CFA/ESEM well and a bifactor-ESEM even better.

## Ready-made Mplus inputs and outputs

Every `.inp` was produced by the toolkit; every `.out` is a **real Mplus 8.3 run** of it (all
converged, full SE + fit). Drop any `.out` into the app's **Results** step to see APA tables,
prose, and path diagrams.

| File | Model | Note |
|------|-------|------|
| `1_CFA.out` | 4-factor CFA | independent-clusters |
| `2_ESEM_geomin.out` | 4-factor ESEM, Geomin (.5) | carries a **SVALUES** block → ESEM-within-CFA |
| `3_ESEM_target.out` | 4-factor ESEM, Target | carries a SVALUES block |
| `4_Bifactor_ESEM.out` | Bifactor-ESEM (G + 4 S), BI-GEOMIN | carries a SVALUES block |
| `inv_1_configural.out … inv_6_latentmean.out` | Measurement invariance across `GRP` | configural → metric → scalar → strict → var/cov → latent means |

## Try it

1. Open the app → **"Skip to reading .out files →"**.
2. Drop `2_ESEM_geomin.out` → fit row, standardized loadings, diagram, and an
   **ESEM-within-CFA** card (because that `.out` carries a SVALUES block).
3. Drop all `inv_*.out` together → an invariance table with ΔCFI / ΔRMSEA verdicts.
4. To build syntax from scratch: **Data** → `data.dat` → **Model** (4 factors, M1–M6→F1 … M19–M24→F4).
