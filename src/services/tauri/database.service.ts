export * from "./database/capabilities";
export * from "./database/administration";

import * as administration from "./database/administration";
import * as capabilities from "./database/capabilities";

export const databaseService = {
  ...capabilities,
  ...administration,
};
