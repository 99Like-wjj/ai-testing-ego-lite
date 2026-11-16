import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Window } from 'happy-dom';
import { performanceFixture } from './report-performance-fixture.mjs';
import { htmlReport, htmlReportPayload } from '../src/report/render.mjs';
import { report, verifyReport } from '../src/report/delivery.mjs';
import type { HtmlPayload } from '../src/contracts/model.mjs';
import { SOURCE_ROOT } from '../src/scripts/toolchain.mjs';

async function fixture(t:TestContext,steps=100){
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'ego-report-performance-'));
  t.after(async()=>{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('ego-report-performance-'));await fs.rm(parent,{recursive:true,force:true});});
  return performanceFixture(path.join(parent,'fixture'),steps);
}
async function reader(t:TestContext,payload:HtmlPayload,hash='#view=scene&case=perf&goal=read',transform?:(html:string)=>string){
  // Only locally built reader code and synthetic data execute here; never feed external HTML.
  const window=new Window({url:'file:///synthetic/report.html'+hash,settings:{enableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,suppressInsecureJavaScriptEnvironmentWarning:true}});
  t.after(()=>window.happyDOM.close());
  const generated=htmlReport(payload),html=transform?transform(generated):generated,start=html.lastIndexOf('<script>'),end=html.lastIndexOf('</script>');assert.ok(start>0&&end>start);
  window.document.write(html.slice(0,start)+'</body></html>');
  window.eval(`globalThis.reportParses=0;globalThis.imageBlobs=[];const parse=JSON.parse;JSON.parse=function(value,...args){if(typeof value==='string'&&value.includes('"htmlPayloadVersion"'))globalThis.reportParses++;return parse.call(this,value,...args);};URL.createObjectURL=blob=>{globalThis.imageBlobs.push(blob);return 'blob:synthetic-'+globalThis.imageBlobs.length;};URL.revokeObjectURL=()=>{};`);
  window.eval(html.slice(start+8,end));
  await window.happyDOM.waitUntilComplete();
  if(!transform)assert.ok(window.document.querySelector('.goal-workbench'),window.happyDOM.virtualConsolePrinter.readAsString());
  return {window,document:window.document,parses:()=>window.eval('reportParses') as number};
}

test('the shipped reader parses main data once for default Chinese, explicit Chinese and English at 10 and 100 steps',async t=>{
  const en=JSON.parse(await fs.readFile(path.join(SOURCE_ROOT,'examples/presentation-en.json'),'utf8')) as NonNullable<HtmlPayload['report']['presentation']>;
  for(const size of [10,100]){
    const f=await fixture(t,size);
    for(const presentation of [undefined,{language:'zh-CN',messages:{}},en]){
      const data=structuredClone(f.report);if(presentation)data.presentation=presentation;
      const payload=await htmlReportPayload(f.runDir,data),before=JSON.stringify(payload),r=await reader(t,payload);
      assert.equal(r.parses(),1);
      for(const i of [1,Math.floor(size/2),size-1])r.document.querySelectorAll<import('happy-dom').HTMLButtonElement>('[data-step-key]')[i]!.click();
      assert.equal(r.parses(),1);
      assert.equal(r.document.querySelector('.actual-step[aria-current="step"]')?.getAttribute('data-step-key'),'observed/step-'+(size-1));
      assert.ok(r.document.querySelector('.step-proof-header')?.textContent.includes('合成操作 '+size));
      assert.equal(JSON.stringify(payload),before,'Reading must not mutate records or verdicts.');
      assert.equal(r.document.documentElement.lang,presentation?.language??'zh-CN');
    }
  }
});

test('step and proof switching preserve unrelated DOM; original records render once on demand and restore after route changes',async t=>{
  const f=await fixture(t),payload=await htmlReportPayload(f.runDir,f.report),r=await reader(t,payload),d=r.document;
  const records=d.querySelector<import('happy-dom').HTMLDetailsElement>('.goal-records')!,nav=d.querySelector('#case-list'),overview=d.querySelector('.goal-overview'),steps=d.querySelector('.actual-step-list'),panel=d.querySelector('.step-proof-panel');
  assert.equal(records.children.length,1);assert.equal(records.querySelectorAll('img').length,0);
  assert.equal(d.querySelectorAll('#detail img').length,1);
  records.open=true;records.dispatchEvent(new r.window.Event('toggle'));
  assert.equal(records.dataset.lazyLoaded,'true');assert.ok(records.textContent.includes('Synthetic input 99'));
  const first=records.querySelector('.goal-judgment');assert.ok(first);
  records.open=false;records.dispatchEvent(new r.window.Event('toggle'));records.open=true;records.dispatchEvent(new r.window.Event('toggle'));
  assert.equal(records.querySelector('.goal-judgment'),first);
  const history=records.querySelector<import('happy-dom').HTMLDetailsElement>('[data-history-operation] details[data-lazy-section]')!;
  assert.equal(history.children.length,1);history.open=true;history.dispatchEvent(new r.window.Event('toggle'));assert.ok(history.textContent.includes('Synthetic input 99'));
  steps!.scrollTop=123;
  d.querySelectorAll<import('happy-dom').HTMLButtonElement>('[data-step-key]')[50]!.click();
  assert.equal(d.querySelector('#case-list'),nav);assert.equal(d.querySelector('.goal-overview'),overview);assert.equal(d.querySelector('.actual-step-list'),steps);assert.equal(d.querySelector('.step-proof-panel'),panel);assert.equal(steps!.scrollTop,123);
  assert.equal(d.querySelector('.goal-records'),records);assert.equal(records.querySelector('.goal-judgment'),first);assert.equal(records.open,true);
  const header=d.querySelector('.step-proof-header'),input=d.querySelector('.step-conversation-summary'),stage=d.querySelector('.proof-stage');
  const inputDetails=d.querySelector<import('happy-dom').HTMLDetailsElement>('[aria-label="本步输入与回复"] details')!;
  inputDetails.open=true;inputDetails.dispatchEvent(new r.window.Event('toggle'));
  d.querySelectorAll<import('happy-dom').HTMLButtonElement>('[data-proof-id]')[1]!.click();
  assert.equal(d.querySelector('.step-proof-header'),header);assert.equal(d.querySelector('.step-conversation-summary'),input);assert.equal(d.querySelector('.proof-stage'),stage);
  assert.equal(d.querySelector('[data-proof-id][aria-selected="true"]')?.getAttribute('data-proof-id'),f.evidenceIds[1]);
  assert.equal(d.querySelector('.proof-stage [data-evidence-card]')?.getAttribute('data-evidence-card'),f.evidenceIds[1]);
  assert.equal(r.parses(),1);assert.ok(r.window.eval('imageBlobs.length')<=3);
  // A full filter render must materialize restored open disclosures, including nested history.
  const filter=d.querySelector<import('happy-dom').HTMLSelectElement>('#status-filter')!;filter.value='inconclusive';filter.dispatchEvent(new r.window.Event('change'));
  const restored=d.querySelector<import('happy-dom').HTMLDetailsElement>('.goal-records')!;
  assert.equal(restored.open,true);assert.equal(restored.dataset.lazyLoaded,'true');assert.ok(restored.textContent.includes('Synthetic input 99'));
  assert.equal(restored.querySelector<import('happy-dom').HTMLDetailsElement>('[data-history-operation] details[data-lazy-section]')?.open,true);
  assert.equal(d.querySelector<import('happy-dom').HTMLDetailsElement>('[aria-label="本步输入与回复"] details')?.open,true);
});

test('invalid embedded JSON is parsed once and remains an explicit reader error',async t=>{
  const f=await fixture(t,10),payload=await htmlReportPayload(f.runDir,f.report);
  const r=await reader(t,payload,undefined,html=>html.replace(/(<script id="report-data"[^>]*>)[\s\S]*?(<\/script>)/,'$1{"htmlPayloadVersion":9,invalid}$2'));
  assert.equal(r.parses(),1);assert.ok(r.document.querySelector('#detail .error'));assert.equal(r.document.querySelector('.goal-workbench'),null);
});

test('bundle images use safe relative attachments, inline bytes stay portable, and attachment verification catches tampering',async t=>{
  const f=await fixture(t,10),inline=await htmlReportPayload(f.runDir,f.report),bundle=await htmlReportPayload(f.runDir,f.report,{mode:'bundle'});
  assert.equal(inline.delivery.complete,true);assert.equal(bundle.delivery.complete,true);
  for(const a of Object.values(bundle.assets)){assert.equal(a.data,undefined);assert.match(a.attachmentPath!,/^attachments\/[a-f0-9]{64}\.png$/);}
  assert.ok(Object.values(inline.assets).every(a=>a.data?.startsWith('data:image/png;base64,')));
  assert.ok(Buffer.byteLength(htmlReport(bundle))<Buffer.byteLength(htmlReport(inline)));
  const r=await reader(t,bundle),img=r.document.querySelector('.proof-stage img')!;assert.match(img.getAttribute('src')!,/^attachments\//);assert.equal(r.window.eval('imageBlobs.length'),0);
  const bad=structuredClone(bundle);for(const a of Object.values(bad.assets))a.attachmentPath='https://example.com/tracker.png';
  const rejected=await reader(t,bad);assert.equal(rejected.document.querySelectorAll('.proof-stage img').length,0);
  const dir=path.join(f.root,'bundle');await fs.mkdir(dir);await report(f.runDir,{outputDir:dir,deliveryMode:'bundle'});
  assert.equal((await verifyReport(f.runDir,dir)).filesVerified,true);
  const name=Object.values(bundle.assets)[0]!.attachmentPath!;await fs.appendFile(path.join(dir,name),'tampered');
  await assert.rejects(verifyReport(f.runDir,dir),/attachment hash/);
});
