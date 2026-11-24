import { Link, useNavigate } from "react-router-dom";
import { useAsync } from "../lib/hooks.js";
import { allFunds } from "../lib/data.js";
import { usd, pct, until, ago } from "../lib/format.js";
import FundChip from "../components/FundChip.jsx";

export default function League() {
  const { data: funds, error, loading } = useAsync(allFunds, [], 20_000);
  const nav = useNavigate();
  const ranked = (funds || []).slice().sort((a, b) => (b.ret ?? -9) - (a.ret ?? -9));
  const tvl = ranked.reduce((s, f) => s + f.nav, 0n);
  const gates = ranked.reduce((s, f) => s + (f.gates || 0), 0);
  const runs = ranked.reduce((s, f) => s + f.rebalanceCount, 0);

  return (
    <main>
      <h1 className="hero">
        Launch a stock fund.<br />Its rules are <em>etched in a chip.</em>
      </h1>
      <p className="lede">
        Pick up to four tokenized stocks on X Layer and set plain rules, like “if NVDA falls 5%, cut it to half”. Fundry
        compiles them into a TapeOut circuit, so nobody can change them after launch, not even you. Anyone can invest,
        withdraw their exact share, or run the next rebalance.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link to="/launch" className="pill copper big">Launch a fund</Link>
        <a href="#how" className="pill big">How it works</a>
      </div>

      <div className="stats" style={{ marginTop: 44 }}>
        <div className="stat"><span className="mono">FUNDS</span><b>{funds ? ranked.length : "–"}</b></div>
        <div className="stat"><span className="mono">MONEY IN FUNDS</span><b>{funds ? usd(tvl, 0) : "–"}</b></div>
        <div className="stat"><span className="mono">REBALANCES RUN</span><b>{funds ? runs : "–"}</b></div>
        <div className="stat"><span className="mono">GATES ETCHED</span><b>{funds ? gates.toLocaleString() : "–"}</b></div>
      </div>

      <section className="card" style={{ padding: "22px 12px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 12px 16px", gap: 12, flexWrap: "wrap" }}>
          <h2>The league</h2>
          <span className="mono">RANKED BY RETURN SINCE LAUNCH</span>
        </div>
        {error && <p className="err" style={{ padding: "0 12px" }}>Couldn’t read the chain: {error.shortMessage || error.message}</p>}
        {loading && !funds && <p className="empty">Reading funds from X Layer…</p>}
        {funds && ranked.length === 0 && <p className="empty">No funds yet. <Link to="/launch"><u>Launch the first one.</u></Link></p>}
        {ranked.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>FUND</th><th className="hide-sm">HOLDS</th><th className="right">RETURN</th>
                <th className="right hide-sm">SIZE</th><th className="right hide-sm">REBALANCES</th><th className="right hide-sm">NEXT</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((f, i) => (
                <tr key={f.address} className="row" onClick={() => nav(`/fund/${f.address}`)}>
                  <td className="rank">{String(i + 1).padStart(2, "0")}</td>
                  <td>
                    <div className="fund-cell">
                      <div className="chipthumb"><FundChip circuitId={f.circuitId} size={56} label={false} /></div>
                      <div>
                        <div className="fund-name">{f.name}</div>
                        <div className="mono">CIRCUIT #{String(f.circuitId)} · {f.gates} GATES · LAUNCHED {ago(f.launchedAt, f.now).toUpperCase()}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm">
                    <div className="tags">{f.holdings.map((h) => <span key={h.address} className="tag">{h.symbol}</span>)}</div>
                  </td>
                  <td className={`right num ${f.ret == null ? "muted" : f.ret >= 0 ? "gain" : "loss"}`}>{f.ret == null ? "–" : pct(f.ret)}</td>
                  <td className="right num hide-sm">{f.navUnavailable ? "–" : usd(f.nav, 0)}</td>
                  <td className="right num hide-sm">{f.rebalanceCount}</td>
                  <td className="right hide-sm muted">{until(f.nextRebalanceAt, f.now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="how" style={{ marginTop: 56 }}>
        <h2>How it works</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>Three steps, all on X Layer.</p>
        <div className="grid3">
          <div className="card">
            <span className="mono">01</span>
            <h3 style={{ marginTop: 10 }}>Pick stocks and rules</h3>
            <p className="muted" style={{ margin: 0 }}>Choose up to four of NVDA, SPY, SpaceX, MSFT, META, gold, BTC and ETH. Set what happens when each one falls, rises or hits a stop-loss.</p>
          </div>
          <div className="card">
            <span className="mono">02</span>
            <h3 style={{ marginTop: 10 }}>The rules become a chip</h3>
            <p className="muted" style={{ margin: 0 }}>Fundry compiles your rulebook into NAND and LATCH gates and tapes it out on the Fundry TapeOut processor. You get the chip as an NFT. It can’t be edited.</p>
          </div>
          <div className="card">
            <span className="mono">03</span>
            <h3 style={{ marginTop: 10 }}>The chip runs the fund</h3>
            <p className="muted" style={{ margin: 0 }}>Each period anyone can press “Rebalance”. The fund reads 30-minute TWAP prices, asks the chip for target weights and trades on Uniswap. Every decision is logged.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
