export * from "./schema/catalog";
export * from "./schema/documents";
export * from "./schema/relations";
export * from "./schema/snapshots";

import * as catalog from "./schema/catalog";
import * as documents from "./schema/documents";
import * as relations from "./schema/relations";
import * as snapshots from "./schema/snapshots";

export const schemaService = {
  ...catalog,
  ...documents,
  ...relations,
  ...snapshots,
};
