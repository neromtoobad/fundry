// "Check it yourself": every claim on the fund page, re-checked in the browser from chain data.
import { useState } from "react";
import { keccak256 } from "viem";
import { checkRules, replay, step, hexToBytes, unpackBits, isFork, stateSize } from "@sworn/sdk";
import { chipTree, stepOnChain, decisionLog, lineage, fundOfCircuit } from "../lib/data.js";
import { deployment, txUrl } from "../lib/config.js";
import { REPO } from "../App.jsx";

const tick = () => new Promise((r) => setTimeout(r, 30));
const bitsOf = (hex, n) => unpackBits(hexToBytes(hex || "0x"), n);
function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export default function CheckCard({ f }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const put = (id, row) => setRows((rs) => { const i = rs.findIndex((r) => r.id === id); const next = [...rs]; if (i < 0) next.push({ id, ...row }); else next[i] = { id, ...row }; return next; });

  async function run() {
    setBusy(true); setRows([]);
    try {
      // 1. the chip, as stored on the processor
      put("read", { title: "Read the chip from X Layer", state: "busy" });
      const chip = await chipTree(f.circuitId);
      const own = chip.records.filter((r) => r.op !== "ref").length;
      const refs = chip.records.filter((r) => r.op === "ref");
      put("read", {
        title: "Read the chip from X Layer", state: "ok",
        detail: `Chip #${f.circuitId} on processor ${deployment.circuits.slice(0, 8)}…: ${chip.netlist.length / 2 - 1} bytes, ${own} own gates${refs.length ? ` + ${chip.gateCount - own} reused from chip #${refs[0].id}` : ""}, ${chip.nState} memory bit${chip.nState === 1 ? "" : "s"}. Netlist hash ${keccak256(chip.netlist).slice(0, 18)}…`,
      });
      await tick();

      // 2. for a fork, the parent really is inside
      let parents = {};
      if (isFork(f.rulebook) || refs.length) {
        put("fork", { title: "The parent chip is really inside", state: "busy" });
        parents = await lineage(f.rulebook);
        const pid = Number(f.rulebook?.parent?.circuitId);
        const pFund = await fundOfCircuit(pid);
        const ok = refs.length === 1 && Number(refs[0].id) === pid && refs[0].ins.every((s, k) => s === 2 + k) && pFund?.fund?.toLowerCase() === f.parent?.toLowerCase();
        put("fork", {
          title: "The parent chip is really inside", state: ok ? "ok" : "bad",
          detail: ok
            ? `The netlist’s REF record points at chip #${pid}, wired to this fund’s own price signals. The factory checked the same thing at launch and recorded the parent fund. The parent’s rules run first, unchanged.`
            : "The REF record doesn’t match the parent this fund claims.",
        });
        await tick();
      }

      // 3. the plain-words rules are what's etched
      put("rules", { title: "The rules in words are what’s etched", state: "busy" });
      await tick();
      const parentOf = (p) => parents[Number(p.circuitId)];
      const res = checkRules(chip, f.rulebook, parentOf);
      put("rules", {
        title: "The rules in words are what’s etched",
        state: res.mismatches.length ? "bad" : "ok",
        detail: res.mismatches.length
          ? `${res.mismatches.length} case(s) where the chip and the written rules disagree.`
          : `${res.cases.toLocaleString()} of ${res.cases.toLocaleString()} cases match${res.exhaustive ? ": every combination of price signals and memory" : " (a random sample: there are too many combinations to try them all)"}. The written rules are run as plain code, with no circuit, and compared bit for bit.`,
      });
      await tick();

      // 4. TapeOut's evaluator agrees with this page's evaluator
      put("chain", { title: "TapeOut on X Layer agrees with this page", state: "busy" });
      const r = rng(Number(f.circuitId) + 11);
      const nState = stateSize(chip.records, chip.resolve);
      const cases = Array.from({ length: 12 }, () => ({
        inputs: Array.from({ length: chip.nIn }, () => (r() < 0.4 ? 1 : 0)),
        state: Array.from({ length: nState }, () => (r() < 0.5 ? 1 : 0)),
      }));
      const answers = await Promise.all(cases.map((c) => stepOnChain(f.circuitId, c.state, c.inputs)));
      const agree = cases.filter((c, k) => {
        const mine = step(chip.records, chip.nIn, chip.nOut, c.inputs, c.state, chip.resolve);
        return mine.outputs.every((b, i) => b === answers[k].outputs[i]) && mine.state.every((b, i) => b === answers[k].state[i]);
      }).length;
      put("chain", {
        title: "TapeOut on X Layer agrees with this page", state: agree === cases.length ? "ok" : "bad",
        detail: `${agree} of ${cases.length} random cases: Circuits.step on chain returned the same outputs and memory as the evaluator in your browser.`,
      });
      await tick();

      // 5. every rebalance replays from its prices
      put("replay", { title: "Every decision replays from its prices", state: "busy" });
      const log = await decisionLog(f.address);
      const n = f.holdings.length;
      const rebs = [...log.rebalances].reverse().map((x) => ({
        n: x.n, tx: x.tx, prices: x.prices, inputBits: bitsOf(x.inputs, 3 * n), outputBits: bitsOf(x.outputs, 2 * n), newStateBits: bitsOf(x.newState, nState),
      }));
      const rep = replay(chip, { assets: f.holdings, dropBps: f.dropBps, riseBps: f.riseBps, stopBps: f.stopBps }, rebs);
      const okCount = rep.filter((x) => x.ok).length;
      put("replay", {
        title: "Every decision replays from its prices",
        state: rebs.length === 0 ? "idle" : okCount === rebs.length ? "ok" : "bad",
        detail: rebs.length === 0
          ? "No rebalances yet. Once there are, each one is recomputed here from the prices it logged: price → signals → chip → weights and memory."
          : `${okCount} of ${rebs.length} rebalances: from the logged prices alone, this page recomputed the signals, ran the chip and got the same weights and memory the fund logged.`,
        list: rep.map((x, k) => ({ n: x.n, ok: x.ok, tx: rebs[k].tx })),
      });
    } catch (e) {
      put("err", { title: "A check couldn’t finish", state: "bad", detail: e.shortMessage || e.message });
    }
    setBusy(false);
  }

  return (
    <section className="card" style={{ marginTop: 16 }} id="check">
      <div className="sect-head" style={{ marginBottom: 12 }}>
        <div>
          <span className="kick">Don’t trust us</span>
          <h2 style={{ marginTop: 12 }}>Check it yourself.</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Runs in your browser from chain data only: the chip, the rules written at launch and the fund’s own event log.
            The same checks run from a terminal with <code>node scripts/verify.mjs {f.address.slice(0, 8)}…</code> (<a className="u" href={`${REPO}/blob/main/scripts/verify.mjs`} target="_blank" rel="noreferrer">source</a>).
          </p>
        </div>
        <button className="pill ink big" disabled={busy} onClick={run}>{busy ? "Checking…" : rows.length ? "Run again" : "Run the checks"}</button>
      </div>
      {rows.length > 0 && (
        <ol className="checks">
          {rows.map((r) => (
            <li key={r.id} className={r.state}>
              <span className="ck" aria-hidden>{r.state === "ok" ? "✓" : r.state === "bad" ? "✗" : r.state === "busy" ? "…" : "–"}</span>
              <div>
                <b>{r.title}</b>
                {r.detail && <p>{r.detail}</p>}
                {r.list?.length > 0 && (
                  <div className="signals">
                    {r.list.map((x) => {
                      const u = txUrl(x.tx);
                      const chipEl = <span className={`sigchip ${x.ok ? "on" : ""}`}>#{x.n} {x.ok ? "✓" : "✗"}</span>;
                      return u ? <a key={x.n} href={u} target="_blank" rel="noreferrer">{chipEl}</a> : <span key={x.n}>{chipEl}</span>;
                    })}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
