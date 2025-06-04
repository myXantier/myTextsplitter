#!/bin/bash

clear

if [[ $# -eq 1 && "$1" =~ ^-[cC] ]]; then
    npm run clean
    sleep 1
    echo Projekt wurde bereinigt.
    sleep 1
    exit
fi

[[ ! -d dist/ ]] && mkdir dist

if [[ $(find dist/. -type f | wc -l) < 1 || $(find $(pwd) -name "package.json" -type f | wc -l) < 100 ]];then
    sleep 1
    npm install
    sleep 1
fi

clear
npm install && npm run build && npm run tauri dev
sleep 1
echo Bis dann ...

exit
