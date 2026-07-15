import React, { type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

export function mountApp(App: ComponentType) {
  const root = document.getElementById("root");
  if (!root) throw new Error("OxideStudio root element was not found.");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
