export type { LspCancellationToken } from "./client/contracts";
export { LspClient } from "./client/LspClient";

import { LspClient } from "./client/LspClient";

export const lspClient = new LspClient();
