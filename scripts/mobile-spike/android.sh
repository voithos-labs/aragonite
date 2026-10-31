#!/usr/bin/env bash
# Runs inside the booted emulator's step: records what the image ships (keyboard, Chrome), opens
# the harness in Chrome with its first-run screens off, then types and checks.
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

# Chrome reads its flags file only on a debuggable build or for a debug app; root covers the first.
adb root && adb wait-for-device
FLAGS='_ --disable-fre --no-first-run --no-default-browser-check --remote-allow-origins=*'
adb shell "echo '$FLAGS' > /data/local/tmp/chrome-command-line"
adb shell "echo '$FLAGS' > /data/local/chrome-command-line"
adb shell am set-debug-app --persistent com.android.chrome
# Granted up front, or Chrome covers the page with a prompt asking for it.
adb shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS
adb reverse tcp:1430 tcp:1430
adb shell am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d "$URL"
adb forward tcp:9222 localabstract:chrome_devtools_remote

node scripts/mobile-spike/android-type.mjs "$OUT"
typed=$?
adb exec-out screencap -p > "$OUT/final.png"
adb logcat -d > "$OUT/logcat.txt"
[ "$typed" -eq 0 ] || exit "$typed"
node scripts/mobile-spike/check-recording.mjs android "$OUT/result.json"
