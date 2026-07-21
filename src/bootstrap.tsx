import React, { type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

export function mountApp(Application: ComponentType = App) {
  const root = document.getElementById("root");
  if (!root) throw new Error("OxideStudio root element was not found.");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <Application />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
