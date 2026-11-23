import { useState } from "react";
import { useWallet } from "../lib/wallet.jsx";
import { IS_FORK } from "../lib/config.js";
import { short } from "../lib/format.js";

export default function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (w.account)
    return (
      <span style={{ display: "inline-flex", gap: 6 }}>
        {IS_FORK && (
          <button className="pill sm" disabled={busy} title="Local fork only: adds test OKB and 10,000 test USDG"
            onClick={async () => { setBusy(true); try { await w.forkFaucet(); } finally { setBusy(false); } }}>
            {busy ? "Adding…" : "Get test USDG"}
          </button>
        )}
        <button className="pill sm" onClick={w.disconnect} title="Disconnect">
          {w.kind === "fork-test" ? "Test account " : ""}{short(w.account)}
        </button>
      </span>
    );

  if (!IS_FORK) return <button className="pill ink sm" onClick={w.connect}>Connect wallet</button>;
  return (
    <span style={{ position: "relative" }}>
      <button className="pill ink sm" onClick={() => setOpen((o) => !o)}>Connect</button>
      {open && (
        <span className="card" style={{ position: "absolute", right: 0, top: 44, zIndex: 5, width: 260, padding: 12, display: "grid", gap: 8, boxShadow: "0 8px 30px rgba(13,15,18,.12)" }}>
          <button className="pill" onClick={() => { setOpen(false); w.connect(); }}>Browser wallet</button>
          <button className="pill" onClick={() => { setOpen(false); w.useTestAccount(); }}>Local test account</button>
          <span className="mono">The test account signs with an anvil key and only works on this local fork.</span>
          {w.error && <span className="err">{w.error}</span>}
        </span>
      )}
    </span>
  );
}
