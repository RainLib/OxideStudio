function showStartupError(error: unknown) {
  document.getElementById("app-loader")?.classList.add("has-error");
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const errorElement = document.getElementById("loader-error");
  if (errorElement) errorElement.textContent = message;
}

async function bootstrap() {
  try {
    // Mount the small interactive shell without waiting for the workspace,
    // database stores, or the default Explorer. App starts the workspace import
    // in parallel and Suspense swaps it in when it is ready.
    const bootstrapModule = import("./bootstrap");
    const appModule = import("./App");
    const [{ mountApp }, { default: App }] = await Promise.all([
      bootstrapModule,
      appModule,
    ]);
    mountApp(App);
  } catch (error) {
    showStartupError(error);
    throw error;
  }
}

// Dynamic imports yield to the browser, so the inline HTML shell can paint
// without adding an artificial two-frame delay to time-to-interactive.
void bootstrap();
