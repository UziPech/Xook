import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
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

const LazyApp = lazy(() => import("./App"));
const LazyQuickBar = lazy(() =>
  import("./components/QuickBar").then((m) => ({ default: m.QuickBar }))
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {isQuickWindow ? <LazyQuickBar /> : <LazyApp />}
    </Suspense>
  </React.StrictMode>,
);
