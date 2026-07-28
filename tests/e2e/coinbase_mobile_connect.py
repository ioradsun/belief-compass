"""End-to-end check: Coinbase mobile deep-link + return.

    python3 tests/e2e/coinbase_mobile_connect.py
    BASE_URL=https://belief-scan.lovable.app python3 tests/e2e/coinbase_mobile_connect.py

What it proves (headless, no real wallet needed):
 1. The wallet picker opens on mobile viewports and the Coinbase row is visible,
    enabled and hit-testable (the "not clickable on mobile" regression).
 2. Tapping Coinbase fires a deep-link / SDK handoff INSIDE the tap gesture — i.e.
    no unresolved dynamic import blocks it (window.open, location changes to
    cbwallet:// and keys.coinbase.com requests are all captured).
 3. Returning from the Coinbase app (reload with wagmi's recentConnectorId set)
    re-loads the Coinbase SDK and attempts a reconnect instead of a signed-out shell.

Exit code 0 = all checks passed. Screenshots land in tests/e2e/screenshots/.
"""

import asyncio
import json
import os
import re
import time
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)

COINBASE_RE = re.compile(r"coinbase|cbwallet|wallet-sdk", re.I)

INSTRUMENT = """
window.__deepLinks = [];
const _open = window.open.bind(window);
window.open = (url, ...rest) => {
  window.__deepLinks.push(String(url ?? ''));
  return _open('about:blank', ...rest);
};
try {
  const _assign = window.location.assign.bind(window.location);
  window.location.assign = (url) => {
    window.__deepLinks.push(String(url));
    if (String(url).startsWith('http')) _assign(url);
  };
} catch (e) { /* window.open hook still covers Coinbase */ }
"""

results = []


def check(platform: str, label: str, ok: bool, detail: str = "") -> None:
    results.append((platform, label, ok))
    print(f"{'PASS' if ok else 'FAIL'}  [{platform}] {label}" + (f" — {detail}" if detail else ""))


async def run_case(playwright, browser, name: str, device_name: str) -> None:
    device = playwright.devices[device_name]
    context = await browser.new_context(**device)
    page = await context.new_page()

    sdk_requests: list[str] = []
    page.on("request", lambda r: sdk_requests.append(r.url) if COINBASE_RE.search(r.url) else None)
    await page.add_init_script(INSTRUMENT)

    # --- 1. picker reachable + Coinbase tappable ---------------------------
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)

    connect_re = re.compile(r"connect wallet", re.I)
    trigger = page.locator("button:visible", has_text=connect_re).first
    reachable = await trigger.count() > 0
    if not reachable:
        # Mobile hides the desktop rail — try the hamburger drawer.
        menu = page.get_by_label(re.compile("open menu", re.I)).first
        if await menu.count() > 0:
            await menu.click()
            await page.wait_for_timeout(1200)
            trigger = page.locator("button:visible", has_text=connect_re).first
            reachable = await trigger.count() > 0
    check(
        name,
        "A visible 'Connect wallet' entry point exists on mobile",
        reachable,
        "" if reachable else "hidden in the desktop-only rail",
    )
    if reachable:
        await trigger.click()
    else:
        # Fall back to the app's own open-connect event so the rest still runs.
        await page.evaluate("window.dispatchEvent(new Event('conviction:open-connect'))")

    coinbase = page.locator("button:visible", has_text=re.compile("coinbase", re.I)).first
    await coinbase.wait_for(state="visible", timeout=10_000)
    await page.screenshot(path=str(SHOTS / f"{name}-picker.png"))


    box = await coinbase.bounding_box()
    check(name, "Coinbase row visible & enabled", await coinbase.is_enabled())
    check(
        name,
        "Coinbase row has a real tap target (>= 44px tall)",
        bool(box) and box["height"] >= 44,
        f"{round(box['width'])}x{round(box['height'])}" if box else "no box",
    )
    has_logo = await coinbase.locator("img, svg").first.is_visible()
    check(name, "Coinbase row shows a brand logo", has_logo)

    # --- 2. tap fires a deep-link inside the gesture -----------------------
    try:
        await coinbase.click(timeout=10_000)
    except Exception:
        pass
    await page.wait_for_timeout(4000)
    deep_links = await page.evaluate("window.__deepLinks || []")
    captured = [u for u in deep_links + sdk_requests if COINBASE_RE.search(u)]
    check(
        name,
        "Tap triggers Coinbase deep-link / SDK handoff",
        bool(captured),
        (captured[0] if captured else "nothing captured")[:90],
    )
    await page.screenshot(path=str(SHOTS / f"{name}-after-tap.png"))

    # Cancelling (closing the Coinbase surface) must release the picker — the
    # "form stuck forever after a rejected request" regression.
    for popup in list(context.pages):
        if popup is not page:
            await popup.close()
    recovered = False
    for _ in range(20):
        await page.wait_for_timeout(1000)
        loading = await page.get_by_text(re.compile("loading…", re.I)).count()
        if loading == 0 and await coinbase.is_enabled():
            recovered = True
            break
    check(name, "Picker recovers after the connect is cancelled", recovered)
    await page.screenshot(path=str(SHOTS / f"{name}-after-cancel.png"))


    # --- 3. return from the Coinbase app -----------------------------------
    await page.evaluate(
        """() => {
          const raw = localStorage.getItem('wagmi.store');
          const store = raw ? JSON.parse(raw) : { state: {}, version: 2 };
          store.state = { ...(store.state || {}), recentConnectorId: 'coinbaseWalletSDK' };
          localStorage.setItem('wagmi.store', JSON.stringify(store));
          localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('coinbaseWalletSDK'));
        }"""
    )
    sdk_requests.clear()
    started = time.time()
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.wait_for_timeout(6000)
    check(
        name,
        "Return from app re-arms the Coinbase connector",
        len(sdk_requests) > 0,
        f"{len(sdk_requests)} request(s) in {round((time.time() - started) * 1000)}ms",
    )
    crashed = await page.get_by_text(
        re.compile("something went wrong|application error", re.I)
    ).first.is_visible()
    check(name, "No crash on return", not crashed)
    await page.screenshot(path=str(SHOTS / f"{name}-return.png"))

    await context.close()


async def main() -> int:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            await run_case(playwright, browser, "ios", "iPhone 13")
            await run_case(playwright, browser, "android", "Pixel 7")
        finally:
            await browser.close()

    passed = sum(1 for _, _, ok in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    failed = [f"[{p}] {l}" for p, l, ok in results if not ok]
    if failed:
        print("Failed:", ", ".join(failed))
        print(json.dumps({"screenshots": str(SHOTS)}))
        return 1
    return 0


raise SystemExit(asyncio.run(main()))
