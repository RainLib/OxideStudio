import { useState } from "react";

export function useAdminMemberForms() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [deviceUserId, setDeviceUserId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceFingerprint, setDeviceFingerprint] = useState("");
  const [deviceName, setDeviceName] = useState("");

  return {
    inviteOpen,
    setInviteOpen,
    deviceOpen,
    setDeviceOpen,
    email,
    setEmail,
    role,
    setRole,
    deviceUserId,
    setDeviceUserId,
    deviceId,
    setDeviceId,
    deviceFingerprint,
    setDeviceFingerprint,
    deviceName,
    setDeviceName,
  };
}
