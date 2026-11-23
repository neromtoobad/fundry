import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
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
