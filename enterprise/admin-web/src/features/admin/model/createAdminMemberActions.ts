import { type FormEvent } from "react";
import { adminApi } from "../../../api";
import { organizationId } from "../runtime/adminContext";

interface CreateAdminMemberActionsContext {
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  email: string;
  role: string;
  setInviteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  refresh: () => Promise<void>;
  deviceUserId: string;
  deviceId: string;
  deviceFingerprint: string;
  deviceName: string;
  setDeviceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDeviceUserId: React.Dispatch<React.SetStateAction<string>>;
  setDeviceId: React.Dispatch<React.SetStateAction<string>>;
  setDeviceFingerprint: React.Dispatch<React.SetStateAction<string>>;
  setDeviceName: React.Dispatch<React.SetStateAction<string>>;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
}

export function createAdminMemberActions({
  setLoading,
  setError,
  email,
  role,
  setInviteOpen,
  setEmail,
  refresh,
  deviceUserId,
  deviceId,
  deviceFingerprint,
  deviceName,
  setDeviceOpen,
  setDeviceUserId,
  setDeviceId,
  setDeviceFingerprint,
  setDeviceName,
  t,
}: CreateAdminMemberActionsContext) {
  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.invite(organizationId, email, role);
      setInviteOpen(false);
      setEmail("");
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
  const registerManagedDevice = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.registerManagedDevice(organizationId, {
        userId: deviceUserId,
        deviceId,
        certificateFingerprint: deviceFingerprint,
        displayName: deviceName || undefined,
      });
      setDeviceOpen(false);
      setDeviceUserId("");
      setDeviceId("");
      setDeviceFingerprint("");
      setDeviceName("");
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
  const revokeManagedDevice = async (userId: string, deviceId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.revokeManagedDevice(organizationId, { userId, deviceId });
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
  const suspendMember = async (memberId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.suspendMember(organizationId, memberId);
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
  const activateMember = async (memberId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.activateMember(organizationId, memberId);
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
  const transferOrganizationOwnership = async (
    memberId: string,
    displayName: string,
  ) => {
    if (
      !window.confirm(
        t(
          "Transfer organization ownership to {name}? Your owner role will become administrator.",
          { name: displayName },
        ),
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await adminApi.transferOrganizationOwnership(organizationId, memberId);
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

  return {
    sendInvitation,
    registerManagedDevice,
    revokeManagedDevice,
    suspendMember,
    activateMember,
    transferOrganizationOwnership,
  };
}
