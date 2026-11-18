import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd();
const css=readFileSync(join(root,'public/styles/ui-v162.css'),'utf8');
const html=readFileSync(join(root,'public/index.html'),'utf8');

test('v1.6.2 rule spacing CSS is loaded exactly once after v1.6.1',()=>{
  assert.match(html,/ui-v161\.css[\s\S]*ui-v162\.css/);
  assert.equal((html.match(/ui-v162\.css/g)??[]).length,1);
});
test('rule form changes are scoped to narrow screens and leave desktop styles untouched',()=>{
  assert.match(css,/@media\s*\(max-width:\s*700px\)/);
  assert.match(css,/#rules-view\s+\.rules-form-panel/);
  assert.doesNotMatch(css,/#manage-view/);
  assert.doesNotMatch(css,/#import-view/);
});
test('fieldset is block-based and radio selection remains visible and accessible',()=>{
  assert.match(css,/\.rule-mode-fieldset\s*\{[^}]*display:\s*block\s*!important/s);
  assert.match(css,/\.rule-mode-fieldset\s*>\s*legend/);
  assert.match(css,/\.rule-mode-options\s*\{[^}]*display:\s*grid/s);
  for(const value of ['exact','prefix','contains']){
    assert.match(html,new RegExp(`name="rule-mode-choice" value="${value}"`));
  }
});
test('rule fields, add-another-merchant and category controls remain intact',()=>{
  for(const id of ['rule-pattern','rule-pattern-add','rule-card','rule-display-name','rule-category','rule-save']){
    assert.match(html,new RegExp(`id="${id}"`));
  }
});
