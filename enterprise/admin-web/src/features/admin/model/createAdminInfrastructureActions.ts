import { type FormEvent } from "react";
import type {
  GatewayCertificateRotation,
  GatewayRegistration,
} from "../../../api";
import { adminApi } from "../../../api";
import { organizationId } from "../runtime/adminContext";

interface CreateAdminInfrastructureActionsContext {
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  refresh: () => Promise<void>;
  gatewayName: string;
  gatewayEndpoint: string;
  gatewayCertificateFingerprint: string;
  gatewayEnrollmentPublicKey: string;
  setGatewayName: React.Dispatch<React.SetStateAction<string>>;
  setGatewayEndpoint: React.Dispatch<React.SetStateAction<string>>;
  setGatewayCertificateFingerprint: React.Dispatch<
    React.SetStateAction<string>
  >;
  setGatewayEnrollmentPublicKey: React.Dispatch<React.SetStateAction<string>>;
  setGatewayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGatewayEnrollment: React.Dispatch<
    React.SetStateAction<GatewayRegistration | null>
  >;
  gatewayRotationTarget: string | null;
  gatewayRotationFingerprint: string;
  setGatewayRotation: React.Dispatch<
    React.SetStateAction<GatewayCertificateRotation | null>
  >;
  setGatewayRotationTarget: React.Dispatch<React.SetStateAction<string | null>>;
  setGatewayRotationFingerprint: React.Dispatch<React.SetStateAction<string>>;
  sourceProjectId: string;
  sourceGatewayId: string;
  sourceDriver: string;
  sourceTargetBinding: string;
  sourceName: string;
  setSourceName: React.Dispatch<React.SetStateAction<string>>;
  setSourceTargetBinding: React.Dispatch<React.SetStateAction<string>>;
  setSourceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  renewSourceId: string;
  renewTargetBinding: string;
  setRenewSourceId: React.Dispatch<React.SetStateAction<string>>;
  setRenewTargetBinding: React.Dispatch<React.SetStateAction<string>>;
}

export function createAdminInfrastructureActions({
  setLoading,
  setError,
  refresh,
  gatewayName,
  gatewayEndpoint,
  gatewayCertificateFingerprint,
  gatewayEnrollmentPublicKey,
  setGatewayName,
  setGatewayEndpoint,
  setGatewayCertificateFingerprint,
  setGatewayEnrollmentPublicKey,
  setGatewayOpen,
  setGatewayEnrollment,
  gatewayRotationTarget,
  gatewayRotationFingerprint,
  setGatewayRotation,
  setGatewayRotationTarget,
  setGatewayRotationFingerprint,
  sourceProjectId,
  sourceGatewayId,
  sourceDriver,
  sourceTargetBinding,
  sourceName,
  setSourceName,
  setSourceTargetBinding,
  setSourceOpen,
  renewSourceId,
  renewTargetBinding,
  setRenewSourceId,
  setRenewTargetBinding,
}: CreateAdminInfrastructureActionsContext) {
  const revokeGateway = async (gatewayId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.revokeGateway(organizationId, gatewayId);
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
  const registerGateway = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const registration = await adminApi.registerGateway(
        organizationId,
        gatewayName,
        gatewayEndpoint,
        gatewayCertificateFingerprint,
        gatewayEnrollmentPublicKey,
      );
      setGatewayName("");
      setGatewayEndpoint("");
      setGatewayCertificateFingerprint("");
      setGatewayEnrollmentPublicKey("");
      setGatewayOpen(false);
      setGatewayEnrollment(registration);
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
  const rotateGatewayCertificate = async (event: FormEvent) => {
    event.preventDefault();
    const gatewayId = gatewayRotationTarget;
    if (!gatewayId) return;
    setLoading(true);
    setError(null);
    try {
      const rotation = await adminApi.rotateGatewayCertificate(
        organizationId,
        gatewayId,
        gatewayRotationFingerprint,
      );
      setGatewayRotation(rotation);
      setGatewayRotationTarget(null);
      setGatewayRotationFingerprint("");
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
  const registerDataSource = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.registerDataSource(organizationId, {
        projectId: sourceProjectId,
        gatewayId: sourceGatewayId,
        driver: sourceDriver,
        targetBinding: sourceTargetBinding,
        displayName: sourceName,
        capabilities: ["resourceDiscover", "metadataRead", "queryRead"],
      });
      setSourceName("");
      setSourceTargetBinding("");
      setSourceOpen(false);
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
  const renewDataSourceTargetBinding = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.renewDataSourceTargetBinding(
        organizationId,
        renewSourceId,
        renewTargetBinding,
      );
      setRenewSourceId("");
      setRenewTargetBinding("");
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
    revokeGateway,
    registerGateway,
    rotateGatewayCertificate,
    registerDataSource,
    renewDataSourceTargetBinding,
  };
}
