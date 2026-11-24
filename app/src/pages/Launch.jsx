import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { compile, describe, run, bytesToHex, parseWords } from "@fundry/sdk";
import { parseUnits, formatEther, decodeEventLog } from "viem";
import Chip from "../components/Chip.jsx";
import { useAsync } from "../lib/hooks.js";
import { listedAssets, tapeoutFee, ZERO } from "../lib/data.js";
import { factoryAbi } from "../lib/abi.js";
import { deployment } from "../lib/config.js";
import { useWallet } from "../lib/wallet.jsx";

export const Seg = ({ value, options, onChange }) => (
  <span className="seg">
    {options.map(([v, label]) => (
      <button key={String(v)} type="button" className={v === value ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
    ))}
  </span>
);

// a parsed threshold that isn't one of the preset buttons still shows as its own button
const withValue = (opts, v, label) => (opts.some(([x]) => x === v) ? opts : [...opts, [v, label(v)]].sort((a, b) => a[0] - b[0]));
const pctLabel = (v) => `${+(v / 100).toFixed(2)}%`;

const EXAMPLE = "Hold 60% NVDA and 40% SPY. If NVDA falls 5%, cut it to half. If it rises 8%, double it. Stop-loss 15% on NVDA, and stay out until it recovers. If everything falls, go to cash.";

const newRule = (symbol) => ({ symbol, base: 2, onDrop: "half", onRise: "none", stop: "none" });

export default function Launch() {
  const { data: listed } = useAsync(listedAssets, []);
  const { data: fee } = useAsync(tapeoutFee, []);
  const w = useWallet();

  const [name, setName] = useState("");
  const [rules, setRules] = useState([newRule("NVDA"), { ...newRule("SPY"), onDrop: "none" }]);
  const [dropBps, setDrop] = useState(500);
  const [riseBps, setRise] = useState(500);
  const [stopBps, setStop] = useState(1500);
  const [allFallingToCash, setCash] = useState(true);
  const [period, setPeriod] = useState(86_400);
  const [feeBps, setFee] = useState(100);
  const [test, setTest] = useState({}); // symbol -> {drop, rise, stop}
  const [status, setStatus] = useState(null);
  const [words, setWords] = useState("");
  const [heard, setHeard] = useState(null);

  function applyWords() {
    const r = parseWords(words, (listed || []).map((a) => a.symbol));
    setHeard(r);
    if (!r.rulebook) return;
    const rb = r.rulebook;
    setRules(rb.assets);
    setDrop(rb.dropBps); setRise(rb.riseBps); setStop(rb.stopBps); setCash(rb.allFallingToCash);
  }

  const rulebook = { assets: rules, dropBps, riseBps, stopBps, allFallingToCash };
  const compiled = useMemo(() => {
    try { return { c: compile(rulebook), english: describe(rulebook) }; } catch (e) { return { error: e.message }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rulebook)]);

  const toggle = (symbol) => {
    setRules((rs) => (rs.find((r) => r.symbol === symbol) ? rs.filter((r) => r.symbol !== symbol) : rs.length < 4 ? [...rs, newRule(symbol)] : rs));
  };
  const setRule = (i, k, v) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const total = rules.reduce((s, r) => s + r.base, 0);

  // "Try your chip": run the compiled circuit (same bits as on chain) for the toggled signals
  const features = rules.map((r) => test[r.symbol] || { drop: 0, rise: 0, stop: 0 });
  const tried = compiled.c ? run(compiled.c, features, new Array(compiled.c.nState).fill(0)) : null;
  const testBits = features.flatMap((f) => [f.drop, f.rise, f.stop]);
  const triedTotal = tried ? tried.levels.reduce((s, x) => s + x, 0) : 0;

  const symbol = "f" + name.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase();
  const canLaunch = compiled.c && name.trim().length > 1 && w.account && fee != null && !["busy", "done"].includes(status?.kind);

  async function launch() {
    setStatus({ kind: "busy", msg: "Etching your chip and opening the fund…" });
    try {
      const bySymbol = Object.fromEntries((listed || []).map((a) => [a.symbol, a]));
      const rc = await w.write({
        address: deployment.factory, abi: factoryAbi, functionName: "launch", value: fee, gas: 6_000_000n,
        args: [{
          name: name.trim(), symbol, assets: rules.map((r) => bySymbol[r.symbol].address),
          netlist: bytesToHex(compiled.c.bytes), dropBps, riseBps, stopBps, feeBps, period,
          tvlCap: parseUnits("25000", 6), rulebook: JSON.stringify(rulebook), parent: ZERO,
        }],
      });
      const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); } catch { return null; } })
        .find((e) => e?.eventName === "FundLaunched");
      setStatus({ kind: "done", fund: ev.args.fund, circuitId: ev.args.circuitId });
    } catch (e) {
      setStatus({ kind: "error", msg: e.message });
    }
  }

  return (
    <main>
      <section className="stage flat page-head">
        <div className="scene" aria-hidden style={{ backgroundPosition: "86% 74%" }} />
        <div className="reveal">
          <span className="crumb"><Link to="/">LEAGUE</Link> / LAUNCH A FUND</span>
          <h1 className="hero">Launch a fund.</h1>
          <p className="lede" style={{ color: "rgba(255,255,255,.8)", margin: 0 }}>
            Pick the stocks and set the rules once. Fundry etches them into a chip on X Layer, and they can never be changed, not even by you.
          </p>
        </div>
      </section>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <h3>Write your rules in words <span className="muted" style={{ fontWeight: 500 }}>· optional</span></h3>
            <textarea className="input" rows={4} style={{ resize: "vertical", lineHeight: 1.4 }} placeholder={EXAMPLE} value={words} onChange={(e) => setWords(e.target.value)} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="pill ink sm" disabled={!words.trim()} onClick={applyWords}>Fill in the rules below</button>
              {!words && <button type="button" className="pill sm" onClick={() => setWords(EXAMPLE)}>Use the example</button>}
              <span className="muted" style={{ fontSize: 13 }}>Read by a fixed parser, not an AI. Check the result below before you launch.</span>
            </div>
            {heard && (
              <div style={{ marginTop: 12, fontSize: 14, display: "grid", gap: 4 }}>
                {heard.error && <div className="err" style={{ margin: 0 }}>{heard.error}</div>}
                {heard.understood.map((x) => <div key={"u" + x}><span className="gain">✓</span> {x}</div>)}
                {heard.skipped.map((x) => <div key={"s" + x} className="muted"><span className="loss">✗</span> Didn’t understand: “{x}”. Set it with the buttons below.</div>)}
              </div>
            )}
          </section>

          <section className="card">
            <h3>Name</h3>
            <input className="input" placeholder="e.g. AI + Market" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
            {name && <div className="mono" style={{ marginTop: 8 }}>SHARE TICKER {symbol}</div>}
          </section>

          <section className="card">
            <h3>Stocks <span className="muted" style={{ fontWeight: 500 }}>· up to 4</span></h3>
            <div className="picker">
              {(listed || []).map((a) => {
                const on = rules.some((r) => r.symbol === a.symbol);
                return (
                  <button key={a.symbol} type="button" className={`stock ${on ? "on" : ""}`} disabled={!on && rules.length >= 4} onClick={() => toggle(a.symbol)}>
                    <b>{a.symbol}</b><span className="muted" style={{ fontSize: 13 }}>{a.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h3>Rules for each stock</h3>
            {rules.length === 0 && <p className="muted">Pick at least one stock.</p>}
            {rules.map((r, i) => (
              <div className="rule-row" key={r.symbol}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <b style={{ fontSize: 18 }}>{r.symbol}</b>
                  <span className="mono">NORMALLY {total ? Math.round((100 * r.base) / total) : 0}% OF THE FUND</span>
                </div>
                <div className="line"><span>Normal weight</span>
                  <Seg value={r.base} onChange={(v) => setRule(i, "base", v)} options={[[0, "None"], [1, "Low"], [2, "Medium"], [3, "High"]]} />
                </div>
                <div className="line"><span>If it falls</span>
                  <Seg value={r.onDrop} onChange={(v) => setRule(i, "onDrop", v)} options={[["none", "Keep it"], ["half", "Cut to half"], ["zero", "Sell all"]]} />
                </div>
                <div className="line"><span>If it rises</span>
                  <Seg value={r.onRise} onChange={(v) => setRule(i, "onRise", v)} options={[["none", "Keep it"], ["double", "Double it"]]} />
                </div>
                <div className="line"><span>Stop-loss</span>
                  <Seg value={r.stop} onChange={(v) => setRule(i, "stop", v)} options={[["none", "None"], ["once", "Sell once"], ["stayOut", "Sell, stay out"]]} />
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <h3>Triggers</h3>
            <div className="rule-row" style={{ borderTop: 0, paddingTop: 0 }}>
              <div className="line"><span>“Falls” means</span>
                <Seg value={dropBps} onChange={setDrop} options={withValue([[300, "3%"], [500, "5%"], [800, "8%"], [1000, "10%"]], dropBps, pctLabel)} /><span className="muted" style={{ width: "auto" }}>since last rebalance</span>
              </div>
              <div className="line"><span>“Rises” means</span>
                <Seg value={riseBps} onChange={setRise} options={withValue([[300, "3%"], [500, "5%"], [800, "8%"], [1000, "10%"]], riseBps, pctLabel)} />
              </div>
              <div className="line"><span>Stop-loss at</span>
                <Seg value={stopBps} onChange={setStop} options={withValue([[1000, "−10%"], [1500, "−15%"], [2000, "−20%"], [2500, "−25%"]], stopBps, (v) => "−" + pctLabel(v))} /><span className="muted" style={{ width: "auto" }}>from peak</span>
              </div>
              <div className="line"><span>All falling</span>
                <Seg value={allFallingToCash} onChange={setCash} options={[[true, "Move to cash"], [false, "Follow each rule"]]} />
              </div>
              <div className="line"><span>Rebalance</span>
                <Seg value={period} onChange={setPeriod} options={[[3600, "Hourly"], [86_400, "Daily"], [604_800, "Weekly"]]} />
              </div>
              <div className="line"><span>Your fee</span>
                <Seg value={feeBps} onChange={setFee} options={[[0, "0%"], [50, "0.5%"], [100, "1%"], [200, "2%"]]} /><span className="muted" style={{ width: "auto" }}>a year, half to you</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="sticky" style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Your chip</h3>
              {compiled.c && <span className="mono">{compiled.c.gateCount} GATES · {compiled.c.nState} LATCH · {compiled.c.nIn} IN · {compiled.c.nOut} OUT</span>}
            </div>
            {compiled.c ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Chip netlist={compiled.c.bytes} nIn={compiled.c.nIn} nOut={compiled.c.nOut} size={300} inputs={testBits} state={new Array(compiled.c.nState).fill(0)} />
              </div>
            ) : (
              <p className="err">{compiled.error}</p>
            )}
            {compiled.english && (
              <ul className="rules" style={{ marginTop: 12 }}>
                {compiled.english.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
          </section>

          {compiled.c && (
            <section className="card">
              <h3>Try your chip</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Flip a signal and the circuit above runs, gate by gate, exactly as it will on chain.</p>
              {rules.map((r, i) => {
                const f = features[i];
                const set = (k) => setTest((t) => ({ ...t, [r.symbol]: { ...f, [k]: f[k] ? 0 : 1 } }));
                return (
                  <div key={r.symbol} className="holding" style={{ gridTemplateColumns: "60px 1fr 70px" }}>
                    <b>{r.symbol}</b>
                    <span className="signals" style={{ margin: 0 }}>
                      {["drop", "rise", "stop"].map((k) => (
                        <button key={k} type="button" className={`sigchip ${f[k] ? "on" : ""}`} onClick={() => set(k)}>{k === "stop" ? "STOP-LOSS" : k.toUpperCase()}</button>
                      ))}
                    </span>
                    <span className="num right">{triedTotal ? Math.round((100 * tried.levels[i]) / triedTotal) : 0}%</span>
                  </div>
                );
              })}
              <div className="mono" style={{ marginTop: 10 }}>{triedTotal === 0 ? "THE CHIP SAYS: ALL CASH" : "WEIGHTS THE CHIP WOULD TARGET"}</div>
            </section>
          )}

          <section className="card">
            <dl className="kv" style={{ marginTop: 0 }}>
              <dt>Tape-out fee (TapeOut)</dt><dd>{fee != null ? `${formatEther(fee)} OKB` : "…"}</dd>
              <dt>Transistors used</dt><dd>{compiled.c ? `${compiled.c.gateCount}, from Fundry’s stock` : "–"}</dd>
              <dt>Fund size cap</dt><dd>$25,000</dd>
            </dl>
            <button className="pill copper big" style={{ width: "100%", justifyContent: "center", marginTop: 16 }} disabled={!canLaunch} onClick={launch}>
              {status?.kind === "busy" ? "Etching…" : "Etch and launch"}
            </button>
            {!w.account && <div className="mono" style={{ marginTop: 8, textAlign: "center" }}>CONNECT A WALLET TO LAUNCH</div>}
            {status?.kind === "error" && <div className="err">{status.msg}</div>}
            {status?.kind === "busy" && <div className="mono" style={{ marginTop: 8 }}>{status.msg}</div>}
            {status?.kind === "done" && (
              <div className="ok">
                Launched. Circuit #{String(status.circuitId)} is yours. <Link to={`/fund/${status.fund}`}><u>Open your fund</u></Link>
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
