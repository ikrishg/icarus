#!/usr/bin/env bash
set -uo pipefail
cd /workspace
unset QA_CPU_THROTTLE
npx vite build --config vite/config.qa.mjs >/dev/null
export QA_SKIP_VITE_BUILD=1
LOG=/tmp/donebar.log
SUMMARY=/tmp/donebar-summary.tsv
: > "$LOG"
: > "$SUMMARY"
echo -e "run\tpass\tl15\tfirstEntryMs\texit" > "$SUMMARY"

cleanup_browser() {
  pkill -f "chrome-headless-shell|chromium.*headless" 2>/dev/null || true
  sleep 10
}

summarize() {
  local tag="$1" json="$2" exit="$3"
  node -e "
const j=JSON.parse(require('fs').readFileSync('$json','utf8'));
const pass=j.pass===true?'true':'false';
const l15=j.l15RealKeys?.l15RealKeysOk===true?'true':'false';
const fe=j.fireballFirstSpawnTiming?.firstEntryMs ?? '';
console.log(['$tag',pass,l15,fe,'$exit'].join('\t'));
" >> "$SUMMARY" 2>/dev/null || echo -e "$tag\tparse_fail\t\t\t$exit" >> "$SUMMARY"
}

touch_ok=0
touch_attempt=0
while [ "$touch_ok" -lt 10 ]; do
  touch_attempt=$((touch_attempt + 1))
  cleanup_browser
  if env -u QA_CPU_THROTTLE QA_TOUCH_SPAWN_ONLY=1 node scripts/qa-walk.mjs >/dev/null 2>&1; then
    touch_ok=$((touch_ok + 1))
  else
    echo "touchFAIL attempt=${touch_attempt} ok=${touch_ok}" | tee -a "$LOG"
  fi
done
echo "TOUCH_DONE ok=${touch_ok}/10 attempts=${touch_attempt}" | tee -a "$LOG"
env -u QA_CPU_THROTTLE QA_DEATH_ROTATE_PROBE=1 node scripts/qa-walk.mjs >/dev/null 2>&1 || echo PROBE_FAIL | tee -a "$LOG"
echo PROBE_DONE | tee -a "$LOG"
for i in 1 2 3 4 5; do
  echo "t$i" | tee -a "$LOG"
  json="/tmp/donebar-t$i.json"
  QA_CPU_THROTTLE=1 node scripts/qa-walk.mjs > "$json" 2>"$json.err" | rg '"pass"|l15RealKeysOk|touchSpawnOk|portraitUnfreezeOk|fireballFirstSpawnTimingOk|firstEntryMs' | tee -a "$LOG"
  ec=${PIPESTATUS[0]}
  echo "exit=${ec}" | tee -a "$LOG"
  summarize "t$i" "$json" "$ec"
  cleanup_browser
  sleep 120
done
for i in 1 2 3 4 5; do
  echo "u$i" | tee -a "$LOG"
  json="/tmp/donebar-u$i.json"
  env -u QA_CPU_THROTTLE node scripts/qa-walk.mjs > "$json" 2>"$json.err" | rg '"pass"|l15RealKeysOk|touchSpawnOk|portraitUnfreezeOk|fireballFirstSpawnTimingOk|firstEntryMs' | tee -a "$LOG"
  ec=${PIPESTATUS[0]}
  echo "exit=${ec}" | tee -a "$LOG"
  summarize "u$i" "$json" "$ec"
  cleanup_browser
  sleep 90
done
echo ALL_DONE | tee -a "$LOG"
cat "$SUMMARY" | tee -a "$LOG"
