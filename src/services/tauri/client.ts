/** Stable compatibility entry point for the shared Tauri command client. */
export { normalizeInvokeError } from "./client/errorNormalization";
export { interceptors } from "./client/interceptors";
export { invokeCommand, invokeRawCommand } from "./client/invoke";
export { invokeWithInterceptors } from "./client/invokeWithInterceptors";
export type {
  CommandArguments,
  ErrorInterceptor,
  RequestInterceptor,
  ResponseInterceptor,
} from "./client/contracts";

import { installDevelopmentLogging } from "./client/developmentLogging";

installDevelopmentLogging();
