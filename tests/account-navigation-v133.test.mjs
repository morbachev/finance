import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles/style.css',import.meta.url),'utf8');
const main=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
const assets=await readFile(new URL('../src/ui/assets-settings.ts',import.meta.url),'utf8');
const viewStart=html.indexOf('<div id="assets-page"');
const settingsStart=html.indexOf('<div id="settings-view"');
const sidebarEnd=html.indexOf('</aside>');
test('account management and recurring payments reside in their own route, not application settings',()=>{
  assert.ok(viewStart > 0 && settingsStart > viewStart);
  for(const id of ['assets-balances-form','assets-nisa-link-form','assets-recurring-form','assets-recurring-list']){
    const at=html.indexOf(`id="${id}"`);
    assert.ok(at > viewStart && at < settingsStart,id);
    assert.equal(html.split(`id="${id}"`).length-1,1);
  }
  assert.ok(html.indexOf('id="cloud-view"') > settingsStart);
  assert.ok(!html.slice(settingsStart).includes('id="assets-balances-form"'));
  assert.match(main,/\$\('assets-page'\)\.classList\.toggle\('hidden', view !== 'assets'\)/);
  assert.match(main,/\$\('nav-assets'\)\.addEventListener/);
  assert.match(assets,/\$\('assets-page'\)\.classList\.contains\('hidden'\)/);
});
test('appearance control is located at the bottom of sidebar, not settings',()=>{
  const theme=html.indexOf('id="theme-mode"'), footer=html.indexOf('class="sidebar-footer"');
  assert.ok(theme>footer && theme<sidebarEnd);
  assert.equal(html.split('id="theme-mode"').length-1,1);
  assert.doesNotMatch(html.slice(settingsStart),/id="theme-mode"/);
  for(const value of ['system','light','dark'])assert.match(html.slice(footer,sidebarEnd),new RegExp(`<option value="${value}"`));
});
test('expanding one history cannot stretch adjacent account cards',()=>{
  assert.match(css,/\.assets-account-layout\{align-items:start\}/);
  assert.match(css,/\.assets-account-layout \.assets-account-grid\{height:auto;align-items:start\}/);
  assert.match(css,/\.assets-account-layout \.assets-account-card\{height:auto;align-self:start\}/);
});
test('dialogs remain outside both hidden views',()=>{
  for(const id of ['categories-dialog','recent-merchants-dialog']){
    const at=html.indexOf(`id="${id}"`);
    assert.ok(at<viewStart && at>0,id);
  }
});
