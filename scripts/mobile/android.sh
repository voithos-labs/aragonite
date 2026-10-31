#!/usr/bin/env bash
# Runs inside the booted emulator's step: records what the image ships (keyboard, Chrome), opens
# the harness in Chrome with its first-run screens off, then runs the rows.
# Usage: android.sh <out dir>
set -uo pipefail
OUT="$1"
mkdir -p "$OUT"
URL=http://localhost:1430/test/editor

{
	echo "fingerprint: $(adb shell getprop ro.build.fingerprint)"
	echo "default keyboard: $(adb shell settings get secure default_input_method)"
	echo "keyboards:"
	adb shell ime list -a -s
	echo "chrome: $(adb shell dumpsys package com.android.chrome | grep -m1 versionName)"
} | tee "$OUT/probes.txt"

# No `adb root`: it restarts adbd, which can leave the emulator offline for the next command. Chrome
# reads its flags file from /data/local/tmp when it is the debug app.
FLAGS='_ --disable-fre --no-first-run --no-default-browser-check --remote-allow-origins=*'
adb shell "echo '$FLAGS' > /data/local/tmp/chrome-command-line"
adb shell am set-debug-app --persistent com.android.chrome
# A slow emulator's system apps can stop responding, and their dialog covers the page.
adb shell settings put global hide_error_dialogs 1
# Granted up front, or Chrome covers the page with a prompt asking for it.
adb shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS
adb reverse tcp:1430 tcp:1430
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d "$URL"
adb forward tcp:9222 localabstract:chrome_devtools_remote

node scripts/mobile/android-run.mjs "$OUT"
status=$?
adb exec-out screencap -p > "$OUT/final.png"
adb logcat -d > "$OUT/logcat.txt"
exit "$status"
