import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd();
const css=readFileSync(join(root,'public/styles/ui-v161.css'),'utf8');
const html=readFileSync(join(root,'public/index.html'),'utf8');

test('mobile statement rows receive compact, scoped spacing without desktop impact',()=>{
  assert.match(css,/@media\s*\(max-width:700px\)/);
  assert.match(css,/#manage-view\s+\.manage-editor\s+#manage-rows\s+td\s*\{/);
  assert.match(css,/padding:0!important/);
  assert.match(css,/grid-auto-rows:min-content!important/);
  assert.match(css,/#manage-view\s+\.manage-editor\s+\.manage-foot/);
  assert.doesNotMatch(css,/display:none/);
});

test('mobile compact CSS is included after previous layout rules',()=>{
  assert.match(html,/ui-v160\.css[\s\S]*ui-v161\.css/);
  assert.equal((html.match(/ui-v161\.css/g)??[]).length,1);
});
