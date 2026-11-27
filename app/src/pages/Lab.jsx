// Chip Lab as its own page: pick any fund, move its prices, watch its real chip decide, and see
// TapeOut's evaluator on X Layer return the same bits. Opens on "AI + Market, Safer" (a fork, so
// its chip runs its parent's chip inside it), in "What if…" mode.
import { useState } from "react";
import { Link } from "react-router-dom";
import { hexToBytes, unpackBits } from "@sworn/sdk";
import { useAsync } from "../lib/hooks.js";
import { client, fundSummary, launchInfo, fundName, preview, lineage } from "../lib/data.js";
import { factoryAbi } from "../lib/abi.js";
import { LAB_FUND, deployment } from "../lib/config.js";
import ChipLab from "../components/ChipLab.jsx";
import FundChip from "../components/FundChip.jsx";

const Arw = () => <span className="arw" aria-hidden>→</span>;
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Lab() {
  // names and chips first (cheap), the full fund only for the one being shown
  const list = useAsync(async () => {
    if (!deployment) return [];
    const addrs = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allFunds" });
    return Promise.all(addrs.map(async (a) => {
      const [info, name] = await Promise.all([launchInfo(a), fundName(a)]);
      return { address: a, name, circuitId: info.circuitId, parent: info.parent };
    }));
  }, []);
  const funds = list.data || [];
  const [picked, setPicked] = useState(null);
  const address = (funds.find((x) => same(x.address, picked)) || funds.find((x) => same(x.address, LAB_FUND)) || funds[0])?.address;
  const full = useAsync(async () => (address ? fundSummary(address, await launchInfo(address)) : null), [address]);
  const f = same(full.data?.address, address) ? full.data : null;
  const n = f?.holdings.length ?? 0;
  const pv = useAsync(() => (address ? preview(address) : null), [address]);
  const parents = useAsync(() => (f?.rulebook?.kind === "fork" ? lineage(f.rulebook) : {}), [address, !!f?.rulebook]);
  const live = pv.data ? unpackBits(hexToBytes(pv.data.inputs || "0x"), 3 * n) : null;

  return (
    <main>
      <section className="stage flat page-head">
        <div className="scene" aria-hidden style={{ backgroundPosition: "40% 62%" }} />
        <div className="reveal">
          <span className="crumb"><Link to="/">SWORN</Link> / CHIP LAB</span>
          <h1 className="hero">Move a price.<br />Watch the chip decide.</h1>
          <p className="lede" style={{ color: "rgba(255,255,255,.84)", marginBottom: 22 }}>
            Pick a fund and drag its prices. Its real chip runs gate by gate in your browser, then TapeOut’s own evaluator on
            X Layer answers the same question. Free, and no wallet needed.
          </p>
          <div className="lab-pick" role="tablist" aria-label="Fund">
            {funds.map((x) => (
              <button key={x.address} role="tab" aria-selected={same(x.address, address)} className={same(x.address, address) ? "on" : ""} onClick={() => setPicked(x.address)}>
                <span className="lab-pick-chip"><FundChip circuitId={x.circuitId} size={28} label={false} /></span>
                <span>{x.name}<small>CHIP #{String(x.circuitId)}{x.parent ? " · FORK" : ""}</small></span>
              </button>
            ))}
            {list.loading && !funds.length && <span className="mono">Reading funds from X Layer…</span>}
          </div>
        </div>
      </section>

      {list.error && !funds.length && <p className="err">Couldn’t read the chain: {list.error.shortMessage || list.error.message}</p>}
      {address && !f && <p className="empty">Reading the chip from X Layer…</p>}
      {f && (
        <>
          <ChipLab key={address} f={f} live={live} parents={parents.data} initialMode="what" bare />
          <div className="lab-foot">
            <p className="muted">
              {f.parent
                ? <>This fund is a fork: the outlined block in its chip is its parent’s chip, run unchanged through a TapeOut REF.</>
                : <>Ink tiles are NAND gates, copper tiles are memory. Lit tiles are carrying a 1 for the prices you set.</>}
            </p>
            <Link to={`/fund/${address}`} className="pill sm">Open {f.name} <Arw /></Link>
          </div>
        </>
      )}
    </main>
  );
}
