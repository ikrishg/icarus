#!/usr/bin/env bash
set -uo pipefail
cd /workspace
unset QA_CPU_THROTTLE
unset QA_SKIP_VITE_BUILD

LOG=/tmp/donebar.log
SUMMARY=/tmp/donebar-summary.tsv
: > "$LOG"
: > "$SUMMARY"
echo -e "run\tpass\tl15\tfirstEntryMs\texit" > "$SUMMARY"

PGREP_RE='chrome-headless-shell|chromium.*headless|ms-playwright|vite.*preview'

wait_processes_gone() {
  local tries=0
  while pgrep -f "$PGREP_RE" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo "STALE_PROCESS force-kill" | tee -a "$LOG"
      pkill -9 -f "$PGREP_RE" 2>/dev/null || true
      sleep 5
      break
    fi
    sleep 2
  done
}

cleanup_all() {
  pkill -9 -f "$PGREP_RE" 2>/dev/null || true
  sleep 15
  wait_processes_gone
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

run_isolated_node() {
  local tag="$1"
  shift
  local extra_env=("$@")
  local chrome_dir="/tmp/qa-chrome-${tag}-$$-$(date +%s%N)"
  rm -rf "$chrome_dir"
  mkdir -p "$chrome_dir"
  cleanup_all
  npx vite build --config vite/config.qa.mjs >/dev/null
  env -u QA_SKIP_VITE_BUILD -u QA_CPU_THROTTLE \
    QA_CHROMIUM_USER_DATA_DIR="$chrome_dir" \
    "${extra_env[@]}" \
    node scripts/qa-walk.mjs
  local ec=$?
  rm -rf "$chrome_dir"
  cleanup_all
  return "$ec"
}

touch_ok=0
touch_attempt=0
while [ "$touch_ok" -lt 10 ]; do
  touch_attempt=$((touch_attempt + 1))
  if run_isolated_node "touch-${touch_attempt}" QA_TOUCH_SPAWN_ONLY=1 >/dev/null 2>&1; then
    touch_ok=$((touch_ok + 1))
  else
    echo "touchFAIL attempt=${touch_attempt} ok=${touch_ok}" | tee -a "$LOG"
  fi
done
echo "TOUCH_DONE ok=${touch_ok}/10 attempts=${touch_attempt}" | tee -a "$LOG"

if ! run_isolated_node "probe" QA_DEATH_ROTATE_PROBE=1 >/dev/null 2>&1; then
  echo PROBE_FAIL | tee -a "$LOG"
fi
echo PROBE_DONE | tee -a "$LOG"

for i in 1 2 3 4 5; do
  echo "t$i" | tee -a "$LOG"
  json="/tmp/donebar-t$i.json"
  run_isolated_node "t$i" QA_CPU_THROTTLE=1 > "$json" 2>"$json.err" | rg '"pass"|l15RealKeysOk|touchSpawnOk|portraitUnfreezeOk|fireballFirstSpawnTimingOk|firstEntryMs' | tee -a "$LOG"
  ec=${PIPESTATUS[0]}
  echo "exit=${ec}" | tee -a "$LOG"
  summarize "t$i" "$json" "$ec"
  sleep 30
done
for i in 1 2 3 4 5; do
  echo "u$i" | tee -a "$LOG"
  json="/tmp/donebar-u$i.json"
  run_isolated_node "u$i" > "$json" 2>"$json.err" | rg '"pass"|l15RealKeysOk|touchSpawnOk|portraitUnfreezeOk|fireballFirstSpawnTimingOk|firstEntryMs' | tee -a "$LOG"
  ec=${PIPESTATUS[0]}
  echo "exit=${ec}" | tee -a "$LOG"
  summarize "u$i" "$json" "$ec"
  sleep 30
done
echo ALL_DONE | tee -a "$LOG"
cat "$SUMMARY" | tee -a "$LOG"
