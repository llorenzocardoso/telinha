#!/bin/bash
# baseline vs native over each impairment scenario; results appended to $1
OUT=${1:-/tmp/matrix.txt}; : > "$OUT"
cd "$(dirname "$0")/.."
for sc in clean bw6 loss1 bad; do
  echo "##### $sc: baseline" >> "$OUT"
  (cd harness && node run.mjs baseline $sc 30 10 2>&1 | grep -v "^\[page\]" >> "$OUT")
  sleep 3
  echo "##### $sc: native" >> "$OUT"
  taskkill //F //IM sender.exe >/dev/null 2>&1
  ./target/release/sender.exe 1080 60 10 4 50 8099 > /tmp/sender_$sc.log 2>&1 &
  sleep 3
  (cd harness && node run.mjs native $sc 30 2>&1 | grep -v "^\[page\]" >> "$OUT")
  taskkill //F //IM sender.exe >/dev/null 2>&1
  sleep 2
done
echo "##### DONE" >> "$OUT"
