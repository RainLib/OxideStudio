import {
  type DataGridDetailNavigationAxis,
  type DataGridDetailNavigationDelta,
} from "@/features/data-grid/model/dataGridDetailNavigation";

export interface ValueEditorTarget {
  key: string;
  columnName: string;
  columnType?: string | null;
  rowLabel: string;
  value: unknown;
  originalValue: unknown;
  editable: boolean;
  nullable: boolean;
  pending: boolean;
  defaultValue?: string | null;
  expression?: string | null;
  expressionAllowed?: boolean;
  readOnlyReason?:
    | "query-result"
    | "generated-column"
    | "hidden-column"
    | "unclassified-column";
}

export interface ValueEditorDialogProps {
  open: boolean;
  target: ValueEditorTarget | null;
  onOpenChange: (open: boolean) => void;
  onStageValue: (value: unknown) => void;
  navigation?: Partial<Record<"up" | "down" | "left" | "right", boolean>>;
  onNavigate?: (
    axis: DataGridDetailNavigationAxis,
    delta: DataGridDetailNavigationDelta,
  ) => void;
}
