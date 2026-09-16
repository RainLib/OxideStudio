import { type AssistantModelStatusKind } from "@/features/assistant-composer/model/modelTypes";
import { AlertTriangle, CircleAlert, LoaderCircle } from "lucide-react";

export function ModelStatusIcon({
  status,
}: {
  status: AssistantModelStatusKind;
}) {
  if (status === "checking") {
    return (
      <LoaderCircle
        size={11}
        className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
      />
    );
  }
  if (status === "authentication-error") {
    return (
      <CircleAlert
        size={11}
        className="shrink-0 text-[hsl(var(--destructive))]"
      />
    );
  }
  if (
    status === "missing" ||
    status === "unavailable" ||
    status === "incompatible"
  ) {
    return <AlertTriangle size={11} className="shrink-0 text-amber-400" />;
  }
  return null;
}
