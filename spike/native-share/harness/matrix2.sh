#!/bin/bash
# baseline (Chrome) vs libwebrtc passthrough sender, N runs per scenario. usage: matrix2.sh out.txt [runs=2]
OUT=${1:-/tmp/matrix2.txt}; RUNS=${2:-2}; : > "$OUT"
cd "$(dirname "$0")/.."
for sc in ${SCENARIOS:-clean bw6 loss1 bad}; do
  for r in $(seq 1 $RUNS); do
    echo "##### $sc run $r: baseline" >> "$OUT"
    (cd harness && node run.mjs baseline $sc 30 10 2>&1 | grep -v "^\[page\]" >> "$OUT")
    sleep 3
    echo "##### $sc run $r: libwebrtc" >> "$OUT"
    taskkill //F //IM sender_lk.exe >/dev/null 2>&1; sleep 1
    ./target/release/sender_lk.exe 1080 60 10 4 50 8099 > /tmp/lk_${sc}_$r.log 2>&1 &
    sleep 4
    (cd harness && node run.mjs native $sc 30 2>&1 | grep -v "^\[page\]" >> "$OUT")
    taskkill //F //IM sender_lk.exe >/dev/null 2>&1
    sleep 2
  done
done
echo "##### DONE" >> "$OUT"
