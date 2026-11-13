@echo off
setlocal
cd /d "%~dp0"
set "KJ_NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%KJ_NODE_EXE%" set "KJ_NODE_EXE=node"
"%KJ_NODE_EXE%" --input-type=module -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required. See README.md.
  pause
  exit /b 1
)
if not exist "node_modules\pg\package.json" (
  echo Server dependencies are missing. Run npm install in this folder, then start again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  if not exist "node_modules\typescript\bin\tsc" (
    echo Dependencies are missing. Install Node.js 24, then run npm install here.
    pause
    exit /b 1
  )
  "%KJ_NODE_EXE%" scripts/verify.mjs
  if errorlevel 1 (
    echo Verification failed. See reports for details.
    pause
    exit /b 1
  )
)
echo Open http://127.0.0.1:8787 in your browser. Press Ctrl+C to stop.
"%KJ_NODE_EXE%" server/index.mjs
if errorlevel 1 pause
endlocal
