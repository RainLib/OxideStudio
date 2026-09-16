import { KeyRound, Plus } from "lucide-react";
import type { AdminOverview } from "../../../api";
import type { AdminSection } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminMembersPanelContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  setDeviceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInviteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  inviteOpen: boolean;
  sendInvitation: (event: React.FormEvent<Element>) => Promise<void>;
  email: string;
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  role: string;
  setRole: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  deviceOpen: boolean;
  registerManagedDevice: (event: React.FormEvent<Element>) => Promise<void>;
  deviceUserId: string;
  setDeviceUserId: React.Dispatch<React.SetStateAction<string>>;
  overview: AdminOverview | null;
  deviceId: string;
  setDeviceId: React.Dispatch<React.SetStateAction<string>>;
  deviceFingerprint: string;
  setDeviceFingerprint: React.Dispatch<React.SetStateAction<string>>;
  deviceName: string;
  setDeviceName: React.Dispatch<React.SetStateAction<string>>;
  transferOrganizationOwnership: (
    memberId: string,
    displayName: string,
  ) => Promise<void>;
  suspendMember: (memberId: string) => Promise<void>;
  activateMember: (memberId: string) => Promise<void>;
  revokeManagedDevice: (userId: string, deviceId: string) => Promise<void>;
}

export function AdminMembersPanel({
  activeSection,
  t,
  setDeviceOpen,
  setInviteOpen,
  inviteOpen,
  sendInvitation,
  email,
  setEmail,
  role,
  setRole,
  loading,
  deviceOpen,
  registerManagedDevice,
  deviceUserId,
  setDeviceUserId,
  overview,
  deviceId,
  setDeviceId,
  deviceFingerprint,
  setDeviceFingerprint,
  deviceName,
  setDeviceName,
  transferOrganizationOwnership,
  suspendMember,
  activateMember,
  revokeManagedDevice,
}: AdminMembersPanelContext) {
  return (
    <section className="module-pane" hidden={activeSection !== "members"}>
      <SectionHeading
        title={t("Members")}
        detail={t(
          "Personal identities keep their local projects when enterprise access changes.",
        )}
        action={
          <div className="header-actions">
            <button
              className="quiet-button"
              onClick={() => setDeviceOpen((value) => !value)}
            >
              <KeyRound size={14} /> {t("Enroll device")}
            </button>
            <button
              className="primary-button"
              onClick={() => setInviteOpen((value) => !value)}
            >
              <Plus size={14} /> {t("Invite member")}
            </button>
          </div>
        }
      />
      {inviteOpen && (
        <form className="inline-form" onSubmit={sendInvitation}>
          <label>
            {t("Verified email")}
            <input
              type="email"
              value={email}
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            {t("Organization role")}
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="member">{t("Member")}</option>
              <option value="administrator">{t("Administrator")}</option>
            </select>
          </label>
          <button className="primary-button" disabled={loading}>
            {t("Send invitation")}
          </button>
        </form>
      )}
      {deviceOpen && (
        <form
          className="inline-form device-enrollment-form"
          onSubmit={registerManagedDevice}
        >
          <label>
            {t("Member")}
            <select
              required
              value={deviceUserId}
              onChange={(event) => setDeviceUserId(event.target.value)}
            >
              <option value="">{t("Select member")}</option>
              {overview?.members
                .filter((member) => member.status === "active")
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Device UUID")}
            <input
              required
              value={deviceId}
              placeholder={t("Desktop enrollment ID")}
              onChange={(event) => setDeviceId(event.target.value)}
            />
          </label>
          <label>
            {t("Client certificate SHA-256")}
            <input
              required
              minLength={64}
              maxLength={64}
              pattern="[A-Fa-f0-9]{64}"
              value={deviceFingerprint}
              onChange={(event) => setDeviceFingerprint(event.target.value)}
            />
          </label>
          <label>
            {t("Device name")}
            <input
              maxLength={128}
              value={deviceName}
              placeholder={t("Optional")}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={loading}>
            {t("Enroll device")}
          </button>
        </form>
      )}
      <div className="table">
        <div className="table-row member-row table-head">
          <span>{t("Member")}</span>
          <span>{t("Role")}</span>
          <span>{t("Status")}</span>
          <span aria-label={t("Actions")} />
        </div>
        {overview?.members.map((member) => (
          <div className="table-row member-row" key={member.id}>
            <span>
              <strong>{member.displayName}</strong>
              <small>{member.email}</small>
            </span>
            <span>{t(member.role)}</span>
            <span className={`status ${member.status}`}>
              {t(member.status)}
            </span>
            <span className="member-actions">
              {overview?.viewerRole === "owner" &&
                member.status === "active" &&
                member.role !== "owner" && (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={loading}
                    onClick={() =>
                      void transferOrganizationOwnership(
                        member.id,
                        member.displayName,
                      )
                    }
                  >
                    {t("Make owner")}
                  </button>
                )}
              <button
                type="button"
                className="quiet-button danger-button"
                disabled={
                  loading ||
                  member.status === "invited" ||
                  (member.status === "active" && member.role === "owner")
                }
                title={
                  member.role === "owner"
                    ? t("Transfer ownership before suspending an owner.")
                    : member.status === "invited"
                      ? t(
                          "An invited member must complete sign-in before it can be managed.",
                        )
                      : undefined
                }
                onClick={() =>
                  void (member.status === "active"
                    ? suspendMember(member.id)
                    : activateMember(member.id))
                }
              >
                {member.status === "active" ? t("Suspend") : t("Reactivate")}
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="device-heading">
        <strong>{t("Managed devices")}</strong>
        <span>
          {t(
            "Revoke stops new tickets immediately; an already issued ticket remains bounded by its 60-second lifetime.",
          )}
        </span>
      </div>
      <div className="table device-table">
        <div className="table-row device-row table-head">
          <span>{t("Device")}</span>
          <span>{t("Owner")}</span>
          <span>{t("Certificate")}</span>
          <span>{t("Status")}</span>
          <span aria-label={t("Actions")} />
        </div>
        {overview?.managedDevices.map((device) => (
          <div
            className="table-row device-row"
            key={`${device.userId}-${device.deviceId}`}
          >
            <span>
              <strong>{device.displayName || t("Managed device")}</strong>
              <small>{device.deviceId}</small>
            </span>
            <span>{device.userDisplayName}</span>
            <code title={device.certificateFingerprint}>
              {device.certificateFingerprint.slice(0, 16)}…
            </code>
            <span className={`status ${device.status}`}>
              {t(device.status)}
            </span>
            <button
              type="button"
              className="quiet-button danger-button"
              disabled={loading || device.status !== "active"}
              onClick={() =>
                void revokeManagedDevice(device.userId, device.deviceId)
              }
            >
              {t("Revoke")}
            </button>
          </div>
        ))}
        {overview?.managedDevices.length === 0 && (
          <div className="empty">
            {t("No managed devices have been enrolled.")}
          </div>
        )}
      </div>
    </section>
  );
}
