import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const steps=[['typecheck',['node_modules/typescript/bin/tsc','-b']],['test',['--test',...readdirSync(new URL('../tests/',import.meta.url)).filter(x=>x.endsWith('.test.mjs')).map(x=>`tests/${x}`)]],['postgres',['--test','server/postgres.test.mjs']],['build',['node_modules/vite/bin/vite.js','build','--configLoader','native']]];
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
const results=[];
for(const [name,args] of steps){
 console.log(`\n[KJ Trail] ${name}`);
 const startedAt=new Date().toISOString();
 const run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
 const output=(run.stdout??'')+(run.stderr??'')+(run.error?run.error.message:'');
 process.stdout.write(output);
 writeFileSync(new URL(`../reports/${name}.log`,import.meta.url),output);
 results.push({name,command:[process.execPath,...args],startedAt,finishedAt:new Date().toISOString(),exitCode:run.status,status:run.status===0?'passed':'failed'});
 writeFileSync(new URL('../reports/verification.json',import.meta.url),JSON.stringify({node:process.version,results},null,2));
 if(run.status!==0){process.exitCode=1;break;}
}
