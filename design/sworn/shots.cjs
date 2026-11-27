// Captures real screenshots of the live site for the X post images.
const puppeteer = require("/Users/mac/Documents/Hacks/tote/video/node_modules/puppeteer-core");
const OUT = __dirname + "/shots/";
const SITE = "https://sworn.nerom.site/#";
const FUND = "0xa0E934066bF5abf29F1AB13128B77c2822a15000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  const byKick = async (text) => page.evaluateHandle((t) => [...document.querySelectorAll("section")].find((s) => s.querySelector(".kick")?.textContent.includes(t)), text);
  const shot = async (handle, name) => { await handle.evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(600); await handle.screenshot({ path: OUT + name + ".png" }); console.log("saved", name); };
  const waitText = (t, ms = 60000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout: ms }, t);

  if (!only || only === "home") {
    await page.goto(SITE + "/", { waitUntil: "networkidle2" });
    await waitText("AI + Market", 60000); await sleep(4000);
    await page.screenshot({ path: OUT + "home-hero.png" }); console.log("saved home-hero");
    const league = await page.evaluateHandle(() => [...document.querySelectorAll("section")].find((s) => s.innerText.includes("Ranked by return")));
    await shot(league, "league");
  }
  if (!only || only === "fund") {
    await page.goto(SITE + "/fund/" + FUND, { waitUntil: "networkidle2" });
    await waitText("Chip Lab", 90000); await sleep(8000);
    await shot(await page.$("section.page-head"), "fund-head");
    const cards = await page.$$("section.card");
    await shot(cards[0], "fund-rules");
    await shot(await byKick("The chip owns the fund"), "owner");
    await shot(await byKick("Family"), "family");
    // Chip Lab: drop NVDA 6% and let the chain confirm
    const lab = await byKick("Chip Lab");
    await page.evaluate(() => [...document.querySelectorAll("#lab .seg button")].find((b) => b.textContent.includes("What if")).click());
    await sleep(800);
    await page.evaluate(() => {
      const r = document.querySelector("#lab input[type=range]");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(r, "-6"); r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitText("Same answer on chain", 90000).catch(() => {}); await sleep(6000);
    await shot(lab, "chiplab");
    // Check it yourself
    const chk = await byKick("Don’t trust us");
    await chk.evaluate((s) => s.querySelector("button").click());
    await page.waitForFunction(() => { const b = document.querySelector("#check button"); return b && !b.disabled && b.textContent.includes("again"); }, { timeout: 180000 }).catch(() => console.log("checks timeout"));
    await sleep(1500);
    await shot(chk, "checks");
  }
  if (only === "extra") {
    await page.goto(SITE + "/fund/" + FUND, { waitUntil: "networkidle2" });
    await waitText("Chip Lab", 90000); await sleep(8000);
    const rules = await page.evaluateHandle(() => [...document.querySelectorAll("section.card")].find((s) => s.textContent.includes("They can’t be changed")));
    await shot(rules, "rules");
    // stop-loss: NVDA 20% below its peak -> stop fires, the latch remembers
    const lab = await byKick("Chip Lab");
    await page.evaluate(() => [...document.querySelectorAll("#lab .seg button")].find((b) => b.textContent.includes("What if")).click());
    await sleep(800);
    await page.evaluate(() => {
      const r = document.querySelectorAll("#lab input[type=range]")[1];
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(r, "20"); r.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(3000);
    await waitText("Same answer on chain", 90000).catch(() => {}); await sleep(4000);
    await shot(lab, "chiplab-stop");
    await page.goto(SITE + "/launch", { waitUntil: "networkidle2" });
    await sleep(4000);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Use the example")).click());
    await sleep(1500);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Fill in the rules")).click());
    await sleep(4000);
    await page.screenshot({ path: OUT + "launch-example.png" }); console.log("saved launch-example");
  }
  if (!only || only === "launch") {
    await page.goto(SITE + "/launch", { waitUntil: "networkidle2" });
    await sleep(5000);
    await page.screenshot({ path: OUT + "launch-top.png" }); console.log("saved launch-top");
  }
  await browser.close();
})();
