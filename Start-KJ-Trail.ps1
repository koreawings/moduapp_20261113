param(
  [ValidateSet('start','dev','verify','turnkey','grant-admin')][string]$Mode='start',
  [string]$Username
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$kjNodeCommand=Get-Command node -ErrorAction SilentlyContinue
if ($kjNodeCommand) { $kjNode=$kjNodeCommand.Source } else {
  $kjNode=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (!(Test-Path -LiteralPath $kjNode)) { throw 'Node.js 24 이상을 설치한 후 다시 실행하세요.' }
$env:PATH=(Split-Path -Parent $kjNode)+';'+$env:PATH
if (!(Test-Path -LiteralPath 'node_modules/typescript/bin/tsc') -or !(Test-Path -LiteralPath 'node_modules/pg/package.json')) {
  $kjPnpm=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs'
  if (Test-Path -LiteralPath $kjPnpm) { & $kjNode $kjPnpm install --frozen-lockfile }
  else { npm.cmd install }
  if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패. 오류를 확인하세요.' }
}
if ($Mode -eq 'grant-admin') {
  if ($Username -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$') { throw '-Username에 등록한 사용자명을 입력하세요.' }
  & $kjNode 'server/cli.mjs' 'grant-admin' $Username
  exit $LASTEXITCODE
}
switch ($Mode) {
 'verify' { & $kjNode 'scripts/verify.mjs' }
 'turnkey' { & $kjNode 'scripts/turnkey.mjs' '--resume' }
 'dev' { & $kjNode 'scripts/dev.mjs' }
 'start' {
   if (!(Test-Path -LiteralPath 'dist/index.html')) {
     & $kjNode 'scripts/verify.mjs'
     if ($LASTEXITCODE -ne 0) { throw '검증 실패로 실행을 중단했습니다.' }
   }
   & $kjNode 'server/index.mjs'
 }
}
exit $LASTEXITCODE
