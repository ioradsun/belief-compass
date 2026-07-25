# scripts

## `verify:reducer` — prove `wallet_beliefs` is the source of truth

Reconstructs a wallet's conviction state from its **own on-chain trades**
(trade events are indexed by buyer/seller) folded through the **production
reducer** (`src/domain`), and diffs it against POV's live `/positions` — the
ground truth of what the wallet actually holds right now.

It deliberately does **not** read our Supabase copy: it verifies the reducer
*logic* against reality, so a green run means the math is correct independent of
ingest. Ingest gaps (an unindexed trade, or a raw ERC-20 token transfer POV
counts but our trade-only reducer doesn't) surface here as a shares mismatch —
exactly what we want to catch before shipping persistence / wealth stories.

```bash
# Full verification (recommended: a paid Base RPC, or it's slow — public RPC
# caps eth_getLogs at 10k blocks, ~780 calls/wallet over the full range).
BASE_RPC_URL="https://base-mainnet.g.alchemy.com/v2/<key>" VERIFY_CHUNK=400000 \
  npm run verify:reducer -- 0xWALLET1 0xWALLET2 0xWALLET3

# Quick smoke test on a narrow recent range (proves the pipeline, not a match):
npm run verify:reducer -- 0xWALLET --from-block=49000000
```

Exit code is `0` when every position matches, non-zero otherwise (CI-friendly).

### What POV can and cannot verify

POV `/positions` exposes **side + current token balance + current value** — so
those are checked exactly. It does **not** expose cost basis, realized P&L,
`directional_since`, or `days_held`; those are reducer-internal with no POV
oracle, so the tool **computes and prints** them (for trust) but never claims
they're "verified." Verifying those requires the on-chain fill history the
reducer already folds — which is what this tool reconstructs.
