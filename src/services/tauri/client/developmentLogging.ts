import { redactSecrets } from "@/lib/redaction";
import { interceptors } from "./interceptors";

let installed = false;

/** Install redacted diagnostics once when the Vite development runtime is active. */
export function installDevelopmentLogging(): void {
  if (!import.meta.env.DEV || installed) return;
  installed = true;

  interceptors.addRequestInterceptor((command, args) => {
    console.log(`[API Request] ${command}`, redactSecrets(args));
  });

  interceptors.addResponseInterceptor((command, response) => {
    console.log(`[API Response] ${command}`, response);
  });

  interceptors.addErrorInterceptor((command, error) => {
    console.error(`[API Error] ${command}`, error);
  });
}
