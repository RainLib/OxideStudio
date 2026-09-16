import { lazy } from "react";

export const loadSchemaStructuredDraftDialog = () =>
  import("@/components/workspace/SchemaStructuredDraftDialog");

export const SchemaStructuredDraftDialog = lazy(() =>
  loadSchemaStructuredDraftDialog().then((module) => ({
    default: module.SchemaStructuredDraftDialog,
  })),
);
