#!/usr/bin/env bash
# pre-deploy-audit.sh — Arcorapay pre-deploy self-audit gate.
#
# Recipe B (skill: agentic-loop-design). Autonomy L1: this script SURFACES and BLOCKS.
# It NEVER edits contracts and NEVER broadcasts. The deploy stays in human hands.
#
# Stop condition (external, not an agent's claim):
#   forge build clean  AND  forge test green  AND  coverage measured >0 audit-scope lines
#   AND  zero NEW medium+ Slither findings vs a frozen baseline  AND  (mythril clean | explicitly skipped)
#   -> exit 0 "CLEAR TO DEPLOY".  Any failure -> writes findings to STATE.md, exit 1.
#
# Usage:
#   ./pre-deploy-audit.sh                 # run the gate
#   ./pre-deploy-audit.sh --freeze-baseline   # snapshot current Slither output as the baseline
#   RUN_FUZZ=1 ./pre-deploy-audit.sh      # use forge --profile ci (10k fuzz / invariants)
#   ALLOW_NO_MYTHRIL=1 ./pre-deploy-audit.sh  # proceed without local mythril (CI still enforces)
#
# Allowlist for unattended use (NO mainnet broadcast, NO cast send):
#   Read,Bash(forge build:*),Bash(forge test:*),Bash(forge coverage:*),Bash(slither:*),
#   Bash(myth:*),Bash(aderyn:*),Bash(jq:*),Bash(git:*)

set -uo pipefail
export LC_ALL=C LC_NUMERIC=C

# ── paths ─────────────────────────────────────────────────────────────────────
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"     # .../packages/contracts/audit/preflight
CONTRACTS="$(cd "$HERE/../.." && pwd)"                   # .../packages/contracts
REPO="$(cd "$CONTRACTS/../.." && pwd)"                   # repo root
BASELINE_DIR="$HERE/baseline"
STATE_FILE="$HERE/STATE.md"
WORK="${WORK:-/tmp/arcorapay-preflight}"
mkdir -p "$WORK" "$BASELINE_DIR"

AUDIT_SRC="src/ArcFXGateway.sol"        # confirmed actual filename (there is no V10 file)
SLITHER_FILTER='lib/|test/'
SLITHER_BASELINE="$BASELINE_DIR/slither-baseline.json"

ALLOW_NO_MYTHRIL="${ALLOW_NO_MYTHRIL:-0}"
RUN_FUZZ="${RUN_FUZZ:-0}"

cd "$CONTRACTS"

# ── helpers ───────────────────────────────────────────────────────────────────
FAILURES=()   # human-readable failure lines
PASSES=()     # human-readable pass lines
note_pass() { PASSES+=("$1"); printf '  \033[32m✓\033[0m %s\n' "$1"; }
note_fail() { FAILURES+=("$1"); printf '  \033[31m✗\033[0m %s\n' "$1"; }
hr() { printf '\n── %s ──\n' "$1"; }

# Extract sorted unique medium+ finding keys from a Slither JSON.
# Key = impact|check|file|element  (stable across line drift; ignores line numbers).
slither_keys() {
  # Audit LOW (2026-07-05): the key now INCLUDES the finding's start line.
  # Without it, two distinct findings from the same detector on the same element
  # (e.g. two reentrancy hits in one function) collapse onto one key, so a NEW
  # one that lands on an existing baseline key is silently suppressed — a
  # fail-OPEN on a security gate. Keying with the line makes the diff fail-SAFE:
  # a real code shift may surface a spurious "new" finding, which just blocks
  # loudly until the maintainer re-freezes the baseline on the blessed commit
  # (./pre-deploy-audit.sh --freeze-baseline). A false block is acceptable; a
  # silently-dropped medium+ is not.
  jq -r '
    (.results.detectors // [])[]
    | select(.impact=="High" or .impact=="Medium")
    | [ .impact, .check,
        (.elements[0].source_mapping.filename_relative // "?"),
        (.elements[0].name // .elements[0].type // "?"),
        ((.elements[0].source_mapping.lines // [])[0] | tostring) ]
    | join("|")
  ' "$1" 2>/dev/null | sort -u
}

run_slither() {  # -> writes $WORK/slither.json ; returns 0 only if JSON is valid
  # Slither exits nonzero when it finds issues OR when fail-on triggers; we drive the
  # pass/fail ourselves from the JSON, so ignore its exit and validate the file instead.
  # Slither refuses to overwrite an existing --json target, so clear it first.
  rm -f "$WORK/slither.json"
  slither . --filter-paths "$SLITHER_FILTER" --json "$WORK/slither.json" >/dev/null 2>"$WORK/slither.err" || true
  jq -e . "$WORK/slither.json" >/dev/null 2>&1
}

# ── freeze baseline mode ──────────────────────────────────────────────────────
if [[ "${1:-}" == "--freeze-baseline" ]]; then
  hr "freeze baseline"
  echo "Building artefacts (forge build)…"
  forge build >/dev/null 2>&1 || { echo "forge build failed — fix before freezing."; exit 2; }
  echo "Running Slither…"
  if ! run_slither; then
    echo "Slither did not produce valid JSON. stderr:"; cat "$WORK/slither.err"; exit 2
  fi
  cp "$WORK/slither.json" "$SLITHER_BASELINE"
  COMMIT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  N="$(slither_keys "$SLITHER_BASELINE" | wc -l | tr -d ' ')"
  echo "Frozen: $SLITHER_BASELINE  ($N medium+ findings)  @ $COMMIT  $WHEN"
  echo "→ Now update STATE.md 'Baseline' block: commit $COMMIT, frozen $WHEN."
  echo "→ Review those $N findings: each one accepted must get a row in .slither-triage.md."
  exit 0
fi

echo "════════════════════════════════════════════════════════════"
echo " Arcorapay pre-deploy self-audit · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo " repo $REPO @ $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')  ($(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
echo "════════════════════════════════════════════════════════════"

# ── gate 1: build ─────────────────────────────────────────────────────────────
hr "gate 1 · forge build"
if forge build --sizes >"$WORK/build.log" 2>&1; then
  note_pass "forge build clean"
else
  note_fail "forge build FAILED — see $WORK/build.log"
fi

# ── gate 2: tests ─────────────────────────────────────────────────────────────
hr "gate 2 · forge test"
if [[ "$RUN_FUZZ" == "1" ]]; then TEST_CMD=(forge test --profile ci); else TEST_CMD=(forge test); fi
if "${TEST_CMD[@]}" >"$WORK/test.log" 2>&1; then
  TOTAL="$(grep -Eo '[0-9]+ tests? passed' "$WORK/test.log" | tail -1)"
  [[ -z "$TOTAL" ]] && TOTAL="$(grep -Eo '[0-9]+ passed' "$WORK/test.log" | awk '{s+=$1} END{print s" passed"}')"
  note_pass "${TEST_CMD[*]} green ($TOTAL)"
else
  note_fail "${TEST_CMD[*]} FAILED — see $WORK/test.log"
fi

# ── gate 3: coverage + NO-OP GUARD ────────────────────────────────────────────
hr "gate 3 · coverage (with no-op guard)"
LINE_FLOOR="${COVERAGE_LINE_FLOOR:-95}"; BRANCH_FLOOR="${COVERAGE_BRANCH_FLOOR:-90}"
if forge coverage --report lcov >"$WORK/coverage.log" 2>&1 && [[ -f lcov.info ]]; then
  # Independent guard: compute REAL line/branch % for the audit-scope file and enforce the floor
  # ourselves — do not rely on bin/coverage-gate.sh, which scopes a nonexistent file (see below).
  read -r LF LH BRF BRH LP BP < <(awk -v f="SF:$AUDIT_SRC" '
    $0==f{flag=1}
    flag&&/^LF:/{sub(/^LF:/,"");lf=$0}
    flag&&/^LH:/{sub(/^LH:/,"");lh=$0}
    flag&&/^BRF:/{sub(/^BRF:/,"");brf=$0}
    flag&&/^BRH:/{sub(/^BRH:/,"");brh=$0}
    flag&&/^end_of_record/{ printf "%d %d %d %d %.2f %.2f", lf,lh,brf,brh,(lf?100*lh/lf:0),(brf?100*brh/brf:0); exit }
  ' lcov.info)
  if [[ -z "${LF:-}" || "${LF:-0}" -eq 0 ]]; then
    note_fail "coverage measured 0 lines for $AUDIT_SRC — nothing instrumented; this would be a silent no-op"
  elif awk -v p="${LP:-0}" -v f="$LINE_FLOOR" 'BEGIN{exit !(p+0>=f+0)}' \
    && awk -v p="${BP:-0}" -v f="$BRANCH_FLOOR" 'BEGIN{exit !(p+0>=f+0)}'; then
    note_pass "coverage $AUDIT_SRC: lines ${LP}% ($LH/$LF) · branches ${BP}% ($BRH/$BRF)  [floor $LINE_FLOOR/$BRANCH_FLOOR]"
  else
    note_fail "coverage below floor for $AUDIT_SRC: lines ${LP}% (floor $LINE_FLOOR) · branches ${BP}% (floor $BRANCH_FLOOR)"
  fi
  # Advisory: flag only if the ACTIVE in_scope pattern still targets the wrong file
  # (match the assignment line, not historical comments that may mention the old name).
  if grep -qE 'in_scope[[:space:]]*=.*ArcFXGatewayV10' bin/coverage-gate.sh 2>/dev/null; then
    printf '  \033[33m~\033[0m bin/coverage-gate.sh scopes ArcFXGatewayV10.sol (nonexistent) → passes vacuously. Repoint it to %s.\n' "$AUDIT_SRC"
  fi
else
  note_fail "forge coverage FAILED — see $WORK/coverage.log"
fi

# ── gate 4: slither baseline diff ─────────────────────────────────────────────
hr "gate 4 · slither (new medium+ vs baseline)"
if [[ ! -f "$SLITHER_BASELINE" ]]; then
  note_fail "no baseline yet — run './pre-deploy-audit.sh --freeze-baseline' on a blessed commit first"
elif ! command -v slither >/dev/null; then
  note_fail "slither not installed — 'pip install slither-analyzer'"
elif ! run_slither; then
  note_fail "slither produced no valid JSON — see $WORK/slither.err (do NOT treat as clean)"
else
  slither_keys "$WORK/slither.json"   > "$WORK/slither.keys"
  slither_keys "$SLITHER_BASELINE"    > "$WORK/slither.baseline.keys"
  comm -13 "$WORK/slither.baseline.keys" "$WORK/slither.keys" > "$WORK/slither.new"
  NEW_N="$(wc -l < "$WORK/slither.new" | tr -d ' ')"
  if [[ "$NEW_N" -eq 0 ]]; then
    note_pass "no new medium+ slither findings vs baseline ($(wc -l < "$WORK/slither.baseline.keys" | tr -d ' ') in baseline)"
  else
    note_fail "$NEW_N NEW medium+ slither finding(s) vs baseline:"
    while IFS= read -r k; do printf '      • %s\n' "$k"; done < "$WORK/slither.new"
  fi
fi

# ── gate 5: mythril (heavy / opt-in) ──────────────────────────────────────────
hr "gate 5 · mythril"
if command -v myth >/dev/null; then
  myth analyze "$AUDIT_SRC" \
    --solv 0.8.26 \
    --solc-args "--allow-paths .,lib --base-path . --include-path lib/openzeppelin-contracts/contracts" \
    --execution-timeout 600 --max-depth 12 -o json >"$WORK/myth.json" 2>"$WORK/myth.err" || true
  MN="$(jq '.issues | length' "$WORK/myth.json" 2>/dev/null || echo "?")"
  if [[ "$MN" == "0" ]]; then note_pass "mythril: 0 issues"
  elif [[ "$MN" == "?" ]]; then note_fail "mythril did not produce valid JSON — see $WORK/myth.err"
  else note_fail "mythril: $MN issue(s) — see $WORK/myth.json"; fi
elif [[ "$ALLOW_NO_MYTHRIL" == "1" ]]; then
  printf '  \033[33m~\033[0m mythril not installed — SKIPPED (ALLOW_NO_MYTHRIL=1; CI still enforces on push)\n'
else
  note_fail "mythril not installed. 'pip install mythril==0.24.8' or re-run with ALLOW_NO_MYTHRIL=1"
fi

# ── gate 6: aderyn (optional — only if installed) ─────────────────────────────
if command -v aderyn >/dev/null; then
  hr "gate 6 · aderyn (optional)"
  if aderyn . >"$WORK/aderyn.log" 2>&1; then note_pass "aderyn ran (review $WORK/aderyn.log)"
  else note_pass "aderyn ran with findings — review $WORK/aderyn.log (advisory, not blocking in v1)"; fi
fi

# ── verdict + STATE write-back ────────────────────────────────────────────────
WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo '?')"

# Replace the content between the New-findings markers in STATE.md with $1.
# Audit LOW (2026-07-05): a CLEAR run must CLEAR stale BLOCKED findings, not
# leave them lingering — the block is now rewritten every run (CLEAR wipes it,
# BLOCKED fills it) so STATE.md always reflects the LAST run, not an old failure.
# Falls back to an append only if the markers are missing.
write_findings_block() {
  local body="$1" bodyfile
  bodyfile="$(mktemp)"
  printf '%s\n' "$body" > "$bodyfile"
  if [[ -f "$STATE_FILE" ]] && grep -q '<!-- BEGIN new-findings -->' "$STATE_FILE"; then
    # Read the (possibly multi-line) body from a file so awk handles newlines.
    awk -v bf="$bodyfile" '
      /<!-- BEGIN new-findings -->/ { print; while ((getline l < bf) > 0) print l; close(bf); skip=1; next }
      /<!-- END new-findings -->/   { skip=0 }
      !skip { print }
    ' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  else
    { echo ""; cat "$bodyfile"; } >> "$STATE_FILE"
  fi
  rm -f "$bodyfile"
}

echo "════════════════════════════════════════════════════════════"
if [[ "${#FAILURES[@]}" -eq 0 ]]; then
  echo " VERDICT: CLEAR TO DEPLOY  (all gates green @ $COMMIT)"
  echo "════════════════════════════════════════════════════════════"
  write_findings_block "- _none — last run CLEAR @ $COMMIT ($WHEN)_"
  printf -- '- %s · %s · CLEAR (%d gates)\n' "$WHEN" "$COMMIT" "${#PASSES[@]}" >> "$WORK/runlog.tmp" 2>/dev/null || true
  exit 0
fi

echo " VERDICT: BLOCKED — ${#FAILURES[@]} gate(s) failed. Do NOT deploy."
echo "════════════════════════════════════════════════════════════"

# L1: surface only. A human reads this, fixes, re-runs.
BLOCK="### $WHEN · BLOCKED @ $COMMIT"
for f in "${FAILURES[@]}"; do BLOCK="$BLOCK"$'\n'"- ⛔ $f"; done
write_findings_block "$BLOCK"
echo "Findings written to: $STATE_FILE"
exit 1
