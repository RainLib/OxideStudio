import { LoaderCircle, RefreshCw } from "lucide-react";
import type { AdminAuditEvent } from "../../../api";
import type { AdminLocale } from "../../../i18n";
import type { AdminSection } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminAuditPanelContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  auditLoading: boolean;
  refreshAuditEvents: () => Promise<void>;
  revokeAccessTicket: (event: React.FormEvent<Element>) => Promise<void>;
  ticketNonce: string;
  setTicketNonce: React.Dispatch<React.SetStateAction<string>>;
  ticketRevocationReason: string;
  setTicketRevocationReason: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  auditEvents: AdminAuditEvent[];
  locale: AdminLocale;
}

export function AdminAuditPanel({
  activeSection,
  t,
  auditLoading,
  refreshAuditEvents,
  revokeAccessTicket,
  ticketNonce,
  setTicketNonce,
  ticketRevocationReason,
  setTicketRevocationReason,
  loading,
  auditEvents,
  locale,
}: AdminAuditPanelContext) {
  return (
    <section className="module-pane" hidden={activeSection !== "audit"}>
      <SectionHeading
        title={t("Security audit")}
        detail={t(
          "Review control-plane decisions and revoke a specific managed access ticket when necessary.",
        )}
        action={
          <button
            type="button"
            className="quiet-button"
            disabled={auditLoading}
            onClick={() => void refreshAuditEvents()}
          >
            <RefreshCw
              size={14}
              className={auditLoading ? "spin" : undefined}
            />
            {t("Refresh events")}
          </button>
        }
      />
      <form
        className="inline-form ticket-revocation-form danger-zone"
        onSubmit={revokeAccessTicket}
      >
        <label>
          {t("Ticket nonce")}
          <input
            required
            pattern="[0-9a-fA-F-]{36}"
            placeholder={t("UUID from the access-ticket audit event")}
            value={ticketNonce}
            onChange={(event) => setTicketNonce(event.target.value)}
          />
        </label>
        <label>
          {t("Reason")}
          <input
            required
            maxLength={256}
            placeholder={t("Why this specific ticket is no longer valid")}
            value={ticketRevocationReason}
            onChange={(event) => setTicketRevocationReason(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={loading}>
          {t("Revoke ticket")}
        </button>
      </form>
      <div
        className="audit-list"
        aria-label={t("Recent security audit events")}
      >
        <div className="audit-line audit-head">
          <span>{t("Event")}</span>
          <span>{t("Request / ticket")}</span>
          <span>{t("Action")}</span>
        </div>
        {auditEvents.map((event) => {
          const nonce =
            typeof event.metadata.ticketNonce === "string"
              ? event.metadata.ticketNonce
              : null;
          return (
            <div className="audit-line" key={event.requestId}>
              <span>
                <strong>{event.action}</strong>
                <small>
                  {new Date(event.occurredAt).toLocaleString(locale)} ·{" "}
                  {event.reasonCode}
                </small>
              </span>
              <code>{nonce || event.requestId}</code>
              {nonce ? (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setTicketNonce(nonce)}
                >
                  {t("Use nonce")}
                </button>
              ) : (
                <span
                  className={`status ${event.decision === "permit" ? "active" : "revoked"}`}
                >
                  {t(event.decision)}
                </span>
              )}
            </div>
          );
        })}
        {!auditLoading && auditEvents.length === 0 && (
          <div className="empty">{t("No audit events returned.")}</div>
        )}
        {auditLoading && (
          <div className="loading">
            <LoaderCircle size={15} className="spin" /> {t("Loading events…")}
          </div>
        )}
      </div>
    </section>
  );
}
