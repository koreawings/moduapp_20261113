import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const reviewRoot=resolve('work');
const fixture=mkdtempSync(join(reviewRoot,'turnkey-review-'));
function put(path,content){const full=join(fixture,path);mkdirSync(resolve(full,'..'),{recursive:true});writeFileSync(full,content);}
put('package.json',JSON.stringify({name:'turnkey-review-only',type:'module'}));
put('scripts/turnkey.mjs',readFileSync('outputs/kj-trail/scripts/turnkey.mjs'));
put('pnpm-workspace.yaml','onlyBuiltDependencies:\n  - esbuild\n');
put('src/test.ts','export const value=1;\n');
put('tests/example.test.mjs',"import {test} from 'node:test'; import assert from 'node:assert/strict'; test('fixture process actually runs',()=>assert.equal(1+1,2));\n");
for(const name of ['typescript','vite','react','react-dom','lucide-react']) put(`node_modules/${name}/package.json`,JSON.stringify({name,version:'fixture',type:'commonjs'}));
put('node_modules/typescript/bin/tsc',`const fs=require('node:fs');if(fs.existsSync('reports/fail-typecheck')){console.error('expected isolated failure');process.exit(7)}if(fs.existsSync('reports/mutate-source')){fs.appendFileSync('src/test.ts','\\n');fs.unlinkSync('reports/mutate-source')}console.log('isolated typecheck fixture');`);
put('node_modules/vite/bin/vite.js',"console.log('isolated build fixture');\n");
const ledger=()=>JSON.parse(readFileSync(join(fixture,'reports/turnkey/ledger.json'),'utf8'));
const latest=()=>ledger().runs.at(-1);
const evidence=[];
function run(args,expected){const result=spawnSync(process.execPath,['scripts/turnkey.mjs',...args],{cwd:fixture,encoding:'utf8',maxBuffer:5e6});assert.equal(result.status,expected,result.stderr+result.stdout);evidence.push({args,exitCode:result.status});return result;}

run(['--help'],0);assert(!existsSync(join(fixture,'reports')));
run(['--not-a-command'],2);
run(['--next'],0);assert.equal(latest().steps[0].status,'PASS');assert.equal(latest().automaticChecksPassed,false);
const originalId=latest().id;
put('reports/fail-typecheck','1');
run(['--resume'],1);assert.equal(latest().steps[2].status,'FAIL');assert.equal(latest().steps[2].exitCode,7);assert.equal(latest().steps[3].status,'PENDING');
assert(readFileSync(join(fixture,latest().steps[2].evidence),'utf8').includes('expected isolated failure'));
unlinkSync(join(fixture,'reports/fail-typecheck'));
run(['--resume'],0);assert.equal(latest().id,originalId);assert(latest().automaticChecksPassed);assert.equal(latest().steps[2].attempts.length,2);assert(latest().externalGates.filter(x=>x.id==='P11'||x.id==='P12').every(x=>x.status==='BLOCKED_NO_EVIDENCE'));
put('pnpm-workspace.yaml','onlyBuiltDependencies: []\n');
assert.match(run(['status'],0).stdout,/변경됨/);
run(['--resume'],0);assert.notEqual(latest().id,originalId);assert(latest().input.files.includes('pnpm-workspace.yaml'));
const beforeInstalled=latest().id;
put('node_modules/react/package.json',JSON.stringify({name:'react',version:'fixture2',type:'commonjs'}));
run(['--resume'],0);assert.notEqual(latest().id,beforeInstalled);
const beforeLauncher=latest().id;
put('Start-KJ-Trail.ps1','# isolated launcher fingerprint probe');
put('Start-KJ-Trail.cmd','@echo off\r\nrem isolated launcher fingerprint probe\r\n');
run(['--resume'],0);assert.notEqual(latest().id,beforeLauncher);assert(latest().input.files.includes('Start-KJ-Trail.cmd'));
const prior=latest().id;
put('public/probe.txt','public fixture');
run(['--next'],0);assert.notEqual(latest().id,prior);assert.equal(latest().steps[1].status,'PENDING');
put('reports/mutate-source','1');
run(['--resume'],1);assert(latest().stale);assert.equal(latest().steps[3].status,'PENDING');
run(['--resume'],0);assert(latest().automaticChecksPassed);

// Simulate a process that died after persisting RUNNING. This is an isolated
// ledger fixture; no app evidence is edited or fabricated.
const interrupted=ledger();const interruptedStep=interrupted.runs.at(-1).steps[3];interruptedStep.status='RUNNING';interruptedStep.attempts.at(-1).status='RUNNING';
writeFileSync(join(fixture,'reports/turnkey/ledger.json'),JSON.stringify(interrupted));
run(['--resume'],0);assert.equal(latest().steps[3].attempts.at(-2).status,'BLOCKED');assert.equal(latest().steps[3].attempts.at(-1).status,'PASS');

put('reports/turnkey/.lock/owner.json',JSON.stringify({pid:process.pid}));
run(['check'],1);assert(existsSync(join(fixture,'reports/turnkey/.lock/owner.json')));
unlinkSync(join(fixture,'reports/turnkey/.lock/owner.json'));rmdirSync(join(fixture,'reports/turnkey/.lock'));
const dead=spawnSync(process.execPath,['-e','process.exit(0)']);
put('reports/turnkey/.lock/owner.json',JSON.stringify({pid:dead.pid}));
run(['--resume'],1);assert(existsSync(join(fixture,'reports/turnkey/.lock/owner.json')));
unlinkSync(join(fixture,'reports/turnkey/.lock/owner.json'));rmdirSync(join(fixture,'reports/turnkey/.lock'));
unlinkSync(join(fixture,'tests/example.test.mjs'));
run(['check'],1);assert.equal(latest().steps[3].status,'BLOCKED');assert.equal(latest().steps[4].status,'PENDING');
const malformed='{ invalid fixture';writeFileSync(join(fixture,'reports/turnkey/ledger.json'),malformed);
run(['--resume'],1);assert.equal(readFileSync(join(fixture,'reports/turnkey/ledger.json'),'utf8'),malformed);

const report={kind:'isolated turnkey orchestration review; stub compiler/build, real child processes and Node test runner',fixture,checkedAt:new Date().toISOString(),node:process.version,checks:evidence};
writeFileSync(join(reviewRoot,'turnkey-review-evidence.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
