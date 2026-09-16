import { useState } from "react";
import {
  type GatewayCertificateRotation,
  type GatewayRegistration,
} from "../../../api";

export function useAdminInfrastructureForms() {
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [infrastructureView, setInfrastructureView] = useState<
    "gateways" | "sources"
  >("gateways");
  const [gatewayName, setGatewayName] = useState("");
  const [gatewayEndpoint, setGatewayEndpoint] = useState("");
  const [gatewayCertificateFingerprint, setGatewayCertificateFingerprint] =
    useState("");
  const [gatewayEnrollmentPublicKey, setGatewayEnrollmentPublicKey] =
    useState("");
  const [gatewayEnrollment, setGatewayEnrollment] =
    useState<GatewayRegistration | null>(null);
  const [gatewayRotation, setGatewayRotation] =
    useState<GatewayCertificateRotation | null>(null);
  const [gatewayRotationTarget, setGatewayRotationTarget] = useState<
    string | null
  >(null);
  const [gatewayRotationFingerprint, setGatewayRotationFingerprint] =
    useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceGatewayId, setSourceGatewayId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceDriver, setSourceDriver] = useState("postgres");
  const [sourceTargetBinding, setSourceTargetBinding] = useState("");
  const [renewSourceId, setRenewSourceId] = useState("");
  const [renewTargetBinding, setRenewTargetBinding] = useState("");

  return {
    gatewayOpen,
    setGatewayOpen,
    sourceOpen,
    setSourceOpen,
    infrastructureView,
    setInfrastructureView,
    gatewayName,
    setGatewayName,
    gatewayEndpoint,
    setGatewayEndpoint,
    gatewayCertificateFingerprint,
    setGatewayCertificateFingerprint,
    gatewayEnrollmentPublicKey,
    setGatewayEnrollmentPublicKey,
    gatewayEnrollment,
    setGatewayEnrollment,
    gatewayRotation,
    setGatewayRotation,
    gatewayRotationTarget,
    setGatewayRotationTarget,
    gatewayRotationFingerprint,
    setGatewayRotationFingerprint,
    sourceProjectId,
    setSourceProjectId,
    sourceGatewayId,
    setSourceGatewayId,
    sourceName,
    setSourceName,
    sourceDriver,
    setSourceDriver,
    sourceTargetBinding,
    setSourceTargetBinding,
    renewSourceId,
    setRenewSourceId,
    renewTargetBinding,
    setRenewTargetBinding,
  };
}
