@echo off
rem 无头拉起 worker 的单令牌入口（供 schtasks /TR 使用；路径含空格安全）。
rem 本工具已迁至 zcode-dispatch/collab-kit，路径相对自身解析（%~dp0）。
rem 项目根用 --project 或 env ZCODE_PROJECT_DIR 指定。
node "%~dp0headless-wake.mjs" %*
exit /b %ERRORLEVEL%