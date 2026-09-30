@echo off
rem Trae SessionStart 钩子入口（已停用，保留为历史资产）。项目根用 --project 或 env ZCODE_PROJECT_DIR。
node "%~dp0trae-session-inject.mjs" %*
exit /b %ERRORLEVEL%