import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidenceDir = join(root, 'reports', 'turnkey');
const ledgerPath = join(evidenceDir, 'ledger.json');
const lockDir = join(evidenceDir, '.lock');
const inputRoots = ['src', 'server', 'tests', 'scripts', 'public', 'db'];
const inputFiles = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json', 'vite.config.ts', 'index.html', 'API-CONTRACT.md', 'AGENTS.md', 'Start-KJ-Trail.ps1', 'Start-KJ-Trail.cmd', 'node_modules/.modules.yaml', ...['typescript', 'vite', 'react', 'react-dom', 'lucide-react'].map(name => `node_modules/${name}/package.json`)];
const args = process.argv.slice(2);
const command = (args[0] ?? 'help').replace(/^--/, '');
const allowed = ['help', 'check', 'next', 'resume', 'status'];

function help() {
  console.log(`KJ Trail 검증 실행기

사용법:
  npm run turnkey -- check       전체 검증을 새로 실행
  npm run turnkey -- --next      다음 미통과 검증 한 단계 실행
  npm run turnkey -- --resume    동일 입력의 미통과 단계부터 끝까지 재개
  npm run turnkey -- status      현재 입력과 최신 검증 상태 확인
  npm run turnkey -- --help      도움말

npm이 PATH에 없으면 Node 24 실행파일로 scripts/turnkey.mjs를 직접 실행할 수 있습니다.
예: node scripts/turnkey.mjs check

실행 순서: Node/SQLite → 의존성 → 타입 검사 → 실제 API 테스트 → 빌드
고정된 로컬 검증 명령만 실행합니다. 설치, 프롬프트/LLM 실행, 외부 게시,
권한 우회, 운영 데이터 변경, 공개 출시 판정은 수행하지 않습니다.
결과: reports/turnkey/ledger.json 및 단계별 전체 출력 로그
check 통과는 로컬 자동 검증의 통과이며 콘텐츠 승인·Figma 저장·실기기 QA·
운영 담당·공개 배포·실제 고객 피드백의 완료를 의미하지 않습니다.
단계 계약과 P00~P12 인계 순서: docs/turnkey.md`);
}

function sourceFiles() {
  const files = inputFiles.filter(file => existsSync(join(root, file)));
  function walk(folder) {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  for (const folder of inputRoots) walk(join(root, folder));
  return [...new Set(files)].sort();
}

function fingerprint() {
  const hash = createHash('sha256');
  const files = sourceFiles();
  for (const file of files) hash.update(file).update('\0').update(readFileSync(join(root, file))).update('\0');
  hash.update(`node:${process.versions.node};platform:${process.platform};arch:${process.arch}`);
  return { hash: hash.digest('hex'), files, node: process.versions.node, platform: process.platform, arch: process.arch };
}

function readLedger() {
  if (!existsSync(ledgerPath)) return { schemaVersion: 1, project: 'kj-trail', runs: [] };
  const result = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (result.schemaVersion !== 1 || !Array.isArray(result.runs)) throw new Error('지원하지 않거나 손상된 원장입니다. 원본을 보존한 뒤 확인하세요.');
  return result;
}

function writeLedger(ledger) {
  mkdirSync(evidenceDir, { recursive: true });
  ledger.updatedAt = new Date().toISOString();
  const temporaryPath = `${ledgerPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(ledger, null, 2) + '\n');
  renameSync(temporaryPath, ledgerPath);
}

function testFiles() {
  const folder = join(root, 'tests');
  return existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`) : [];
}

function definitions() {
  return [
    { id: 'runtime', title: 'Node 24+ 및 SQLite', args: ['--input-type=module', '-e', "if(Number(process.versions.node.split('.')[0])<24){console.error('Node 24+ required');process.exit(1)};const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');console.log(JSON.stringify({node:process.versions.node,sqlite:db.prepare('select sqlite_version() version').get().version}));db.close()"] },
    { id: 'dependencies', title: '검증 의존성', args: ['--input-type=module', '-e', "import {existsSync} from 'node:fs';const files=['node_modules/typescript/bin/tsc','node_modules/vite/bin/vite.js','node_modules/react/package.json','node_modules/react-dom/package.json'];const missing=files.filter(f=>!existsSync(f));if(missing.length){console.error('Missing dependencies: '+missing.join(', '));process.exit(1)}console.log('Required local packages are present')"] },
    { id: 'typecheck', title: 'TypeScript 검사', args: ['node_modules/typescript/bin/tsc', '-b'], needs: ['node_modules/typescript/bin/tsc'] },
    { id: 'api-tests', title: '격리 DB의 실제 API 테스트', args: ['--test', ...testFiles()], needsTests: true },
    { id: 'postgres-tests', title: '격리 PostgreSQL의 실제 API 테스트', args: ['--test', 'server/postgres.test.mjs'] },
    { id: 'build', title: 'Vite 빌드', args: ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'native'], needs: ['node_modules/vite/bin/vite.js'] },
  ];
}

function externalGates() {
  return [
    { id: 'public-release', status: 'NOT_VERIFIED', reason: '승인 콘텐츠·번역·자산 권리·운영 책임·호스팅·개인정보 정책·복구 증거는 자동 검증 대상 밖입니다.' },
    { id: 'P11', status: 'BLOCKED_NO_EVIDENCE', reason: '이 실행기는 실제 고객 관찰·운영 증거를 수집하거나 검증하지 않습니다. docs/feedback.md의 인계 자료가 필요합니다.' },
    { id: 'P12', status: 'BLOCKED_NO_EVIDENCE', reason: 'P11의 실제 문제·수요와 그 한계가 검토되어야 MVP2 범위를 판단할 수 있습니다.' },
  ];
}

function printStatus(run, current) {
  if (!run) { console.log('아직 실행 기록이 없습니다. check 또는 --next로 시작하세요.'); return; }
  const same = run.input.hash === current.hash && !run.stale;
  console.log(`실행: ${run.id}\n입력: ${same ? '현재 코드·계약·Node 환경과 일치' : '변경됨 — 이전 통과 결과를 현재 결과로 사용할 수 없음'}`);
  for (const step of run.steps) console.log(`${step.status.padEnd(10)} ${step.id} — ${step.title}${step.exitCode !== undefined ? ` (exit ${step.exitCode})` : ''}`);
  console.log(`자동 검증: ${same && run.steps.every(step => step.status === 'PASS') ? '통과' : '미완료'}\n공개 출시: 미검증\n원장: ${relative(root, ledgerPath)}`);
  for (const gate of run.externalGates) console.log(`${gate.id}: ${gate.status}`);
}

function acquireLock() {
  mkdirSync(evidenceDir, { recursive: true });
  if (existsSync(lockDir)) {
    const ownerPath = join(lockDir, 'owner.json');
    if (!existsSync(ownerPath)) throw new Error('다른 실행기의 잠금 생성 중이거나 잠금 정보가 불완전합니다. 중복 실행하지 마세요.');
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('잠금 정보를 확인할 수 없습니다. 원본을 보존하고 확인하세요.');
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error(`검증 실행기 PID ${owner.pid}가 실행 중입니다.`);
    // Never reclaim a dead owner's path automatically: two recovering processes
    // could delete each other's new lock between the PID check and deletion.
    throw new Error(`이전 실행기 PID ${owner.pid}의 잠금이 남았습니다. 실행기와 그 자식 프로세스가 모두 종료됐는지 확인한 뒤 docs/turnkey.md의 잠금 복구 절차를 따르세요. 원장과 로그는 보존합니다.`);
  }
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
}

function releaseLock() {
  const ownerPath = join(lockDir, 'owner.json');
  if (existsSync(ownerPath)) {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    if (owner.pid === process.pid) { unlinkSync(ownerPath); rmdirSync(lockDir); }
  }
}

async function executeStep(definition, step, run, ledger) {
  step.startedAt = new Date().toISOString();
  step.status = 'RUNNING';
  step.command = { executable: process.execPath, args: definition.args, cwd: root, shell: false };
  delete step.reason;
  delete step.exitCode;
  delete step.signal;
  const attempt = (step.attempts?.length ?? 0) + 1;
  const logFile = join(evidenceDir, `${run.id}-${definition.id}-${attempt}.log`);
  step.evidence = relative(root, logFile).replaceAll('\\', '/');
  writeFileSync(logFile, `Step: ${definition.id}\nStarted: ${step.startedAt}\nNode: ${process.execPath}\nArgs: ${JSON.stringify(definition.args)}\n\n`);
  step.attempts ??= [];
  const attemptRecord = { startedAt: step.startedAt, status: 'RUNNING', evidence: step.evidence };
  step.attempts.push(attemptRecord);
  const missing = (definition.needs ?? []).filter(file => !existsSync(join(root, file)));
  if (missing.length || (definition.needsTests && testFiles().length === 0)) {
    step.status = 'BLOCKED';
    step.reason = missing.length ? `의존성 파일 없음: ${missing.join(', ')}` : '실행할 API 테스트 파일이 없습니다.';
    step.finishedAt = new Date().toISOString();
    appendFileSync(logFile, step.reason + '\n실행하지 않았습니다.\n');
    Object.assign(attemptRecord, { finishedAt: step.finishedAt, status: step.status, reason: step.reason });
    writeLedger(ledger);
    return;
  }
  writeLedger(ledger);
  console.log(`\n[${definition.id}] ${definition.title}`);
  const result = await new Promise(resolveResult => {
    let interrupted = false;
    let timedOut = false;
    let spawnError;
    const child = spawn(process.execPath, definition.args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    function stop() {
      interrupted = true;
      if (child.pid && process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill('SIGTERM');
    }
    const timeout = setTimeout(() => { timedOut = true; stop(); }, 300_000);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.stdout.on('data', chunk => { appendFileSync(logFile, chunk); process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { appendFileSync(logFile, chunk); process.stderr.write(chunk); });
    child.on('error', error => { spawnError = error.message; appendFileSync(logFile, `\nSpawn error: ${error.message}\n`); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolveResult({ code, signal, interrupted, timedOut, spawnError });
    });
  });
  step.finishedAt = new Date().toISOString();
  step.exitCode = result.code;
  step.signal = result.signal;
  step.status = result.interrupted || result.spawnError ? 'BLOCKED' : result.code === 0 ? 'PASS' : 'FAIL';
  if (result.timedOut) step.reason = '검증 제한 시간 5분 초과';
  else if (result.interrupted) step.reason = '실행 중단';
  else if (result.spawnError) step.reason = result.spawnError;
  else if (result.code !== 0) step.reason = `프로세스 종료 코드 ${result.code}`;
  appendFileSync(logFile, `\nFinished: ${step.finishedAt}\nExit: ${result.code}\nSignal: ${result.signal ?? 'none'}\nStatus: ${step.status}\n`);
  Object.assign(attemptRecord, { finishedAt: step.finishedAt, status: step.status, exitCode: step.exitCode, signal: step.signal, reason: step.reason });
  if (fingerprint().hash !== run.input.hash) { run.stale = true; run.staleReason = '검증 중 소스·계약·실행 환경 입력이 변경됨'; }
  writeLedger(ledger);
}

async function main() {
  if (!allowed.includes(command) || args.length > 1) { help(); process.exitCode = 2; return; }
  if (command === 'help') { help(); return; }
  if (command === 'status') { const ledger = readLedger(); printStatus(ledger.runs.at(-1), fingerprint()); return; }
  acquireLock();
  try {
    const ledger = readLedger();
    const input = fingerprint();
    let run = ledger.runs.at(-1);
    if (command === 'check' || !run || run.input.hash !== input.hash || run.stale) {
      if (run && command !== 'check') console.log('입력이 바뀌어 이전 통과를 재사용하지 않고 새 검증을 시작합니다.');
      run = { id: new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex'), createdAt: new Date().toISOString(), input, steps: definitions().map(({ id, title }) => ({ id, title, status: 'PENDING' })), externalGates: externalGates() };
      ledger.runs.push(run);
    }
    for (const step of run.steps) if (step.status === 'RUNNING') {
      step.status = 'BLOCKED';
      step.reason = '이전 실행이 종료 결과를 기록하지 못했습니다.';
      step.finishedAt = new Date().toISOString();
      const previousAttempt = step.attempts?.at(-1);
      if (previousAttempt?.status === 'RUNNING') Object.assign(previousAttempt, { status: step.status, reason: step.reason, finishedAt: step.finishedAt });
    }
    writeLedger(ledger);
    for (const definition of definitions()) {
      const step = run.steps.find(item => item.id === definition.id);
      if (step.status === 'PASS') continue;
      await executeStep(definition, step, run, ledger);
      if (step.status !== 'PASS' || run.stale || command === 'next') break;
    }
    run.finishedAt = new Date().toISOString();
    run.automaticChecksPassed = !run.stale && run.steps.every(step => step.status === 'PASS');
    writeLedger(ledger);
    printStatus(run, fingerprint());
    if (run.stale || run.steps.some(step => ['FAIL', 'BLOCKED'].includes(step.status))) process.exitCode = 1;
  } finally { releaseLock(); }
}

main().catch(error => { console.error(`턴키 오류: ${error.message}`); process.exitCode = 1; });
