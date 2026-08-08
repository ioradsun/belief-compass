/**
 * THE SCENE LAB, DRIVEN BY A MACHINE.
 *
 * /testingscene renders the shipped Challenge surfaces against a controlled world
 * and computes whether every side of the story agrees. A person still has to look
 * at it — that is the point of a lab — but the parts a person is worst at checking
 * can be checked here, across every scene and every point of view, in one command:
 *
 *   VERDICT        the page's own oracle. Anything other than "ALL SIDES AGREE" on
 *                  a shipped scene is a product bug, not a fixture bug.
 *   CONSOLE        React errors, and specifically the invalid-markup warnings that
 *                  do not fail a build, do not fail a type check, and break
 *                  hydration in production. The first run of this script found a
 *                  <button> nested inside a <button> on the Challenge card.
 *   NO FIXTURE     a surface asking the lab for data no scene supplies. The lab's
 *                  cache refuses rather than resolving empty, so this surfaces as
 *                  a real failure instead of a calm blank panel.
 *   READ FAILED    the "this is a fault on our side" copy appearing where nothing
 *                  actually failed.
 *
 * It also asserts the oracle CAN go red, by driving the control that puts a fourth
 * Challenge on a three-slot table. A checker that only ever prints green is not
 * evidence of anything.
 *
 * Run:  npx vite dev --host 127.0.0.1 --port 5177
 *       node scripts/check-scene.mjs [port]
 */
import { chromium } from "playwright";

const PORT = process.argv[2] ?? "5177";
const BASE = `http://127.0.0.1:${PORT}/testingscene`;
const SCENES = [
  "quiet",
  "fresh",
  "traction",
  "finished",
  "rivalShowsUp",
  "thin",
  "exited",
  "full",
  "everyoneShowed",
  "nobodyShowed",
  "tookItDown",
  "crowd",
];
const ROLES = ["challenger", "challenged", "bystander"];
const VERDICT = /ALL SIDES AGREE|CHECKS? FAILED/;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().split("\n")[0]);
});

let bad = 0;
console.log("scene          role         verdict            notes");
for (const scene of SCENES) {
  for (const role of ROLES) {
    await page.goto(`${BASE}?scene=${scene}&role=${role}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Does every side of the story agree?", { timeout: 20_000 });
    const verdict = await page.locator(`text=${VERDICT}`).first().innerText();
    const body = await page.locator("body").innerText();
    const notes = [];
    if (verdict !== "ALL SIDES AGREE") notes.push("ORACLE-RED");
    if (/no fixture for/.test(body)) notes.push("NO-FIXTURE");
    if (/Could not load/.test(body)) notes.push("READ-FAILED");
    if (notes.length) bad++;
    console.log(
      `${scene.padEnd(14)} ${role.padEnd(12)} ${verdict.padEnd(18)} ${notes.join(",") || "-"}`,
    );
  }
}

/**
 * A CHALLENGE THAT REACHED THREE PEOPLE MUST BE INVISIBLE TO THE FOURTH. The
 * bystander's rail is mounted on a wallet no scene ever calls, so anything but the
 * quiet sentence is a leak across viewers.
 */
await page.goto(`${BASE}?scene=crowd&role=bystander`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Bystander");
const bystander = await page
  .locator("section", { hasText: "Bystander — somebody it never reached" })
  .first()
  .innerText();
const leaked = bystander.includes("Sarah") || !bystander.includes("Your people are quiet");
console.log(
  `\nbystander panel: ${leaked ? "LEAKED — it can see a Challenge it never received" : "quiet, as it must be"}`,
);
if (leaked) bad++;

// The oracle must be able to go red in the browser, not only in the unit tests.
await page.goto(`${BASE}?scene=traction&role=challenger`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "4 — must fail" }).click();
const red = await page.locator(`text=${VERDICT}`).first().innerText();
console.log(`four on a three-slot table: ${red}`);
if (red === "ALL SIDES AGREE") {
  console.log("  ✕ the oracle stayed green on an impossible world");
  bad++;
}

/**
 * TRANSPORT NOISE IS NOT A PRODUCT BUG. A dev machine without reach to Supabase
 * logs a failed realtime socket on every page in the app, and a checker that
 * failed on it would be red for a reason nobody could act on — which is how a
 * checker gets ignored. Everything else counts, especially React's invalid-markup
 * warnings: they are the class of bug that passes tsc, passes the build, passes
 * the tests, and breaks hydration in front of a person.
 */
const NOISE = /net::ERR_|WebSocket connection|Failed to load resource/;
const unique = [...new Set(errors)];
const real = unique.filter((e) => !NOISE.test(e));
console.log(
  `\nconsole errors: ${real.length} (${unique.length - real.length} ignored as transport noise)`,
);
for (const e of real.slice(0, 20)) console.log("  ✕ " + e);

const ok = bad === 0 && real.length === 0;
console.log(`\n${ok ? "PASS" : "FAIL"}`);
await browser.close();
process.exit(ok ? 0 : 1);
