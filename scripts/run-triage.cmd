@echo off
REM Local scheduled runner — more reliable than GitHub Actions cron.
cd /d "C:\Users\JDonovan151\email-parser"
echo ===== %date% %time% =====>> "C:\Users\JDonovan151\email-parser\triage-scheduler.log"
"C:\Program Files\nodejs\node.exe" "C:\Users\JDonovan151\email-parser\index.js" >> "C:\Users\JDonovan151\email-parser\triage-scheduler.log" 2>&1
echo EXITCODE=%ERRORLEVEL%>> "C:\Users\JDonovan151\email-parser\triage-scheduler.log"
