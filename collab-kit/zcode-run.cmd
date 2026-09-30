@echo off
rem 单令牌启动器（供钩子/计划任务调用；命令串内不得含空格时用本文件，内部路径可带空格）
rem 本工具已迁至 dsh-plugins/collab-kit，路径相对自身解析（%~dp0），不依赖宿主项目位置。
rem 用法：zcode-run.cmd --project "F:\path\to\project" --task collab/tasks/xxx.md --tag T1 --mode yolo
rem 项目根也可用 env ZCODE_PROJECT_DIR 指定；两者都没有时用当前工作目录。
node "%~dp0zcode-run.mjs" %*
exit /b %ERRORLEVEL%