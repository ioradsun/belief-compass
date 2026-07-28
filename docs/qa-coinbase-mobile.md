# QA — Coinbase mobile deep-link & return

Covers connecting via the Coinbase app from a mobile browser and returning to
conviction.company with a live session. Run the automated pass first, then the
manual pass on real hardware (deep-links can't be fully faked headless).

## 1. Automated pass

```bash
# app already running on :8080 (or set BASE_URL to the preview/published URL)
python3 tests/e2e/coinbase_mobile_connect.py
bunx vitest run src/lib/wagmi.test.ts
```

The e2e script emulates iPhone 13 + Pixel 7 and asserts, per platform:

| Check | Regression it guards |
| --- | --- |
| Visible "Connect wallet" entry point | no way to reach the picker on a phone |
| Coinbase row visible & enabled | picker rendered empty / option missing |
| Tap target ≥ 44px | "not clickable in preview mobile" |
| Brand logo present | blank rows in the picker |
| Tap triggers deep-link / SDK handoff | SDK import awaited outside the gesture → popup blocked |
| Recovers after cancel (WARN-only) | stuck spinner after a rejected request |
| Return re-arms the connector | returning users land signed out |
| No crash on return | reconnect throws on rehydrate |

Screenshots for every step land in `tests/e2e/screenshots/`. Exit code 0 = pass.
`WARN` rows are observations headless can't decide (it cannot close the native
Coinbase surface) — confirm those in the manual pass; they never fail the run.

**Known failure as of the last run:** on both iPhone 13 and Pixel 7 emulation the
"Connect wallet" button lives only in the desktop-only left rail (`hidden lg:flex`),
so a phone has no visible way to open the picker. Everything downstream of that
passes — the script falls back to firing the app's `conviction:open-connect` event.
Fix the mobile entry point (header avatar or the hamburger drawer) and this check
turns green.

The vitest file locks the connector config itself: Coinbase/WalletConnect stay
out of the eager bundle, `preference: "all"` (Coinbase **app** stays selectable,
not Smart Wallet only), `showQrModal: true`, and post-prefetch connector
construction under 50ms so it fits inside a tap.

## 2. Manual pass (real devices)

Do each row on **iOS Safari + Coinbase Wallet app** and **Android Chrome +
Coinbase Wallet app**. Repeat the starred rows with the Coinbase app *not*
installed.

- [ ] Cold load the site, tap **Connect Wallet** — picker opens in < 1s.
- [ ] Coinbase Wallet row shows logo + "Smart Wallet or Coinbase app".
- [ ] Tap Coinbase — the Coinbase app (or Smart Wallet sheet) opens on the first tap, with no second tap needed.
- [ ] * Without the app installed: Smart Wallet (passkey) flow opens in-browser instead of a dead tap.
- [ ] Approve in Coinbase, tap **Return to app** / back-swipe — the site is connected, avatar/address in the top-right.
- [ ] Reject in Coinbase and return — the picker is usable again, no stuck spinner, no locked form.
- [ ] Backgrounding the browser for 30s mid-connect and returning still lands connected or cleanly cancelled.
- [ ] Hard-reload after connecting — session restores without re-approval.
- [ ] Kill the browser, reopen the site — still connected (LazyReconnect path).
- [ ] Disconnect from the account menu — reload shows the signed-out state, no ghost session.
- [ ] Connected via Coinbase, place a $1 trade — signature prompt deep-links to Coinbase and returns.
- [ ] Airplane mode mid-connect: an error is shown and the picker recovers when back online.
- [ ] WalletConnect row still opens its QR/wallet sheet (regression neighbour).

## 3. If it fails

- Tap does nothing → the SDK import wasn't warm; confirm `prefetchWalletSdks()` still runs on picker open.
- Coinbase app never offered, only passkey → `preference` drifted off `"all"`.
- Returns signed out → check `recentConnectorId` in `localStorage` and that `LazyReconnect` ran (idle callback).
- Popup blocked warning in Safari → something `await`ed before the connect call inside the click handler.
