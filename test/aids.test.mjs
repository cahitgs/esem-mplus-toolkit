// aids.test.mjs — convergence aids (Morin, Hoyle ch. 27): CONVERGENCE line + residual positivity.
// Run: node test/aids.test.mjs
import { createModelSpec, setWaveItems, setFactorCount, validateSpec } from '../js/state.js';
import { buildInp, maxLineLength } from '../js/syntax-generator.js';

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

const T1 = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];
const T2 = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'];
function makeSpec() {
  const spec = createModelSpec({
    fileName: 'ESEM.dat', mplusFile: 'ESEM.dat',
    delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 4500,
    varNames: [...T1, ...T2, 'GV'], categorical: [], missingCode: null,
  });
  setFactorCount(spec, 2);
  return spec;
}
function makeGroupSpec() {
  const spec = makeSpec();
  spec.groups.enabled = true; spec.groups.variable = 'GV';
  spec.groups.codes = [{ code: '1', label: 'g1' }, { code: '2', label: 'g2' }];
  return spec;
}
function makeLongSpec() {
  const spec = makeSpec();
  spec.longitudinal.enabled = true;
  setWaveItems(spec, 0, T1);
  setWaveItems(spec, 1, T2);
  spec.modelTypes = { cfa: false, esem: false, bifactorCfa: false, bifactorEsem: true };
  return spec;
}

console.log('\n— defaults: no aids emitted —');
{
  const noKey = makeSpec();
  delete noKey.aids; // pre-aids spec shape must keep working
  const off = makeSpec(); // aids present, everything off (createModelSpec default)
  for (const [tag, s] of [['no aids key', noKey], ['aids off', off]]) {
    const inp = buildInp(s, 'cfa') + buildInp(s, 'esem') + buildInp(s, 'bifactorEsem');
    check(`${tag}: no CONVERGENCE and no (res`, !inp.includes('CONVERGENCE') && !inp.includes('(res'), null);
  }
}

console.log('\n— CONVERGENCE line —');
{
  const s = makeSpec(); s.aids.convergence = true;
  check('cfa has CONVERGENCE = .005;', buildInp(s, 'cfa').includes('CONVERGENCE = .005;'), null);
  check('esem has CONVERGENCE = .005;', buildInp(s, 'esem').includes('CONVERGENCE = .005;'), null);
  const g = makeGroupSpec(); g.aids.convergence = true;
  check('inv:metric has CONVERGENCE = .005;', buildInp(g, 'inv:metric').includes('CONVERGENCE = .005;'), null);
  const l = makeLongSpec(); l.aids.convergence = true;
  check('linv:besem:configural has CONVERGENCE = .005;', buildInp(l, 'linv:besem:configural').includes('CONVERGENCE = .005;'), null);
  s.aids.convergenceValue = 0.001;
  check('convergenceValue 0.001 → CONVERGENCE = .001;', buildInp(s, 'esem').includes('CONVERGENCE = .001;'), null);
}

console.log('\n— residual positivity constraints —');
{
  const s = makeSpec();
  s.rotation.type = 'TARGET';
  s.aids.positiveResiduals = ['X2'];
  const inp = buildInp(s, 'esem'); // → buildESEMTarget
  const at = (t) => inp.indexOf(t);
  check('target esem has "X2 (res1);"', inp.includes('X2 (res1);'), inp);
  check('target esem has MODEL CONSTRAINT + res1 > 0', inp.includes('MODEL CONSTRAINT:') && inp.includes('res1 > 0;'), null);
  check('labels/constraint appear before OUTPUT:', at('X2 (res1);') < at('OUTPUT:') && at('MODEL CONSTRAINT:') < at('OUTPUT:') && at('res1 > 0;') < at('OUTPUT:'), [at('X2 (res1);'), at('MODEL CONSTRAINT:'), at('res1 > 0;'), at('OUTPUT:')]);
  s.aids.positiveResiduals = ['X4', 'X2']; // selection order must NOT matter — spec.items order wins
  const two = buildInp(s, 'esem');
  check('two items → res1/res2 in spec.items order', two.includes('X2 (res1);') && two.includes('X4 (res2);'), null);
  check('cfa emits them too', buildInp(s, 'cfa').includes('X2 (res1);') && buildInp(s, 'cfa').includes('res2 > 0;'), null);
  check('bifactorEsem (target) emits them', buildInp(s, 'bifactorEsem').includes('X2 (res1);') && buildInp(s, 'bifactorEsem').includes('res1 > 0;'), null);
  s.rotation.type = 'GEOMIN';
  const bg = buildInp(s, 'bifactorEsem'); // BI-GEOMIN path
  check('bifactorEsem (BI-GEOMIN) emits them', bg.includes('X2 (res1);') && bg.includes('MODEL CONSTRAINT:'), null);
  s.aids.positiveResiduals = ['NOPE', 'X2'];
  const ign = buildInp(s, 'esem');
  check('item not in spec.items silently ignored', ign.includes('X2 (res1);') && !ign.includes('NOPE') && !ign.includes('res2'), null);
}

console.log('\n— categorical items are excluded (DELTA parameterization) —');
{
  // Mplus: "Variances for categorical outcomes can only be specified using PARAMETERIZATION=THETA"
  const s = makeSpec();
  s.data.categorical = ['X2'];
  s.aids.positiveResiduals = ['X2', 'X3'];
  const inp = buildInp(s, 'esem');
  check('categorical X2 skipped, X3 gets res1', !inp.includes('X2 (res') && inp.includes('X3 (res1);'), inp.match(/\w+ \(res\d\);/g));
  check('validateSpec warns about the skipped categorical item', validateSpec(s).warnings.some((w) => /categorical/i.test(w) && /residual/i.test(w)), validateSpec(s).warnings);
  s.aids.positiveResiduals = ['X2'];
  const only = buildInp(s, 'esem');
  check('only-categorical selection → no res label, no MODEL CONSTRAINT', !only.includes('(res') && !only.includes('MODEL CONSTRAINT'), null);
}

console.log('\n— invariance sequences never carry residual constraints —');
{
  const g = makeGroupSpec(); g.aids.positiveResiduals = ['X2']; g.aids.convergence = true;
  const gm = buildInp(g, 'inv:metric');
  check('inv:metric has no (res1) / MODEL CONSTRAINT', !gm.includes('(res1)') && !gm.includes('MODEL CONSTRAINT'), null);
  const l = makeLongSpec(); l.aids.positiveResiduals = ['X2']; l.aids.convergence = true;
  const ls = buildInp(l, 'linv:besem:scalar');
  check('linv:besem:scalar has no (res1) / MODEL CONSTRAINT', !ls.includes('(res1)') && !ls.includes('MODEL CONSTRAINT'), null);
  const s = makeSpec(); s.aids = { convergence: true, convergenceValue: 0.005, positiveResiduals: ['X1', 'X2', 'X3'] };
  const builds = [buildInp(s, 'cfa'), buildInp(s, 'esem'), buildInp(s, 'bifactorCfa'), buildInp(s, 'bifactorEsem'), gm, ls];
  check('every aids-on build ≤ 90 chars/line', builds.every((b) => maxLineLength(b) <= 90), builds.map(maxLineLength));
}

console.log(`\naids.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
