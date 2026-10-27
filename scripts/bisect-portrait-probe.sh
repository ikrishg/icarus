#!/usr/bin/env bash
set -uo pipefail
cd /workspace
COMMITS=(a1f53eb 8f29c95 8f44ada 0cfcc01 fa9629c)
OUT=/opt/cursor/artifacts/bisect-portrait-probe
mkdir -p "$OUT"
ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)
ORIG_HEAD=$(git rev-parse HEAD)
PGREP_RE='chrome-headless-shell|chromium.*headless|ms-playwright|vite.*preview'
cleanup_all() {
  pkill -9 -f "$PGREP_RE" 2>/dev/null || true
  sleep 10
}
run_walk() {
  local extra=("$@")
  cleanup_all
  npx vite build --config vite/config.qa.mjs >/dev/null 2>&1
  env -u QA_CPU_THROTTLE QA_SKIP_VITE_BUILD=1 "${extra[@]}" node scripts/qa-walk.mjs 2>/dev/null
}
for c in "${COMMITS[@]}"; do
  git checkout "$c" >/dev/null
  echo "=== $c probe ===" | tee "$OUT/$c.summary"
  if run_walk QA_DEATH_ROTATE_PROBE=1 >"$OUT/$c-probe.json" 2>"$OUT/$c-probe.err"; then
    echo probe_exit=0 | tee -a "$OUT/$c.summary"
  else
    echo probe_exit=$? | tee -a "$OUT/$c.summary"
  fi
  node -e "
const fs=require('fs');
const p='$OUT/$c-probe.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
const d=j.deathRotateTouchSpawnProbe;
console.log('probeOk',d?.deathRotateTouchSpawnProbeOk,'failures',d?.failures?.length??0);
if(d?.failures?.[0]) console.log('firstProbeFail',JSON.stringify(d.failures[0]));
" | tee -a "$OUT/$c.summary"
  echo "=== $c t1 throttle ===" | tee -a "$OUT/$c.summary"
  if run_walk QA_CPU_THROTTLE=1 >"$OUT/$c-t1.json" 2>"$OUT/$c-t1.err"; then
    echo t1_exit=0 | tee -a "$OUT/$c.summary"
  else
    echo t1_exit=$? | tee -a "$OUT/$c.summary"
  fi
  node -e "
const fs=require('fs');
const p='$OUT/$c-t1.json';
let j;
try { j=JSON.parse(fs.readFileSync(p,'utf8')); } catch(e) {
  console.log('t1_parse_fail',String(e).slice(0,120));
  process.exit(0);
}
if(j.fatal){ console.log('t1_fatal',j.fatal); process.exit(0); }
console.log('pass',j.pass);
console.log('portraitUnfreeze',j.portraitUnfreeze?.portraitUnfreezeOk);
console.log('jumpInPlace',j.jumpInPlace?.jumpInPlaceOk);
console.log('touchSpawn',j.touchSpawn?.touchSpawnOk);
console.log('deathRotate',j.deathRotateTouchSpawnProbe?.deathRotateTouchSpawnProbeOk);
if(j.portraitUnfreeze?.cases){ const c=j.portraitUnfreeze.cases.find(x=>!x.ok); if(c) console.log('portraitCase',c); }
if(j.jumpInPlace?.failures?.[0]) console.log('jumpFail',j.jumpInPlace.failures[0]);
" | tee -a "$OUT/$c.summary"
done
git checkout "$ORIG_HEAD" >/dev/null
echo BISECT_DONE restored "$ORIG_HEAD" | tee "$OUT/BISECT_DONE"
