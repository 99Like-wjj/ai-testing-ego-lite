/** Synthetic report workload only. No business service, account or network. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { syntheticCase, syntheticCases, startSyntheticRun } from './synthetic-cases.mjs';
import { init } from '../src/core/cases.mjs';
import { check, registerEvidence, recordResult } from '../src/core/records.mjs';

export async function performanceFixture(root: string, steps = 100) {
  await fs.mkdir(root);
  const projectDir = path.join(root, 'project'), runDir = path.join(root, 'run');
  await init(projectDir);
  const c = syntheticCase({id:'perf',title:'合成报告性能场景',criticalConditions:[],requiredPath:null,stepOrder:'adaptive',steps:[{id:'inspect',action:'读取合成结果'}],goals:[{id:'read',title:'合成显示检查',basis:{kind:'explicit',source:'Synthetic engineering workload',text:'合成场景，仅验证报告阅读性能。'},expected:'保留全部事实与证据。',requiredRefs:['step:inspect']}]});
  const casesFile = path.join(projectDir, 'cases', 'v001.json');
  await fs.writeFile(casesFile, JSON.stringify(syntheticCases([c], '合成 HTML 报告性能检查')));
  await startSyntheticRun({projectDir,casesFile,outputDir:runDir});
  const evidenceIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const shapes = Array.from({length:200},(_,j)=>`<rect x="${(j*67)%1280}" y="${(j*31)%720}" width="150" height="24" fill="hsl(${(i*80+j*13)%360},60%,50%)"/>`).join('');
    const bytes = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/>${shapes}<text x="50" y="680" font-size="32">SYNTHETIC ONLY ${i}</text></svg>`).render().asPng();
    const sourceFile = path.join(root, `synthetic-${i}.png`); await fs.writeFile(sourceFile, bytes);
    const ev = await registerEvidence({runDir,request:{schemaVersion:9,operationId:'shot-'+i,expectedRevision:i,caseId:'perf',sourceFile,kind:'screenshot',source:'Synthetic fixture',description:'合成截图 '+i,metadata:{contentState:'full'}}});
    evidenceIds.push(ev.evidenceId);
  }
  await recordResult({runDir,request:{schemaVersion:9,operationId:'synthetic-result',expectedRevision:0,caseId:'perf',mode:'final',record:{observations:[{id:'observed',summary:'合成独立观察',actual:'合成结果留存，不代表业务验收。',coveredRefs:['step:inspect'],evidenceIds,actions:Array.from({length:steps},(_,i)=>({id:'step-'+i,description:'合成操作 '+(i+1),input:'Synthetic input '+i,result:'Synthetic readback '+i,planRefs:['step:inspect'],evidenceIds}))}],assessments:[{goalId:'read',status:'inconclusive',rationale:'此数据仅验证阅读器；不构成业务结论。',observationIds:['observed'],gaps:['没有访问真实系统。']}]}}});
  return { root, runDir, report: await check(runDir), evidenceIds };
}
