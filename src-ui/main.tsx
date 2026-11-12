import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickBar } from "./components/QuickBar";
import "./App.css";

declare global {
  interface Window {
    __XOOK_WINDOW_MODE__?: "main" | "quick";
  }
}

const isQuickWindow =
  window.__XOOK_WINDOW_MODE__ === "quick" ||
  new URLSearchParams(window.location.search).get("mode") === "quick";

if (isQuickWindow) {
  document.documentElement.dataset.windowMode = "quick";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isQuickWindow ? <QuickBar /> : <App />}
  </React.StrictMode>,
);
