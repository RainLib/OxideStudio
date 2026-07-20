import App from "./App";
import { mountApp } from "./bootstrap";

function showStartupError(error: unknown) {
  document.getElementById("app-loader")?.classList.add("has-error");
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const errorElement = document.getElementById("loader-error");
  if (errorElement) errorElement.textContent = message;
}

try {
  // Keep React bootstrap and App in one startup graph instead of waiting for
  // two runtime dynamic-import round trips. The App module starts the workspace
  // chunk immediately; database hydration still begins only after the real
  // workspace has committed.
  mountApp(App);
} catch (error) {
  showStartupError(error);
  throw error;
}
