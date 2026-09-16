import { type FormEvent } from "react";
import { adminApi } from "../../../api";
import { organizationId } from "../runtime/adminContext";

interface CreateAdminPolicyActionsContext {
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  ticketNonce: string;
  ticketRevocationReason: string;
  setTicketNonce: React.Dispatch<React.SetStateAction<string>>;
  setTicketRevocationReason: React.Dispatch<React.SetStateAction<string>>;
  grantProjectId: string;
  grantUserId: string;
  grantDataSourceId: string;
  grantPath: string;
  grantActions: string[];
  grantEffect: "permit" | "forbid";
  refresh: () => Promise<void>;
}

export function createAdminPolicyActions({
  setLoading,
  setError,
  ticketNonce,
  ticketRevocationReason,
  setTicketNonce,
  setTicketRevocationReason,
  grantProjectId,
  grantUserId,
  grantDataSourceId,
  grantPath,
  grantActions,
  grantEffect,
  refresh,
}: CreateAdminPolicyActionsContext) {
  const revokeAccessTicket = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.revokeAccessTicket(organizationId, {
        nonce: ticketNonce,
        reason: ticketRevocationReason,
      });
      setTicketNonce("");
      setTicketRevocationReason("");
      setLoading(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };
  const createGrant = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.createGrant(organizationId, {
        projectId: grantProjectId,
        principalId: grantUserId,
        dataSourceId: grantDataSourceId || undefined,
        resourcePath: grantPath
          .split("/")
          .map((segment) => segment.trim())
          .filter(Boolean),
        actions: grantActions,
        effect: grantEffect,
      });
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  return { revokeAccessTicket, createGrant };
}
