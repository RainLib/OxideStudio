import { mountApp } from "./bootstrap";

function showStartupError(error: unknown) {
  document.getElementById("app-loader")?.classList.add("has-error");
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const errorElement = document.getElementById("loader-error");
  if (errorElement) errorElement.textContent = message;
}

window.dispatchEvent(new Event("oxide:module-entry-ready"));

try {
  mountApp();
} catch (error) {
    showStartupError(error);
    console.error("Failed to load the OxideStudio application:", error);
}
