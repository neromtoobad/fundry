// Fork a fund: the new chip runs the parent's chip unchanged (a TapeOut REF) and adds rules on top.
// Only the new gates are etched; 20% of the fork's creator fee goes to the parent chip's holder.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { compileFork, describe, describeFork, step, decode, bytesToHex } from "@fundry/sdk";
import { parseUnits, formatEther, decodeEventLog } from "viem";
import Chip from "../components/Chip.jsx";
import { Seg } from "./Launch.jsx";
import { useAsync } from "../lib/hooks.js";
import { fundSummary, launchInfo, chipTree, tapeoutFee } from "../lib/data.js";
import { factoryAbi } from "../lib/abi.js";
import { deployment } from "../lib/config.js";
import { useWallet } from "../lib/wallet.jsx";

const pctLabel = (v) => `${+(v / 100).toFixed(2)}%`;
const withValue = (opts, v, label) => (opts.some(([x]) => x === v) ? opts : [...opts, [v, label(v)]].sort((a, b) => a[0] - b[0]));
const LEVEL = ["out", "low", "medium", "high"];

export default function Fork() {
  const { address } = useParams();
  const w = useWallet();
  const { data: fee } = useAsync(tapeoutFee, []);
  const parentQ = useAsync(async () => {
    const f = await fundSummary(address, await launchInfo(address));
    const chip = await chipTree(f.circuitId);
    return { f, chip };
  }, [address]);
  const p = parentQ.data;

  const [name, setName] = useState("");
  const [assets, setAssets] = useState(null);
  const [thr, setThr] = useState(null);
  const [allFallingToCash, setCash] = useState(true);
  const [feeBps, setFee] = useState(100);
  const [period, setPeriod] = useState(86_400);
  const [test, setTest] = useState({});
  const [status, setStatus] = useState(null);

  // defaults come from the parent once it's read
  const defaultRules = p?.f.holdings.map((h) => ({ symbol: h.symbol, shift: 0, onDrop: "none", onRise: "none", stop: "none" }));
  const defaultT = p ? { dropBps: p.f.dropBps, riseBps: p.f.riseBps, stopBps: p.f.stopBps } : null;
  const rules = assets ?? defaultRules;
  const t = thr ?? defaultT;
  const setRule = (i, k, v) => setAssets((cur) => (cur ?? defaultRules).map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setT = (k, v) => setThr((cur) => ({ ...(cur ?? defaultT), [k]: v }));

  const rulebook = p && rules && t ? {
    kind: "fork",
    parent: { fund: p.f.address, circuitId: Number(p.f.circuitId), name: p.f.name },
    assets: rules, ...t, allFallingToCash,
  } : null;

  const compiled = useMemo(() => {
    if (!rulebook) return null;
    try {
      const parent = {
        cpu: deployment.circuits.toLowerCase(), circuitId: Number(p.f.circuitId), nIn: p.chip.nIn, nOut: p.chip.nOut,
        nState: p.chip.nState, records: p.chip.records, resolve: p.chip.resolve, totalGates: p.chip.gateCount,
      };
      return { c: compileFork(rulebook, parent), english: describeFork(rulebook) };
    } catch (e) { return { error: e.message }; }
  }, [JSON.stringify(rulebook), p]); // eslint-disable-line react-hooks/exhaustive-deps

  if (parentQ.error) return <p className="err">Couldn’t read the fund: {parentQ.error.shortMessage || parentQ.error.message}</p>;
  if (!p || !rules || !t) return <p className="empty">Reading the parent chip from X Layer…</p>;

  const c = compiled?.c;
  const features = rules.map((r) => test[r.symbol] || { drop: 0, rise: 0, stop: 0 });
  const bits = features.flatMap((x) => [x.drop, x.rise, x.stop]);
  const zero = c ? new Array(c.nState).fill(0) : [];
  const tried = c ? step(decode(c.bytes), c.nIn, c.nOut, bits, zero, c.resolve) : null;
  const levels = tried ? Array.from({ length: rules.length }, (_, i) => tried.outputs[2 * i] | (tried.outputs[2 * i + 1] << 1)) : null;
  const pRun = step(p.chip.records, p.chip.nIn, p.chip.nOut, bits, new Array(p.chip.nState).fill(0), p.chip.resolve);
  const pLevels = Array.from({ length: rules.length }, (_, i) => pRun.outputs[2 * i] | (pRun.outputs[2 * i + 1] << 1));
  const sum = (l) => l.reduce((s, x) => s + x, 0);
  const share = (l, i) => (sum(l) ? `${Math.round((100 * l[i]) / sum(l))}%` : "0%");

  let parentLines = [];
  try { parentLines = p.f.rulebook ? describe(p.f.rulebook) : []; } catch { /* unreadable rulebook */ }

  const symbol = "f" + name.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase();
  const canLaunch = c && name.trim().length > 1 && w.account && fee != null && !["busy", "done"].includes(status?.kind);

  async function launch() {
    setStatus({ kind: "busy", msg: "Etching your gates around the parent chip…" });
    try {
      const rc = await w.write({
        address: deployment.factory, abi: factoryAbi, functionName: "launch", value: fee, gas: 6_000_000n,
        args: [{
          name: name.trim(), symbol, assets: p.f.holdings.map((h) => h.address), netlist: bytesToHex(c.bytes),
          dropBps: t.dropBps, riseBps: t.riseBps, stopBps: t.stopBps, feeBps, period,
          tvlCap: parseUnits("25000", 6), rulebook: JSON.stringify(rulebook), parent: p.f.address,
        }],
      });
      const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); } catch { return null; } })
        .find((e) => e?.eventName === "FundLaunched");
      setStatus({ kind: "done", fund: ev.args.fund, circuitId: ev.args.circuitId });
    } catch (e) { setStatus({ kind: "error", msg: e.shortMessage || e.message }); }
  }

  return (
    <main>
      <section className="stage flat page-head">
        <div className="scene" aria-hidden style={{ backgroundPosition: "60% 40%" }} />
        <div className="reveal">
          <span className="crumb"><Link to="/">LEAGUE</Link> / <Link to={`/fund/${p.f.address}`}>{p.f.symbol}</Link> / FORK</span>
          <h1 className="hero">Fork “{p.f.name}”.</h1>
          <p className="lede" style={{ color: "rgba(255,255,255,.8)", margin: 0 }}>
            Your chip runs chip #{String(p.f.circuitId)} first, untouched, then applies your changes. You only etch your own gates.
            Whoever holds chip #{String(p.f.circuitId)} gets 20% of your creator fee.
          </p>
        </div>
      </section>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <h3>Name</h3>
            <input className="input" placeholder={`e.g. ${p.f.name}, safer`} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
            {name && <div className="mono" style={{ marginTop: 8 }}>SHARE TICKER {symbol}</div>}
          </section>

          <section className="card">
            <h3>What the parent does</h3>
            <ul className="rules">{parentLines.map((l) => <li key={l}>{l}</li>)}</ul>
          </section>

          <section className="card">
            <h3>Your changes, on top</h3>
            {rules.map((r, i) => (
              <div className="rule-row" key={r.symbol}>
                <b style={{ fontSize: 18 }}>{r.symbol}</b>
                <div className="line"><span>Weight vs parent</span>
                  <Seg value={r.shift} onChange={(v) => setRule(i, "shift", v)} options={[[-1, "Less"], [0, "Same"], [1, "More"]]} />
                </div>
                <div className="line"><span>If it falls</span>
                  <Seg value={r.onDrop} onChange={(v) => setRule(i, "onDrop", v)} options={[["none", "Parent decides"], ["half", "Cut to half"], ["zero", "Sell all"]]} />
                </div>
                <div className="line"><span>If it rises</span>
                  <Seg value={r.onRise} onChange={(v) => setRule(i, "onRise", v)} options={[["none", "Parent decides"], ["double", "Double it"]]} />
                </div>
                <div className="line"><span>Stop-loss</span>
                  <Seg value={r.stop} onChange={(v) => setRule(i, "stop", v)} options={[["none", "Parent decides"], ["once", "Sell once"], ["stayOut", "Sell, stay out"]]} />
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <h3>Triggers</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Start at the parent’s. Change them and the parent’s chip sees your triggers too.</p>
            <div className="rule-row" style={{ borderTop: 0, paddingTop: 0 }}>
              <div className="line"><span>“Falls” means</span><Seg value={t.dropBps} onChange={(v) => setT("dropBps", v)} options={withValue([[300, "3%"], [500, "5%"], [800, "8%"], [1000, "10%"]], t.dropBps, pctLabel)} /></div>
              <div className="line"><span>“Rises” means</span><Seg value={t.riseBps} onChange={(v) => setT("riseBps", v)} options={withValue([[300, "3%"], [500, "5%"], [800, "8%"], [1000, "10%"]], t.riseBps, pctLabel)} /></div>
              <div className="line"><span>Stop-loss at</span><Seg value={t.stopBps} onChange={(v) => setT("stopBps", v)} options={withValue([[1000, "−10%"], [1500, "−15%"], [2000, "−20%"], [2500, "−25%"]], t.stopBps, (v) => "−" + pctLabel(v))} /></div>
              <div className="line"><span>All falling</span><Seg value={allFallingToCash} onChange={setCash} options={[[true, "Move to cash"], [false, "Parent decides"]]} /></div>
              <div className="line"><span>Rebalance</span><Seg value={period} onChange={setPeriod} options={[[3600, "Hourly"], [86_400, "Daily"], [604_800, "Weekly"]]} /></div>
              <div className="line"><span>Your fee</span><Seg value={feeBps} onChange={setFee} options={[[0, "0%"], [50, "0.5%"], [100, "1%"], [200, "2%"]]} /><span className="muted" style={{ width: "auto" }}>a year</span></div>
            </div>
          </section>
        </div>

        <aside className="sticky" style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Your chip</h3>
              {c && <span className="mono">{c.ownGates} NEW GATES + CHIP #{String(p.f.circuitId)} ({p.chip.gateCount})</span>}
            </div>
            {c ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Chip netlist={c.bytes} nIn={c.nIn} nOut={c.nOut} size={300} inputs={bits} state={zero} resolve={c.resolve} totalGates={c.totalGates} />
              </div>
            ) : <p className="err">{compiled?.error}</p>}
            {compiled?.english && <ul className="rules" style={{ marginTop: 12 }}>{compiled.english.map((l) => <li key={l}>{l}</li>)}</ul>}
          </section>

          {c && (
            <section className="card">
              <h3>Try it against the parent</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Flip a signal. Both chips run in your browser, gate by gate.</p>
              {rules.map((r, i) => {
                const f = features[i];
                const set = (k) => setTest((x) => ({ ...x, [r.symbol]: { ...f, [k]: f[k] ? 0 : 1 } }));
                return (
                  <div key={r.symbol} className="holding" style={{ gridTemplateColumns: "56px 1fr 120px" }}>
                    <b>{r.symbol}</b>
                    <span className="signals" style={{ margin: 0 }}>
                      {["drop", "rise", "stop"].map((k) => (
                        <button key={k} type="button" className={`sigchip ${f[k] ? "on" : ""}`} onClick={() => set(k)}>{k === "stop" ? "STOP-LOSS" : k.toUpperCase()}</button>
                      ))}
                    </span>
                    <span className="right"><span className="muted">{share(pLevels, i)} →</span> <b>{share(levels, i)}</b></span>
                  </div>
                );
              })}
              <div className="mono" style={{ marginTop: 10 }}>PARENT → YOURS{sum(levels) === 0 ? " · YOURS SAYS: ALL CASH" : ""}</div>
              <div className="mono" style={{ marginTop: 4 }}>{rules.map((r, i) => `${r.symbol} ${LEVEL[levels[i]]}`).join(" · ")}</div>
            </section>
          )}

          <section className="card">
            <dl className="kv" style={{ marginTop: 0 }}>
              <dt>Tape-out fee (TapeOut)</dt><dd>{fee != null ? `${formatEther(fee)} OKB` : "…"}</dd>
              <dt>Gates etched</dt><dd>{c ? `${c.ownGates} (chip #${p.f.circuitId}’s ${p.chip.gateCount} are reused, not re-etched)` : "–"}</dd>
              <dt>Your fee split</dt><dd>half to Fundry; of your half, 80% to you, 20% to chip #{String(p.f.circuitId)}’s holder</dd>
            </dl>
            <button className="pill copper big" style={{ width: "100%", justifyContent: "center", marginTop: 16 }} disabled={!canLaunch} onClick={launch}>
              {status?.kind === "busy" ? "Etching…" : "Etch and launch the fork"}
            </button>
            {!w.account && <div className="mono" style={{ marginTop: 8, textAlign: "center" }}>CONNECT A WALLET TO LAUNCH</div>}
            {status?.kind === "error" && <div className="err">{status.msg}</div>}
            {status?.kind === "busy" && <div className="mono" style={{ marginTop: 8 }}>{status.msg}</div>}
            {status?.kind === "done" && (
              <div className="ok">Launched. Chip #{String(status.circuitId)} is yours. <Link to={`/fund/${status.fund}`}><u>Open your fund</u></Link></div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
