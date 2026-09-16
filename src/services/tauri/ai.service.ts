export * from "./ai/contracts";
export * from "./ai/http";
export * from "./ai/cli";

import * as cli from "./ai/cli";
import * as http from "./ai/http";

export const aiService = {
  ...http,
  ...cli,
};
