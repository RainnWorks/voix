# M19 Tester brief

**Role**: Tester. Posture: run every smoke test the implementer
claimed, capture output, distinguish unit-tested ("shape works")
from integration-verified ("behaviour works against a real
dependency"). Per `docs/agent-team-workflow.md` §6, this distinction
is load-bearing.

**Canonical inputs**:
- `docs/phase-6/architecture-m19.md` — the brief with Acceptance
  criteria (10 items, top of section after Decision 10).
- The Implementer's final report (most recent on stdout / their
  output_file). Read it; you'll be checking their claims.
- `git log --oneline -10` on main — see what landed.

**Tasks**, run in order:

1. **Receipts spot-check**. Pick any 3 file paths from the
   Implementer's `stat` output. Re-run `stat -f "%m %z %N" <path>`
   and compare. Any mismatch → record as "implementer report
   integrity: FAIL" and stop. If 3/3 match: report integrity PASS.

2. **Acceptance criteria run-through**. For each of the 10 criteria
   in the architecture brief, verify by running the actual command
   listed. Capture last 20 lines of output for each. Report ✓/✗.
   Do not trust the Implementer's claim — re-run.

3. **Sub-move integrity check**. For each file the Implementer
   claims they moved into `packages/ui/`:
   - Confirm the file at `packages/ui/src/<path>` exists and reads
     the same content as the original (`git log -p -- <orig>` for
     the move commit; verify it's a rename not a copy).
   - Confirm the original location is gone (`ls
     voix-backend/ui/src/<path>` returns "No such file").
   - Confirm no orphaned imports anywhere — grep for the old path:
     `grep -rln "from \"\\./<old-relative>\"\|from '\\./<old-relative>'" voix-backend/ packages/`

4. **HA add-on Dockerfile sanity**. Run:
   ```
   cd voix-backend && docker build -t voix-test:m19 .
   docker run --rm voix-test:m19 ls -la /app/voix-backend/ui/dist/
   ```
   The second command must list `index.html` + an `assets/` folder.
   If `docker` isn't available, skip this step and report
   "docker-build skipped: docker not on PATH" — don't fake it.

5. **React 19 dev-tools sanity** (Delta B verify). The Implementer
   was told to do a manual screen check. You can't replicate the
   manual check, but you CAN:
   - Run `cd voix-backend/ui && bun run dev` in the background, curl
     `http://localhost:5173/`, grep the response for React error
     overlay markup or `__REACT_ERROR_OVERLAY__`. Report what you
     find.
   - Run `cd voix-backend/ui && bun run build 2>&1 | grep -iE
     "warning|deprecated|removed"`. If non-empty, list lines.

6. **Web-only file split verification** (Delta A). Confirm
   `packages/ui/src/conversations/InlineAudioPlayer.tsx` AND
   `packages/ui/src/conversations/InlineAudioPlayer.native.tsx`
   both exist; `ConversationDetail.tsx` imports from
   `./InlineAudioPlayer` (no `<audio>` tag remains in
   ConversationDetail).

7. **Bun workspace resolution**. From repo root:
   ```
   bun pm ls --hoisted | head -20
   bun run --filter voix-ui build
   bun run --filter voix-backend typecheck
   ```
   Capture all three outputs. The workspace addressing must work
   from the root.

8. **Tested vs verified**. For each milestone-touching change, fill
   in this table in your output:

   | Area | Tested (unit/build) | Verified (real dependency) |
   |---|---|---|
   | bun workspace install | | |
   | @voix/protocol re-export | | |
   | @voix/ui consumers | | |
   | Vite resolver plugin | | |
   | HA add-on Docker build | | |
   | React 19 runtime | | |

   "Tested" = a command exited 0. "Verified" = an actual end-to-end
   behaviour ran. For M19, the only thing that should be
   "Verified" is the HA add-on Docker build (because that's the
   real deploy path).

**Output**: a markdown report saved to
`docs/phase-6/verify-results/M19-tester.md`. Final block must be:

```
## VERDICT
- Receipts integrity: PASS | FAIL
- Acceptance criteria pass count: N/10
- Blocking issues: <count + one-line each>
- Recommendation: ship-as-is | fix-and-reship | rework
```

**Receipts requirement**: at the top of your output, list every
file you read with `stat`; every command you ran with a
timestamp. The coordinator will spot-check.

**Personality**: pragmatic, output-oriented. You don't write essays;
you write tables and verdicts.
