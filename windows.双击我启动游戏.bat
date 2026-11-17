@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM 切换到脚本所在目录
cd /d "%~dp0"

REM 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo 需要 Node.js 20 或更新版本。安装后再打开此文件。
  pause
  exit /b 1
)

REM 获取本机局域网 IPv4 地址（跳过 127.0.0.1 和 169.254 开头）
set "LAN_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R /C:"IPv4.*:"') do (
  set "IP=%%A"
  setlocal EnableDelayedExpansion
  set "IP=!IP: =!"
  if not "!IP:~0,7!"=="127.0.0" if not "!IP:~0,7!"=="169.254" (
    if not defined LAN_IP endlocal & set "LAN_IP=!IP!" & goto :got_ip
  )
  endlocal
)
:got_ip

REM 检查本地 4173 端口是否已在运行
curl --noproxy "*" -fsS http://127.0.0.1:4173/ >nul 2>&1
if not errorlevel 1 (
  echo 本地服务已经运行：http://localhost:4173/
  if defined LAN_IP (
    curl --noproxy "*" -fsS "http://%LAN_IP%:4173/" >nul 2>&1
    if not errorlevel 1 (
      echo 局域网地址：http://%LAN_IP%:4173/
    ) else (
      echo 当前服务仅支持本机访问；如需局域网访问，请先停止游戏后重新启动。
    )
  )
  start "" http://localhost:4173/
  exit /b 0
)

echo 游戏地址：http://localhost:4173/
if defined LAN_IP echo 局域网地址：http://%LAN_IP%:4173/
echo 请保留本窗口；按 Ctrl+C 可关闭服务。

REM 延迟 1 秒后打开浏览器
start "" cmd /c "timeout /t 1 >nul & start "" http://localhost:4173/"

REM 启动服务（设置局域网主机环境变量）
set "LAN_HOST=%LAN_IP%"
node server.mjs

pause