#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
unset QA_CPU_THROTTLE
unset QA_SKIP_VITE_BUILD

LOG=/tmp/donebar.log
SUMMARY=/tmp/donebar-summary.tsv
: > "$LOG"
: > "$SUMMARY"
echo -e "run\tpass\tl15\tfirstEntryMs\texit" > "$SUMMARY"

STARTED_PIDS=()

kill_started_pids() {
  local pid
  for pid in "${STARTED_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  STARTED_PIDS=()
  sleep 2
}

cleanup_all() {
  kill_started_pids
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

run_isolated_walk() {
  local tag="$1"
  shift
  local extra_env=("$@")
  cleanup_all
  npx vite build --config vite/config.qa.mjs >/dev/null
  env -u QA_CPU_THROTTLE \
    QA_SKIP_VITE_BUILD=1 \
    "${extra_env[@]}" \
    node scripts/qa-walk.mjs &
  local node_pid=$!
  STARTED_PIDS+=("$node_pid")
  wait "$node_pid"
  local ec=$?
  kill_started_pids
  return "$ec"
}

touch_ok=0
touch_attempt=0
touch_max_attempts=50
while [ "$touch_ok" -lt 10 ]; do
  touch_attempt=$((touch_attempt + 1))
  if [ "$touch_attempt" -gt "$touch_max_attempts" ]; then
    echo "TOUCH_ABORT attempts=${touch_attempt} ok=${touch_ok}" | tee -a "$LOG"
    exit 1
  fi
  if run_isolated_walk "touch-${touch_attempt}" QA_TOUCH_SPAWN_ONLY=1 >/dev/null 2>&1; then
    touch_ok=$((touch_ok + 1))
  else
    echo "touchFAIL attempt=${touch_attempt} ok=${touch_ok}" | tee -a "$LOG"
  fi
done
echo "TOUCH_DONE ok=${touch_ok}/10 attempts=${touch_attempt}" | tee -a "$LOG"

mid_json="/tmp/donebar-mid-death.json"
if ! run_isolated_walk "mid-death" QA_MID_DEATH_RESIZE_ONLY=1 > "$mid_json" 2>"$mid_json.err"; then
  echo MID_DEATH_RESIZE_FAIL | tee -a "$LOG"
  exit 1
fi
echo MID_DEATH_RESIZE_DONE | tee -a "$LOG"

if ! run_isolated_walk "probe" QA_DEATH_ROTATE_PROBE=1 >/dev/null 2>&1; then
  echo PROBE_FAIL | tee -a "$LOG"
  exit 1
fi
echo PROBE_DONE | tee -a "$LOG"

for i in 1 2 3 4 5; do
  echo "t$i" | tee -a "$LOG"
  json="/tmp/donebar-t$i.json"
  run_isolated_walk "t$i" QA_CPU_THROTTLE=1 > "$json" 2>"$json.err" | rg '"pass"|l15RealKeysOk|touchSpawnOk|portraitUnfreezeOk|fireballFirstSpawnTimingOk|firstEntryMs|gitSha' | tee -a "$LOG"
  ec=${PIPESTATUS[0]}
  echo "exit=${ec}" | tee -a "$LOG"
  summarize "t$i" "$json" "$ec"
  if [ "$ec" -ne 0 ]; then
    echo "T${i}_FAIL exit=${ec}" | tee -a "$LOG"
    exit 1
  fi
  sleep 30
done
for i in 1 2 3 4 5; do
  echo "u$i" | tee -a "$LOG"
  json="/tmp/donebar-u$i.json"
  run_isolated_walk "u$i" > "$json" 2>"$json.err" | rg '"pass"|l15RealKeysOk|touchSpawnOk|portraitUnfreezeOk|fireballFirstSpawnTimingOk|firstEntryMs|gitSha' | tee -a "$LOG"
  ec=${PIPESTATUS[0]}
  echo "exit=${ec}" | tee -a "$LOG"
  summarize "u$i" "$json" "$ec"
  if [ "$ec" -ne 0 ]; then
    echo "U${i}_FAIL exit=${ec}" | tee -a "$LOG"
    exit 1
  fi
  sleep 30
done
echo ALL_DONE | tee -a "$LOG"
cat "$SUMMARY" | tee -a "$LOG"
