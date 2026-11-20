import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('public/index.html',root),'utf8');
const css=readFileSync(new URL('public/styles/layout-v196.css',root),'utf8');
const js=readFileSync(new URL('src/main.ts',root),'utf8');
test('sidebar supports desktop collapse, persistent accessibility labels, and distinct icons',()=>{
  assert.match(html,/id="sidebar-collapse-toggle"[^>]*aria-expanded="true"/);
  assert.match(js,/function setDesktopMenuCollapsed/);
  assert.match(css,/\.app-shell\.nav-collapsed/);
  assert.match(html,/id="sidebar-tooltip" class="sidebar-tooltip" role="tooltip"/);
  const ids=['home','import','manage','summary','analysis','subscriptions','reports','rules','assets','future','settings','payroll'];
  const icons=ids.map(id=>{
    const match=html.match(new RegExp(`id="nav-${id}"[^>]*>[\\s\\S]*?<span class="nav-symbol"[^>]*>([\\s\\S]*?)<\\/span>`));
    assert.ok(match,id);return match[1];
  });
  assert.equal(new Set(icons).size,icons.length);
  assert.match(css,/\.sidebar-subnav\{display:flex!important/);
});
test('only import page is switched to full-height document content scrolling',()=>{
  assert.match(css,/\.content:has\(#import-view:not\(\.hidden\)\)/);
  assert.match(css,/overflow-y:auto!important/);
  assert.doesNotMatch(css,/#manage-view:not\(\.hidden\).*?display:block!important/);
});
