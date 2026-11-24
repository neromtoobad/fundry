import { Link, useNavigate } from "react-router-dom";
import { useAsync } from "../lib/hooks.js";
import { allFunds } from "../lib/data.js";
import { usd, pct, until, ago, short } from "../lib/format.js";
import { deployment, addrUrl, IS_FORK, ASSETS } from "../lib/config.js";
import FundChip from "../components/FundChip.jsx";
import { REPO } from "../App.jsx";

const Arw = () => <span className="arw" aria-hidden>→</span>;

const STEPS = [
  { n: "01", label: "THE RULES", pos: "40% 62%", title: "Pick stocks and write the rules",
    text: "Choose up to four of NVDA, SPY, SpaceX, MSFT, META, gold, BTC and ETH. Say what happens when each one falls, rises or hits a stop-loss, in plain words or with buttons." },
  { n: "02", label: "THE CHIP", pos: "86% 74%", title: "The rules are etched into a chip",
    text: "Fundry compiles the rulebook into NAND and LATCH gates and tapes it out on the Fundry TapeOut processor. You get the chip as an NFT. Nobody can edit it, not even you." },
  { n: "03", label: "THE FUND", pos: "92% 16%", title: "The chip runs the fund",
    text: "Each period anyone can press Rebalance. The fund reads 30-minute TWAP prices, asks the chip for target weights and trades on Uniswap. Every decision is logged on chain." },
];

export default function League() {
  const { data: funds, error, loading } = useAsync(allFunds, [], 20_000);
  const nav = useNavigate();
  const ranked = (funds || []).slice().sort((a, b) => (b.ret ?? -9) - (a.ret ?? -9));
  const tvl = ranked.reduce((s, f) => s + f.nav, 0n);
  const gates = ranked.reduce((s, f) => s + (f.gates || 0), 0);
  const runs = ranked.reduce((s, f) => s + f.rebalanceCount, 0);
  const dash = (v) => (funds ? v : "–");

  return (
    <main>
      <section className="stage home-hero">
        <div className="scene" aria-hidden />
        <div className="reveal">
          <span className="kick">Stock funds · rules on a TapeOut chip</span>
          <h1 className="hero">Launch a stock fund.<br />Its rules are <em>etched in a&nbsp;chip.</em></h1>
          <p className="lede">
            Pick up to four tokenized stocks on X Layer and write the rules in plain words, like “if NVDA falls 5%, cut it
            to half”. Fundry etches them into a TapeOut circuit, so nobody can change them after launch, not even you.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/launch" className="pill light big">Launch a fund <Arw /></Link>
            <a href="#league" className="pill ghost big"
              onClick={(e) => { e.preventDefault(); document.getElementById("league")?.scrollIntoView({ behavior: "smooth" }); }}>
              See the league <Arw />
            </a>
          </div>
        </div>
        <div className="stats">
          <div className="stat"><b>{dash(ranked.length)}</b><span className="mono">Funds {IS_FORK ? "on the fork" : "on mainnet"}</span></div>
          <div className="stat"><b>{dash(usd(tvl, 0))}</b><span className="mono">Money in funds</span></div>
          <div className="stat"><b>{dash(runs)}</b><span className="mono">Rebalances run</span></div>
          <div className="stat"><b>{dash(gates.toLocaleString())}</b><span className="mono">Gates etched</span></div>
        </div>
      </section>

      <section className="sect" id="league">
        <div className="sect-head">
          <div>
            <span className="kick">The league</span>
            <h2 style={{ marginTop: 12 }}>Every fund, ranked.</h2>
            <p>Ranked by return since launch. Each one is a chip on the Fundry processor; open a fund to read its rules and every decision it made.</p>
          </div>
          <Link to="/launch" className="pill ink big">Launch yours <Arw /></Link>
        </div>
        <div className="card" style={{ padding: "18px 12px 6px" }}>
          {error && <p className="err" style={{ padding: "0 14px" }}>Couldn’t read the chain: {error.shortMessage || error.message}</p>}
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
                        <div className="chipthumb"><FundChip circuitId={f.circuitId} size={52} label={false} /></div>
                        <div>
                          <div className="fund-name">{f.name}</div>
                          <div className="mono" style={{ marginTop: 3 }}>Chip #{String(f.circuitId)} · {f.gates} gates · launched {ago(f.launchedAt, f.now)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm">
                      <div className="tags">{f.holdings.map((h) => <span key={h.address} className="tag">{h.symbol}</span>)}</div>
                    </td>
                    <td className={`right num ${f.ret == null ? "muted" : f.ret >= 0 ? "gain" : "loss"}`}>{f.ret == null ? "–" : pct(f.ret)}</td>
                    <td className="right num hide-sm">{f.navUnavailable ? "–" : usd(f.nav, 0)}</td>
                    <td className="right num hide-sm">{f.rebalanceCount}</td>
                    <td className="right hide-sm muted">{f.supply > 0n ? until(f.nextRebalanceAt, f.now) : "after 1st deposit"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="sect" id="how">
        <div className="sect-head">
          <div>
            <span className="kick">How it works</span>
            <h2 style={{ marginTop: 12 }}>Three steps, all on X Layer.</h2>
          </div>
        </div>
        <div className="how">
          {STEPS.map((s) => (
            <div className="card" key={s.n}>
              <div className="shot" style={{ backgroundPosition: s.pos }}><b>{s.n} · {s.label}</b></div>
              <div className="body"><h3>{s.title}</h3><p>{s.text}</p></div>
            </div>
          ))}
        </div>
      </section>

      {deployment && (
        <section className="sect">
          <div className="card dark proof">
            <div>
              <span className="kick" style={{ color: "rgba(255,255,255,.7)" }}>Proof</span>
              <h2 style={{ marginTop: 12 }}>Check it on chain.</h2>
              <p>
                Fundry runs on its own TapeOut processor, created through the TapeOut factory with the BEM fee paid. Every fund is a
                circuit on it, and every rebalance calls <code>Circuits.step</code>. The contract source is verified on Sourcify.
              </p>
              <a className="pill ghost" href={`${REPO}/blob/main/JUDGES.md`} target="_blank" rel="noreferrer">Read the 5-minute check <Arw /></a>
            </div>
            <dl>
              {[
                ["FUNDRY FACTORY", deployment.factory],
                ["FUNDRY PROCESSOR", deployment.circuits],
                ["TRANSISTORS", deployment.transistors],
                ["TAPEOUT FACTORY", deployment.tapeout],
              ].map(([k, a]) => (
                <FragmentRow key={k} k={k} a={a} />
              ))}
              <dt>STOCKS LISTED</dt><dd>{ASSETS.map((a) => a.symbol).join(" · ")}</dd>
              {!IS_FORK && (<><dt>SOURCE</dt><dd><a href={`https://repo.sourcify.dev/196/${deployment.factory}`} target="_blank" rel="noreferrer">Sourcify · exact match</a></dd></>)}
            </dl>
          </div>
        </section>
      )}
    </main>
  );
}

function FragmentRow({ k, a }) {
  const u = addrUrl(a);
  return (
    <>
      <dt>{k}</dt>
      <dd>{u ? <a href={u} target="_blank" rel="noreferrer">{short(a)}</a> : short(a)}</dd>
    </>
  );
}
