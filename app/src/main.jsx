import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
// fonts are bundled (not Google Fonts) so the DeWEB copy, which blocks off-chain loads, looks the same
import "@fontsource/inter-tight/latin-400.css";
import "@fontsource/inter-tight/latin-500.css";
import "@fontsource/inter-tight/latin-600.css";
import "@fontsource/inter-tight/latin-700.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./index.css";
import App from "./App.jsx";
import { WalletProvider } from "./lib/wallet.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <WalletProvider>
        <App />
      </WalletProvider>
    </HashRouter>
  </StrictMode>
);
