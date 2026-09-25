@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua co Node.js. Cai ban LTS tai nodejs.org roi bam lai file nay.
  pause
  exit /b 1
)
node server.mjs
echo Cau in da dung. POS quầy khong the in / mo ket tu dong khi cua so nay dong.
pause
