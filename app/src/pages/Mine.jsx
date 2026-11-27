// My funds: for the connected wallet (or any address, read-only), the shares it holds in each fund,
// the chips it holds and the fee they earn, the forks that pay it, and the funds it launched.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { useAsync } from "../lib/hooks.js";
import { allFunds, client } from "../lib/data.js";
import { fundAbi } from "../lib/abi.js";
import { addrUrl } from "../lib/config.js";
import { usd, pct, short } from "../lib/format.js";
import { useWallet } from "../lib/wallet.jsx";
import FundChip from "../components/FundChip.jsx";

const Arw = () => <span className="arw" aria-hidden>→</span>;
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
// shares are worth nav / supply each
const worth = (shares, f) => (shares && f.supply > 0n ? (shares * f.nav) / f.supply : 0n);
const money = (v) => usd(v, v > 0n && v < 1_000_000n ? 4 : 2);

async function load(who) {
  const funds = await allFunds();
  const shares = await Promise.all(funds.map((f) => client.readContract({ address: f.address, abi: fundAbi, functionName: "balanceOf", args: [who] })));
  const byAddr = Object.fromEntries(funds.map((f) => [f.address.toLowerCase(), f]));
  const held = funds.map((f, i) => ({ f, shares: shares[i], value: worth(shares[i], f) })).filter((x) => x.shares > 0n);
  const chips = funds.filter((f) => same(f.chipOwner || f.creator, who));
  const launched = funds.filter((f) => same(f.creator, who));
  // forks whose parent chip this address holds: they pay it 20% of their holder fee
  const royalties = funds.filter((f) => f.parent && same(byAddr[f.parent.toLowerCase()]?.chipOwner, who));
  return { funds, held, chips, launched, royalties, byAddr };
}

export default function Mine() {
  const w = useWallet();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const lookup = params.get("address");
  const who = lookup && isAddress(lookup) ? lookup : w.account;
  const viewing = !!who && !same(who, w.account);
  const data = useAsync(() => (who ? load(who) : null), [who], 30_000);
  const d = data.data;
  const [input, setInput] = useState("");

  const total = d ? d.held.reduce((s, x) => s + x.value, 0n) : 0n;
  const earned = d ? d.chips.reduce((s, f) => s + worth(f.ownerFeeShares, f), 0n) + d.royalties.reduce((s, f) => s + worth(f.royaltyFeeShares, f), 0n) : 0n;
  const dash = (v) => (d ? v : "–");

  const lookupForm = (
    <form className="lookup" onSubmit={(e) => { e.preventDefault(); if (isAddress(input)) nav(`/me?address=${input}`); }}>
      <input className="input" placeholder="Or look up any address, 0x…" value={input} onChange={(e) => setInput(e.target.value.trim())} aria-label="Address to look up" />
      <button className="pill ink" disabled={!isAddress(input)}>Look up</button>
    </form>
  );

  return (
    <main>
      <section className="stage flat page-head">
        <div className="scene" aria-hidden style={{ backgroundPosition: "92% 16%" }} />
        <div className="reveal">
          <span className="crumb"><Link to="/">SWORN</Link> / MY FUNDS</span>
          <h1 className="hero">{viewing ? "Their funds" : "My funds"}</h1>
          <div className="mono">
            {who ? <>{viewing ? "Viewing " : "Wallet "}{addrUrl(who) ? <a className="u" href={addrUrl(who)} target="_blank" rel="noreferrer">{short(who)}</a> : short(who)}{viewing ? " · read only" : ""}</> : "No wallet connected"}
            {viewing && w.account && <> · <Link className="u" to="/me">back to yours</Link></>}
          </div>
          <div className="headline-num">
            <div><b>{dash(usd(total))}</b><span className="mono">Money in funds</span></div>
            <div><b>{dash(d?.held.length)}</b><span className="mono">Funds held</span></div>
            <div><b>{dash(d?.chips.length)}</b><span className="mono">Chips held</span></div>
            <div><b>{dash(money(earned))}</b><span className="mono">{viewing ? "Fees earned by its chips" : "Fees earned by your chips"}</span></div>
          </div>
        </div>
      </section>

      {!who && (
        <section className="card connect-card">
          <div>
            <h2>See what you own.</h2>
            <p className="muted">Connect a wallet to see your shares in each fund, the chips you hold and the fees they earn. Nothing is signed just to look.</p>
          </div>
          <button className="pill ink big" onClick={w.connect}>Connect wallet <Arw /></button>
          {w.error && <p className="err">{w.error}</p>}
          {lookupForm}
        </section>
      )}

      {who && data.error && !d && <p className="err">Couldn’t read the chain: {data.error.shortMessage || data.error.message}</p>}
      {who && !d && !data.error && <p className="empty">Reading your funds from X Layer…</p>}

      {d && (
        <>
          <section className="sect">
            <div className="sect-head">
              <div>
                <span className="kick">Investments</span>
                <h2 style={{ marginTop: 12 }}>{viewing ? "Shares held." : "Your shares."}</h2>
                <p>Each share is worth the fund’s holdings divided by its shares. Withdraw any time from the fund’s page.</p>
              </div>
            </div>
            <div className="card" style={{ padding: "18px 12px 6px" }}>
              {d.held.length === 0 ? (
                <p className="empty">No shares in any fund yet.{!viewing && <> <Link to="/"><u>Pick one from the league.</u></Link></>}</p>
              ) : (
                <table className="table">
                  <thead><tr><th>FUND</th><th className="right">SHARES</th><th className="right">VALUE</th><th className="right hide-sm">OF THE FUND</th><th className="right hide-sm">FUND SINCE LAUNCH</th></tr></thead>
                  <tbody>
                    {d.held.map(({ f, shares, value }) => (
                      <tr key={f.address} className="row" onClick={() => nav(`/fund/${f.address}`)}>
                        <td><FundCell f={f} /></td>
                        <td className="right num">{(Number(shares) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                        <td className="right num">{f.navUnavailable ? "–" : money(value)}</td>
                        <td className="right num hide-sm">{f.supply > 0n ? `${(Number((shares * 10000n) / f.supply) / 100).toFixed(2)}%` : "–"}</td>
                        <td className={`right num hide-sm ${f.ret == null ? "muted" : f.ret >= 0 ? "gain" : "loss"}`}>{f.ret == null ? "–" : pct(f.ret)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="sect">
            <div className="sect-head">
              <div>
                <span className="kick">Chips</span>
                <h2 style={{ marginTop: 12 }}>{viewing ? "Chips held." : "The chips you hold."}</h2>
                <p>Holding a fund’s chip NFT earns its creator fee. Forks of a chip pay its holder 20% of theirs.</p>
              </div>
              <Link to="/launch" className="pill ink big">Launch a fund <Arw /></Link>
            </div>
            {d.chips.length === 0 && d.royalties.length === 0 ? (
              <div className="card"><p className="empty">{viewing ? "No chips." : "No chips yet. Launch a fund and its chip is yours."}</p></div>
            ) : (
              <div className="chip-grid">
                {d.chips.map((f) => {
                  const forks = d.funds.filter((x) => same(x.parent, f.address));
                  return (
                    <Link key={f.address} to={`/fund/${f.address}`} className="card chip-card">
                      <div className="chip-card-die"><FundChip circuitId={f.circuitId} size={120} label={false} /></div>
                      <div>
                        <span className="mono">CHIP #{String(f.circuitId)} · {f.gates} GATES</span>
                        <h3 style={{ margin: "6px 0 10px" }}>{f.name}</h3>
                        <dl className="kv">
                          <dt>Fee</dt><dd>{(f.feeBps / 100).toFixed(1)}% a year, half to {viewing ? "the holder" : "you"}</dd>
                          <dt>Earned by holders</dt><dd>{money(worth(f.ownerFeeShares, f))}</dd>
                          <dt>{viewing ? "Forks paying it" : "Forks paying you"}</dt><dd>{forks.length}</dd>
                        </dl>
                      </div>
                    </Link>
                  );
                })}
                {d.royalties.filter((f) => !d.chips.some((c) => same(c.address, f.parent))).map((f) => (
                  <Link key={f.address} to={`/fund/${f.address}`} className="card chip-card">
                    <div className="chip-card-die"><FundChip circuitId={f.circuitId} size={120} label={false} /></div>
                    <div>
                      <span className="mono">{viewing ? "FORK PAYING IT" : "FORK PAYING YOU"} · CHIP #{String(f.circuitId)}</span>
                      <h3 style={{ margin: "6px 0 10px" }}>{f.name}</h3>
                      <dl className="kv"><dt>Paid to the parent</dt><dd>{money(worth(f.royaltyFeeShares, f))}</dd></dl>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {d.launched.length > 0 && (
            <section className="sect">
              <div className="sect-head"><div><span className="kick">Launched</span><h2 style={{ marginTop: 12 }}>{viewing ? "Funds launched." : "Funds you launched."}</h2></div></div>
              <div className="card" style={{ padding: "18px 12px 6px" }}>
                <table className="table">
                  <thead><tr><th>FUND</th><th className="right">SIZE</th><th className="right hide-sm">REBALANCES</th><th className="right">CHIP HELD BY</th></tr></thead>
                  <tbody>
                    {d.launched.map((f) => (
                      <tr key={f.address} className="row" onClick={() => nav(`/fund/${f.address}`)}>
                        <td><FundCell f={f} /></td>
                        <td className="right num">{f.navUnavailable ? "–" : usd(f.nav, 0)}</td>
                        <td className="right num hide-sm">{f.rebalanceCount}</td>
                        <td className="right mono">{same(f.chipOwner || f.creator, who) ? (viewing ? "SAME ADDRESS" : "YOU") : short(f.chipOwner)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="sect">{lookupForm}</section>
        </>
      )}
    </main>
  );
}

function FundCell({ f }) {
  return (
    <div className="fund-cell">
      <div className="chipthumb"><FundChip circuitId={f.circuitId} size={52} label={false} /></div>
      <div>
        <div className="fund-name">{f.name}</div>
        <div className="mono" style={{ marginTop: 3 }}>{f.parent ? <span className="fork-mini">FORK</span> : null}Chip #{String(f.circuitId)} · {f.holdings.map((h) => h.symbol).join(" · ")}</div>
      </div>
    </div>
  );
}
