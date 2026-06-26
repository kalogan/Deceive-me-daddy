#!/usr/bin/env bash
# The balanced hard-gate (PROJECT_BRIEF §5). Run with REAL exit codes, each under a
# hard timeout so a hung command fails fast instead of blocking forever. ALL must be 0.
# The Architect re-runs THIS — never trusts a builder's "all green".
set +e

timeout 300 pnpm -r typecheck                         ; tc=$?
timeout 180 pnpm lint                                 ; ln=$?
timeout 120 pnpm lint:content                         ; lc=$?
timeout 600 pnpm test 2>&1 | tee /tmp/deceive-test.log ; tst=${PIPESTATUS[0]}
timeout 300 pnpm build                                ; bd=$?
timeout 60  pnpm check:boot                            ; bt=$?

echo ""
echo "================ GATE RESULTS ================"
echo "typecheck=$tc  lint=$ln  content=$lc  test=$tst  build=$bd  boot=$bt"
echo "(exit 124 = HUNG — investigate an open handle / non-exiting process, NOT a pass)"
echo "============================================="

# Record the unit-test count so a silent drop is visible.
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/deceive-test.log || true

if [ "$tc" -ne 0 ] || [ "$ln" -ne 0 ] || [ "$lc" -ne 0 ] || [ "$tst" -ne 0 ] || [ "$bd" -ne 0 ] || [ "$bt" -ne 0 ]; then
  echo "GATE: RED"
  exit 1
fi
echo "GATE: GREEN"
