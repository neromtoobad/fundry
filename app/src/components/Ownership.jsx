// Idea 2 and 3 on the fund page: the chip NFT owns the fund's creator fee (so a strategy with a
// track record can be sold), and forks pay 20% of their creator fee to the parent chip's holder.
import { useState } from "react";
import { Link } from "react-router-dom";
import { isAddress } from "viem";
import { useAsync } from "../lib/hooks.js";
import { childrenOf, fundSummary, launchInfo, client } from "../lib/data.js";
import { circuitsAbi, fundAbi } from "../lib/abi.js";
import { deployment, addrUrl } from "../lib/config.js";
import { usd, short } from "../lib/format.js";

const Addr = ({ a }) => (addrUrl(a) ? <a className="u" href={addrUrl(a)} target="_blank" rel="noreferrer">{short(a)}</a> : <span title={a}>{short(a)}</span>);
// fee shares are worth what any share is worth: nav / supply
const valueOf = (shares, f) => (shares != null && f.supply > 0n ? (shares * f.nav) / f.supply : 0n);
// fee income is small on young funds: show cents' fractions instead of a flat $0.00
const money = (v) => usd(v, v > 0n && v < 1_000_000n ? 4 : 2);

export function ChipOwnerCard({ f, w, onDone }) {
  const [to, setTo] = useState("");
  const [st, setSt] = useState(null);
  const owner = f.chipOwner || f.creator;
  const mine = w.account && owner && w.account.toLowerCase() === owner.toLowerCase();
  const parentOwner = useAsync(() => (f.parent ? client.readContract({ address: f.address, abi: fundAbi, functionName: "parentOwner" }) : null), [f.address, f.parent]);

  async function transfer() {
    setSt({ busy: "Transferring the chip…" });
    try {
      await w.write({ address: deployment.circuits, abi: circuitsAbi, functionName: "transferFrom", args: [w.account, to, BigInt(f.circuitId)] });
      setSt({ ok: `Chip #${f.circuitId} now belongs to ${short(to)}. From the next fee accrual on, the creator fee goes to them.` }); setTo(""); onDone?.();
    } catch (e) { setSt({ err: e.shortMessage || e.message }); }
  }

  return (
    <section className="card">
      <span className="kick">The chip owns the fund</span>
      <h3 style={{ marginTop: 12 }}>Chip #{String(f.circuitId)} is an NFT. Whoever holds it earns the fee.</h3>
      <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
        The rules can’t change, so the chip is the strategy and its track record. Sell or give away the NFT and the fee goes with it.
        Nobody, not even the holder, can change the rules or touch the investors’ money.
      </p>
      <dl className="kv">
        <dt>Holder now</dt><dd><Addr a={owner} />{mine ? " (you)" : ""}</dd>
        <dt>Launched by</dt><dd><Addr a={f.creator} /></dd>
        <dt>Fee</dt><dd>{(f.feeBps / 100).toFixed(1)}% a year: half to the holder{f.parent ? ", less 20% for the parent" : ""}, half to Sworn</dd>
        <dt>Earned by holders</dt><dd>{money(valueOf(f.ownerFeeShares, f))}</dd>
        {f.parent && <><dt>Paid to the parent</dt><dd>{money(valueOf(f.royaltyFeeShares, f))}{parentOwner.data ? <> to <Addr a={parentOwner.data} /></> : null}</dd></>}
      </dl>
      {mine && (
        <div style={{ marginTop: 16 }}>
          <label className="mono">SEND THE CHIP TO</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input className="input" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} />
            <button className="pill ink" disabled={!isAddress(to) || st?.busy} onClick={transfer}>{st?.busy ? "Sending…" : "Send"}</button>
          </div>
          <div className="mono" style={{ marginTop: 6 }}>A STANDARD ERC-721 TRANSFER ON TAPEOUT’S PROCESSOR. ANY NFT MARKET CAN LIST IT.</div>
        </div>
      )}
      {st?.err && <div className="err">{st.err}</div>}
      {st?.ok && <div className="ok">{st.ok}</div>}
    </section>
  );
}

export function FamilyCard({ f }) {
  const kids = useAsync(async () => {
    const list = await childrenOf(f.address);
    return Promise.all(list.map(async (c) => fundSummary(c, await launchInfo(c))));
  }, [f.address], 60_000);
  const parent = useAsync(async () => (f.parent ? fundSummary(f.parent, await launchInfo(f.parent)) : null), [f.parent]);
  const row = (x, tag) => (
    <Link key={x.address} to={`/fund/${x.address}`} className="family-row">
      <span className="mono">{tag}</span>
      <b>{x.name}</b>
      <span className="muted">chip #{String(x.circuitId)}</span>
      <span className={`num right ${x.ret != null && x.ret < 0 ? "loss" : "gain"}`}>{x.ret == null ? "–" : `${x.ret >= 0 ? "+" : ""}${(x.ret * 100).toFixed(2)}%`}</span>
    </Link>
  );

  return (
    <section className="card">
      <span className="kick">Family</span>
      <h3 style={{ marginTop: 12 }}>{f.parent ? "Built on another fund’s chip." : "Fork this fund."}</h3>
      <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
        A fork keeps this chip inside its own, untouched, through a TapeOut REF, and adds a few rules on top. It only pays for its own gates,
        and 20% of its creator fee goes to whoever holds the parent chip, forever.
      </p>
      <div className="family">
        {parent.data && row(parent.data, "PARENT")}
        {(parent.data || f.parent) && <div className="family-row self"><span className="mono">THIS</span><b>{f.name}</b><span className="muted">chip #{String(f.circuitId)}</span><span /></div>}
        {kids.data?.map((k) => row(k, "FORK"))}
        {kids.data?.length === 0 && !f.parent && <p className="muted" style={{ margin: 0, fontSize: 14 }}>No forks yet.</p>}
      </div>
      <Link to={`/fork/${f.address}`} className="pill copper" style={{ marginTop: 16, display: "inline-flex" }}>Fork this fund</Link>
    </section>
  );
}
