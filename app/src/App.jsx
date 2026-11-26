import { useEffect } from "react";
import { NavLink, Route, Routes, Link, useLocation } from "react-router-dom";
import League from "./pages/League.jsx";
import Launch from "./pages/Launch.jsx";
import FundPage from "./pages/Fund.jsx";
import Fork from "./pages/Fork.jsx";
import WalletButton from "./components/WalletButton.jsx";
import { IS_FORK, deployment, addrUrl } from "./lib/config.js";
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
          <NavLink to="/launch">Launch a fund</NavLink>
          <a className="hide-nav" href={`${REPO}/blob/main/JUDGES.md`} target="_blank" rel="noreferrer">Proof</a>
          <a className="hide-nav" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
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
        <Route path="/launch" element={<Launch />} />
        <Route path="/fund/:address" element={<FundPage />} />
        <Route path="/fork/:address" element={<Fork />} />
      </Routes>

      <footer className="foot">
        <span>Sworn · built for X Layer TapeOut Accelerate · <a href={REPO} target="_blank" rel="noreferrer"><u>source on GitHub</u></a></span>
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
