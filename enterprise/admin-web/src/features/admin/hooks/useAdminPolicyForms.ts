import { useState } from "react";

export function useAdminPolicyForms() {
  const [grantProjectId, setGrantProjectId] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantDataSourceId, setGrantDataSourceId] = useState("");
  const [grantPath, setGrantPath] = useState("");
  const [grantEffect, setGrantEffect] = useState<"permit" | "forbid">("permit");
  const [grantActions, setGrantActions] = useState<string[]>([
    "resourceDiscover",
    "metadataRead",
    "queryRead",
  ]);
  const [ticketNonce, setTicketNonce] = useState("");
  const [ticketRevocationReason, setTicketRevocationReason] = useState("");

  return {
    grantProjectId,
    setGrantProjectId,
    grantUserId,
    setGrantUserId,
    grantDataSourceId,
    setGrantDataSourceId,
    grantPath,
    setGrantPath,
    grantEffect,
    setGrantEffect,
    grantActions,
    setGrantActions,
    ticketNonce,
    setTicketNonce,
    ticketRevocationReason,
    setTicketRevocationReason,
  };
}
