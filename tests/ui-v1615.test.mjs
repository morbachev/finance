import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html'),asset=read('src/ui/assets-settings.ts'),future=read('src/ui/future-projection.ts'),css=read('public/styles/ui-v1615.css');
test('birth month is editable only in NISA settings and reuses the established cloud save',()=>{
  assert.match(html,/id="settings-nisa-panel"/);assert.match(html,/id="assets-birth-form"/);
  assert.doesNotMatch(html,/id="future-born"/);assert.match(asset,/await requireVault\(\)\.setBirthMonth\(month\)/);
  assert.match(asset,/birthDirty/);assert.match(future,/source.assets.birthMonth/);
});
test('NISA forecast baseline is calculated from statements or recurring schedule, no manual input',()=>{
  assert.doesNotMatch(html,/future-nisa-monthly/);assert.match(future,/hasNisaSchedule\?monthlyEquivalent\(nisaRules\):suggested.amount/);
  assert.match(future,/nisaMonthly:hasNisaSchedule\?0:suggested.amount/);
  assert.match(html,/id="future-scenario-nisa"/);
});
test('all HTML placeholders avoid redundant example prefix and lighter palette applies to text fields',()=>{
  assert.doesNotMatch(html,/placeholder="例：/);
  assert.match(css,/input::placeholder,textarea::placeholder/);
  assert.match(css,/\[data-theme="dark"\]/);
});
test('mobile summary arrow control matches statement manager touch dimensions',()=>{
  assert.match(css,/#monthly-next\{width:35px;min-width:35px;height:37px;min-height:37px/);
});
