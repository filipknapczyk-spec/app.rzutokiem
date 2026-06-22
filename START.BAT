@echo off
title Serwer Panelu Dewelopera
echo Trwa uruchamianie serwera...
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo [BLAD] Nie udalo sie uruchomic serwera. 
    echo Upewnij sie, ze Node.js jest zainstalowany i jestes w folderze z plikiem server.js.
    pause
)
pause