/** Developer-only synthetic HTML workload. Never contacts a business system or ships in the Skill. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { performanceFixture } from '../tests/report-performance-fixture.mjs';
import { report } from '../src/report/delivery.mjs';
import { safePath } from '../src/core/common.mjs';
import { SOURCE_ROOT } from '../src/scripts/toolchain.mjs';
const args=process.argv.slice(2);
if(args.length!==2&&args.length!==4||args[0]!=='--output'||!args[1]||args.length===4&&args[2]!=='--steps')throw Error('Use --output ABS_NEW_EXTERNAL_DIR [--steps 100].');
const steps=args[3]===undefined?100:Number(args[3]);if(!Number.isSafeInteger(steps)||steps<1||steps>1000)throw Error('Steps must be an integer from 1 to 1000.');
const root=await safePath(args[1],{external:true}),fixture=await performanceFixture(root,steps);
await fs.writeFile(path.join(root,'zh.json'),JSON.stringify({language:'zh-CN',messages:{}}));
const files=[];
for(const mode of ['inline','bundle'] as const)for(const language of ['default','zh','en'] as const){
  const outputDir=path.join(root,mode+'-'+language);await fs.mkdir(outputDir);
  const presentationFile=language==='zh'?path.join(root,'zh.json'):language==='en'?path.join(SOURCE_ROOT,'examples/presentation-en.json'):undefined;
  const out=await report(fixture.runDir,{outputDir,deliveryMode:mode,presentationFile});
  files.push({mode,language,html:out.reportHtml,bytes:(await fs.stat(out.reportHtml)).size});
}
process.stdout.write(JSON.stringify({synthetic:true,steps,runDir:fixture.runDir,files},null,2)+'\n');
