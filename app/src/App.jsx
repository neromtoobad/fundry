import { useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes, Link, useLocation } from "react-router-dom";
import League from "./pages/League.jsx";
import Launch from "./pages/Launch.jsx";
import FundPage from "./pages/Fund.jsx";
import Fork from "./pages/Fork.jsx";
import How from "./pages/How.jsx";
import Lab from "./pages/Lab.jsx";
import Mine from "./pages/Mine.jsx";
import WalletButton from "./components/WalletButton.jsx";
import { IS_FORK, deployment, addrUrl, DEWEB_NAME, DEWEB_URL, X_URL } from "./lib/config.js";
import { short } from "./lib/format.js";

export const REPO = "https://github.com/neromtoobad/sworn";

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="wrap">
      <header className="top">
        <Link to="/" className="brand" aria-label="Sworn home">
          <svg className="brand-mark" viewBox="0 0 100 100" aria-hidden>
            <rect width="100" height="100" rx="24" fill="#0D0F12" />
            <path d="M70 24H40L29 35v4l11 11h20l11 11v4L60 76H30" fill="none" stroke="#F4EFE6" strokeWidth="10" strokeLinejoin="round" />
            <circle cx="72" cy="24" r="8" fill="#E2591B" /><circle cx="28" cy="76" r="8" fill="#E2591B" />
          </svg>
          <span>Swor<span style={{ marginLeft: "0.045em" }}>n</span></span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>League</NavLink>
          <NavLink to="/how">How it works</NavLink>
          <NavLink to="/lab">Chip Lab</NavLink>
          <NavLink to="/launch">Launch a fund</NavLink>
          <NavLink to="/me">My funds</NavLink>
          <OnChainMenu />
        </nav>
        <span className="sp" />
        <span className="live">{IS_FORK ? "LOCAL FORK OF X LAYER" : "LIVE ON X LAYER MAINNET"}</span>
        <WalletButton />
      </header>

      {IS_FORK && (
        <div className="banner">
          <b>Local fork of X Layer mainnet.</b> Real stock pools, real TapeOut contracts, test money. Nothing here touches mainnet.
        </div>
      )}
      {!deployment && <div className="banner">No Sworn deployment found for this chain.</div>}

      <Routes>
        <Route path="/" element={<League />} />
        <Route path="/how" element={<How />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/me" element={<Mine />} />
        <Route path="/fund/:address" element={<FundPage />} />
        <Route path="/fork/:address" element={<Fork />} />
      </Routes>

      <footer className="foot">
        <span>
          Sworn · built for X Layer TapeOut Accelerate · <a href={REPO} target="_blank" rel="noreferrer"><u>source on GitHub</u></a>
          {" · "}<a href={X_URL} target="_blank" rel="noreferrer"><u>@Swornfund</u></a>
          {!IS_FORK && <>{" · "}<a href={DEWEB_URL} target="_blank" rel="noreferrer"><u>on DeWEB</u></a></>}
        </span>
        {deployment && (
          <span className="mono">
            FACTORY {addrUrl(deployment.factory) ? <a href={addrUrl(deployment.factory)} target="_blank" rel="noreferrer">{short(deployment.factory)}</a> : short(deployment.factory)}
            {" · "}PROCESSOR {addrUrl(deployment.circuits) ? <a href={addrUrl(deployment.circuits)} target="_blank" rel="noreferrer">{short(deployment.circuits)}</a> : short(deployment.circuits)}
          </span>
        )}
      </footer>
    </div>
  );
}

/** "On chain ▾": where Sworn lives outside this page (DeWEB copy, X, contracts, the judges' check). */
function OnChainMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const items = [
    !IS_FORK && { href: DEWEB_URL, title: "Sworn on DeWEB", sub: `This app, stored on X Layer · ${DEWEB_NAME}` },
    { href: X_URL, title: "@Swornfund on X", sub: "Launches, new funds, rebalances" },
    deployment && addrUrl(deployment.factory) && { href: addrUrl(deployment.factory), title: "Sworn factory", sub: `${short(deployment.factory)} · verified on Sourcify` },
    deployment && addrUrl(deployment.circuits) && { href: addrUrl(deployment.circuits), title: "Sworn TapeOut processor", sub: `${short(deployment.circuits)} · every fund is a chip here` },
    { href: `${REPO}/blob/main/JUDGES.md`, title: "The 5-minute check", sub: "Every claim, with how to verify it" },
  ].filter(Boolean);

  return (
    <span className="menu" ref={ref}>
      <button className={`menu-btn${open ? " open" : ""}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        On chain <svg viewBox="0 0 10 6" aria-hidden><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <span className="menu-pop" role="menu">
          {items.map((it) => (
            <a key={it.title} role="menuitem" href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              <b>{it.title} <span aria-hidden>↗</span></b>
              <span className="mono">{it.sub}</span>
            </a>
          ))}
        </span>
      )}
    </span>
  );
}
