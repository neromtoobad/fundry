import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describe, hexToBytes, unpackBits } from "@fundry/sdk";
import { parseUnits, formatUnits } from "viem";
import { useAsync } from "../lib/hooks.js";
import { fundSummary, launches, preview, decisionLog, balanceOf, client } from "../lib/data.js";
import { fundAbi, erc20Abi } from "../lib/abi.js";
import { assetByAddress, txUrl, addrUrl, USDG } from "../lib/config.js";
import { usd, pct, bps, short, until, date, ago } from "../lib/format.js";
import { useWallet } from "../lib/wallet.jsx";
import FundChip from "../components/FundChip.jsx";

const bitsOf = (hex, n) => unpackBits(hexToBytes(hex || "0x"), n);
const SIG = ["DROP", "RISE", "STOP-LOSS"];
const LEVEL = ["out", "low", "medium", "high"];

function TxLink({ hash, children }) {
  const u = txUrl(hash);
  return u ? <a href={u} target="_blank" rel="noreferrer"><u>{children}</u></a> : <span title={hash}>{children}</span>;
}

export default function FundPage() {
  const { address } = useParams();
  const w = useWallet();
  const fund = useAsync(async () => fundSummary(address, (await launches())[address.toLowerCase()] || {}), [address], 20_000);
  const pv = useAsync(() => preview(address), [address], 20_000);
  const log = useAsync(() => decisionLog(address, fund.data?.launchBlock), [address, fund.data?.launchBlock != null]);
  const f = fund.data;
  const reloadAll = () => { fund.reload(); pv.reload(); log.reload(); };

  if (fund.error && !f) return <p className="err">Couldn’t read this fund: {fund.error.shortMessage || fund.error.message}</p>;
  if (!f) return <p className="empty">Reading the fund from X Layer…</p>;

  const n = f.holdings.length;
  const rb = f.rulebook;
  const english = rb ? (() => { try { return describe(rb); } catch { return null; } })() : null;
  const inputs = pv.data ? bitsOf(pv.data.inputs, 3 * n) : null;
  const state = bitsOf(f.latchState, 8);
  const levels = pv.data?.levels;
  const levelSum = levels ? levels.reduce((s, x) => s + x, 0) : 0;
  const now = f.now;
  const due = now >= f.nextRebalanceAt && f.supply > 0n;

  return (
    <main>
      <div className="mono" style={{ marginBottom: 8 }}><Link to="/">LEAGUE</Link> / {f.symbol}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="hero" style={{ fontSize: "clamp(40px,6vw,72px)", margin: "8px 0 10px" }}>{f.name}</h1>
          <div className="mono">
            CIRCUIT #{String(f.circuitId)} · {f.gates} GATES · {rb ? rb.assets.filter((a) => a.stop === "stayOut").length : "?"} LATCH ·
            {" "}LOCKED SINCE BLOCK {f.launchBlock ? Number(f.launchBlock).toLocaleString() : "?"} · CREATOR{" "}
            {addrUrl(f.creator) ? <a href={addrUrl(f.creator)} target="_blank" rel="noreferrer">{short(f.creator)}</a> : short(f.creator)}
          </div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 24, alignItems: "start" }}>
        <section className="card">
          <span className="mono">VALUE OF ONE SHARE</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
            <span className="bigval">${f.sharePrice.toFixed(4)}</span>
            <span className={`num ${f.ret >= 0 ? "gain" : "loss"}`} style={{ fontSize: 20 }}>{pct(f.ret)} since launch</span>
          </div>
          <dl className="kv" style={{ marginTop: 18 }}>
            <dt>Fund size</dt><dd>{usd(f.nav)}</dd>
            <dt>Cash (USDG)</dt><dd>{usd(f.cash)}</dd>
            <dt>Rebalances run</dt><dd>{f.rebalanceCount}</dd>
            <dt>Rebalances</dt><dd>every {f.period >= 604800 ? "week" : f.period >= 86400 ? "day" : "hour"}</dd>
            <dt>Fee</dt><dd>{bps(f.feeBps)} a year</dd>
            <dt>Size cap</dt><dd>{usd(f.tvlCap, 0)}</dd>
          </dl>
          <h3 style={{ marginTop: 24 }}>Holdings</h3>
          {f.holdings.map((h, i) => {
            const weight = f.nav > 0n ? Number((h.value * 10000n) / f.nav) / 10000 : 0;
            const target = levels && levelSum ? levels[i] / levelSum : 0;
            return (
              <div className="holding" key={h.address}>
                <b>{h.symbol}</b>
                <div>
                  <div className="bar"><i style={{ width: `${weight * 100}%` }} />{levels && <s style={{ left: `calc(${target * 100}% - 1px)` }} title="Target from the chip" />}</div>
                  <div className="mono" style={{ marginTop: 4 }}>
                    {Number(formatUnits(h.balance, h.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} {h.token} · ${(Number(h.price) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} each
                  </div>
                </div>
                <span className="num right">{(weight * 100).toFixed(1)}%</span>
              </div>
            );
          })}
          <div className="mono" style={{ marginTop: 8 }}>BAR = NOW · COPPER LINE = WHAT THE CHIP WANTS NEXT · PRICES ARE 30-MIN TWAPS</div>
        </section>

        <InvestCard f={f} w={w} onDone={reloadAll} />
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="rules-grid">
          <div>
            <FundChip circuitId={f.circuitId} size={320} inputs={inputs} state={state} />
            <div className="mono" style={{ marginTop: 8 }}>LIVE FROM CHAIN: DARK GATES CARRY A 1 FOR TODAY’S PRICES</div>
          </div>
          <div>
            <h2>The rules</h2>
            <p className="muted" style={{ marginTop: 0 }}>Compiled into the chip at launch. They can’t be changed.</p>
            {english ? <ul className="rules">{english.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="muted">Rulebook text unavailable.</p>}
            <h3 style={{ marginTop: 24 }}>What the chip sees right now</h3>
            {inputs ? f.holdings.map((h, i) => (
              <div className="holding" key={h.address} style={{ gridTemplateColumns: "70px 1fr 120px" }}>
                <b>{h.symbol}</b>
                <span className="signals" style={{ margin: 0 }}>
                  {SIG.map((s, k) => <span key={s} className={`sigchip ${inputs[3 * i + k] ? "on" : ""}`}>{s}</span>)}
                </span>
                <span className="right">{levelSum ? `${Math.round((100 * levels[i]) / levelSum)}% target` : "cash"}</span>
              </div>
            )) : <p className="muted">Reading…</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <RebalanceButton f={f} w={w} due={due} onDone={reloadAll} />
              <span className="muted">{due ? "Due now. Anyone can run it." : f.supply === 0n ? "Waiting for the first investor." : `Next rebalance ${until(f.nextRebalanceAt, now)}.`}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Decision log</h2>
        <p className="muted" style={{ marginTop: 0 }}>Every rebalance: what the chip saw, what it decided, and the trades. Read from the fund’s events on chain.</p>
        {log.loading && !log.data && <p className="muted">Reading events…</p>}
        {log.data && log.data.rebalances.length === 0 && <p className="muted">No rebalances yet.</p>}
        {log.data?.rebalances.map((r) => <LogItem key={r.tx} r={r} f={f} />)}
        {log.data?.flows.length > 0 && (
          <>
            <h3 style={{ marginTop: 28 }}>Money in and out</h3>
            {log.data.flows.slice(0, 12).map((x) => (
              <div key={x.tx + x.kind} className="holding" style={{ gridTemplateColumns: "110px 1fr 140px" }}>
                <span className="muted">{ago(x.time, now)}</span>
                <span>{short(x.who)} {x.kind === "deposit" ? "invested" : "withdrew their share"}</span>
                <span className="num right"><TxLink hash={x.tx}>{x.kind === "deposit" ? usd(x.usdgIn) : `${Number(formatUnits(x.shares, 18)).toFixed(2)} shares`}</TxLink></span>
              </div>
            ))}
          </>
        )}
      </section>
    </main>
  );
}

function LogItem({ r, f }) {
  const n = f.holdings.length;
  const bits = bitsOf(r.inputs, 3 * n);
  const lv = r.levels.map(Number);
  const sum = lv.reduce((s, x) => s + x, 0);
  const sym = (a) => (a.toLowerCase() === USDG.toLowerCase() ? "USDG" : assetByAddress[a.toLowerCase()]?.symbol || short(a));
  const amt = (a, v) => {
    if (a.toLowerCase() === USDG.toLowerCase()) return usd(v);
    const d = assetByAddress[a.toLowerCase()]?.decimals ?? 18;
    return `${Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${sym(a)}`;
  };
  return (
    <div className="log-item">
      <div>
        <div style={{ fontWeight: 700 }}>Rebalance #{r.n}</div>
        <div className="mono">{date(r.time).toUpperCase()}</div>
        <div className="mono"><TxLink hash={r.tx}>TX {short(r.tx)}</TxLink></div>
      </div>
      <div>
        {f.holdings.map((h, i) => {
          const sig = SIG.filter((_, k) => bits[3 * i + k]);
          return (
            <div key={h.address} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "4px 0" }}>
              <b style={{ width: 54 }}>{h.symbol}</b>
              <span className="mono" style={{ width: 92 }}>${(Number(r.prices[i]) / 1e6).toFixed(2)}</span>
              {sig.length ? sig.map((s) => <span key={s} className="sigchip on">{s}</span>) : <span className="sigchip">NO SIGNAL</span>}
              <span>→ {LEVEL[lv[i]]}{sum ? `, ${Math.round((100 * lv[i]) / sum)}%` : ""}</span>
            </div>
          );
        })}
        {sum === 0 && <div style={{ margin: "6px 0" }}>→ The chip moved the whole fund to cash.</div>}
        <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>
          {r.trades.length ? r.trades.map((t, k) => <div key={k}>Swapped {amt(t.tokenIn, t.amountIn)} for {amt(t.tokenOut, t.amountOut)}</div>) : "No trades needed: already on target."}
        </div>
        <div className="mono" style={{ marginTop: 6 }}>FUND SIZE {usd(r.navBefore)} → {usd(r.navAfter)}</div>
      </div>
    </div>
  );
}

function RebalanceButton({ f, w, due, onDone }) {
  const [st, setSt] = useState(null);
  return (
    <span>
      <button className="pill copper" disabled={!due || !w.account || st === "busy"}
        onClick={async () => {
          setSt("busy");
          try { await w.write({ address: f.address, abi: fundAbi, functionName: "rebalance", gas: 3_000_000n }); setSt(null); onDone(); }
          catch (e) { setSt(e.message); }
        }}>
        {st === "busy" ? "Rebalancing…" : "Rebalance now"}
      </button>
      {st && st !== "busy" && <div className="err">{st}</div>}
    </span>
  );
}

function InvestCard({ f, w, onDone }) {
  const [tab, setTab] = useState("invest");
  const [amount, setAmount] = useState("");
  const [st, setSt] = useState(null);
  const me = useAsync(async () => {
    if (!w.account) return null;
    const [usdg, shares] = await Promise.all([balanceOf(USDG, w.account), client.readContract({ address: f.address, abi: fundAbi, functionName: "balanceOf", args: [w.account] })]);
    return { usdg, shares };
  }, [w.account, f.address, f.nav], 0);
  const mine = me.data;
  const myValue = mine && f.supply > 0n ? (mine.shares * f.nav) / f.supply : 0n;

  async function invest() {
    setSt({ busy: "Approving USDG…" });
    try {
      const amt = parseUnits(amount || "0", 6);
      const allowance = await client.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [w.account, f.address] });
      if (allowance < amt) await w.write({ address: USDG, abi: erc20Abi, functionName: "approve", args: [f.address, amt] });
      setSt({ busy: "Investing…" });
      const expected = f.supply > 0n && f.nav > 0n ? (amt * f.supply) / f.nav : amt * 10n ** 12n;
      await w.write({ address: f.address, abi: fundAbi, functionName: "deposit", args: [amt, (expected * 98n) / 100n], gas: 400_000n });
      setSt({ ok: `Invested ${usd(amt)}.` }); setAmount(""); onDone(); me.reload();
    } catch (e) { setSt({ err: e.message }); }
  }
  async function withdraw() {
    setSt({ busy: "Withdrawing your share…" });
    try {
      await w.write({ address: f.address, abi: fundAbi, functionName: "withdraw", args: [mine.shares, w.account], gas: 600_000n });
      setSt({ ok: "Done. Your slice of every holding is in your wallet." }); onDone(); me.reload();
    } catch (e) { setSt({ err: e.message }); }
  }

  return (
    <section className="card">
      <div style={{ marginBottom: 16 }}>
        <span className="seg">
          <button className={tab === "invest" ? "on" : ""} onClick={() => setTab("invest")}>Invest</button>
          <button className={tab === "withdraw" ? "on" : ""} onClick={() => setTab("withdraw")}>Withdraw</button>
        </span>
      </div>
      {tab === "invest" ? (
        <>
          <label className="mono">AMOUNT (USDG)</label>
          <input className="input" inputMode="decimal" placeholder="100" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} style={{ marginTop: 6 }} />
          {mine && <div className="mono" style={{ marginTop: 6 }}>YOU HAVE {usd(mine.usdg)}</div>}
          <p className="muted" style={{ fontSize: 14 }}>You get shares at today’s value. Your money joins the fund’s cash and is put to work at the next rebalance.</p>
          <button className="pill ink big" style={{ width: "100%", justifyContent: "center" }} disabled={!w.account || !Number(amount) || st?.busy} onClick={invest}>
            {st?.busy || "Invest"}
          </button>
        </>
      ) : (
        <>
          <div className="mono">YOUR SHARE</div>
          <div className="bigval" style={{ fontSize: 40, margin: "6px 0" }}>{usd(myValue)}</div>
          <p className="muted" style={{ fontSize: 14 }}>You get your exact slice of every holding, stocks and cash, straight to your wallet. No prices involved, so it always works.</p>
          <button className="pill ink big" style={{ width: "100%", justifyContent: "center" }} disabled={!w.account || !mine?.shares || st?.busy} onClick={withdraw}>
            {st?.busy || "Withdraw everything"}
          </button>
        </>
      )}
      {!w.account && <div className="mono" style={{ marginTop: 8, textAlign: "center" }}>CONNECT A WALLET FIRST</div>}
      {st?.err && <div className="err">{st.err}</div>}
      {st?.ok && <div className="ok">{st.ok}</div>}
    </section>
  );
}
