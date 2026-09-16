import { useEffect } from "react";

interface UseExplorerSchemaVisibilityContext {
  schemaVisibilityStorageKey: string | null;
  setSchemaVisibilityKey: React.Dispatch<React.SetStateAction<string | null>>;
  setShowAllSchemas: React.Dispatch<React.SetStateAction<boolean>>;
  setVisibleSchemaNames: React.Dispatch<React.SetStateAction<string[]>>;
  schemaVisibilityKey: string | null;
  shouldLimitVisibleSchemas: boolean;
  preferredVisibleSchema: string | null;
  showAllSchemas: boolean;
  visibleSchemaNames: string[];
  updateVisibleSchemas: (showAll: boolean, names: string[]) => void;
}

export function useExplorerSchemaVisibility({
  schemaVisibilityStorageKey,
  setSchemaVisibilityKey,
  setShowAllSchemas,
  setVisibleSchemaNames,
  schemaVisibilityKey,
  shouldLimitVisibleSchemas,
  preferredVisibleSchema,
  showAllSchemas,
  visibleSchemaNames,
  updateVisibleSchemas,
}: UseExplorerSchemaVisibilityContext) {
  useEffect(() => {
    if (!schemaVisibilityStorageKey) {
      setSchemaVisibilityKey(null);
      setShowAllSchemas(false);
      setVisibleSchemaNames([]);
      return;
    }

    if (schemaVisibilityKey !== schemaVisibilityStorageKey) {
      let loaded = false;

      try {
        const saved = localStorage.getItem(schemaVisibilityStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            all?: unknown;
            schemas?: unknown;
          };
          setShowAllSchemas(
            shouldLimitVisibleSchemas ? parsed.all === true : true,
          );
          setVisibleSchemaNames(
            Array.isArray(parsed.schemas)
              ? parsed.schemas.filter(
                  (schema): schema is string => typeof schema === "string",
                )
              : [],
          );
          loaded = true;
        }
      } catch (error) {
        console.warn("Failed to restore visible schemas", error);
      }

      if (!loaded) {
        const initialSchemas = preferredVisibleSchema
          ? [preferredVisibleSchema]
          : [];
        setShowAllSchemas(!shouldLimitVisibleSchemas);
        setVisibleSchemaNames(initialSchemas);
        try {
          localStorage.setItem(
            schemaVisibilityStorageKey,
            JSON.stringify({
              all: !shouldLimitVisibleSchemas,
              schemas: initialSchemas,
            }),
          );
        } catch (error) {
          console.warn("Failed to persist initial visible schemas", error);
        }
      }

      setSchemaVisibilityKey(schemaVisibilityStorageKey);
      return;
    }

    if (
      shouldLimitVisibleSchemas &&
      !showAllSchemas &&
      visibleSchemaNames.length === 0 &&
      preferredVisibleSchema
    ) {
      updateVisibleSchemas(false, [preferredVisibleSchema]);
    }
  }, [
    preferredVisibleSchema,
    shouldLimitVisibleSchemas,
    schemaVisibilityKey,
    schemaVisibilityStorageKey,
    showAllSchemas,
    visibleSchemaNames.length,
  ]);
}
