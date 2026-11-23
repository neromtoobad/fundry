import { NavLink, Route, Routes, Link } from "react-router-dom";
import League from "./pages/League.jsx";
import Launch from "./pages/Launch.jsx";
import FundPage from "./pages/Fund.jsx";
import WalletButton from "./components/WalletButton.jsx";
import { IS_FORK, deployment, addrUrl } from "./lib/config.js";
import { short } from "./lib/format.js";

export default function App() {
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
          <WalletButton />
        </nav>
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
      </Routes>

      <footer className="foot">
        <span>Fundry · built for X Layer TapeOut Accelerate · <a href="https://github.com/neromtoobad/fundry" target="_blank" rel="noreferrer"><u>source on GitHub</u></a></span>
        {deployment && (
          <span className="mono">
            FACTORY {addrUrl(deployment.factory) ? <a href={addrUrl(deployment.factory)} target="_blank" rel="noreferrer">{short(deployment.factory)}</a> : short(deployment.factory)}
            {" · "}PROCESSOR {short(deployment.circuits)}
          </span>
        )}
      </footer>
    </div>
  );
}
