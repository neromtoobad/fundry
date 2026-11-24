import { useEffect } from "react";
import { NavLink, Route, Routes, Link, useLocation } from "react-router-dom";
import League from "./pages/League.jsx";
import Launch from "./pages/Launch.jsx";
import FundPage from "./pages/Fund.jsx";
import Fork from "./pages/Fork.jsx";
import WalletButton from "./components/WalletButton.jsx";
import { IS_FORK, deployment, addrUrl } from "./lib/config.js";
import { short } from "./lib/format.js";

export const REPO = "https://github.com/neromtoobad/fundry";

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="wrap">
      <header className="top">
        <Link to="/" className="brand" aria-label="Fundry home">
          <span className="brand-mark" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => <i key={i} className={i === 4 ? "c" : ""} />)}
          </span>
          Fundry
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
      {!deployment && <div className="banner">No Fundry deployment found for this chain.</div>}

      <Routes>
        <Route path="/" element={<League />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/fund/:address" element={<FundPage />} />
        <Route path="/fork/:address" element={<Fork />} />
      </Routes>

      <footer className="foot">
        <span>Fundry · built for X Layer TapeOut Accelerate · <a href={REPO} target="_blank" rel="noreferrer"><u>source on GitHub</u></a></span>
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
