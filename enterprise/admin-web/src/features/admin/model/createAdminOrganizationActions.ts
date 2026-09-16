import { type FormEvent } from "react";
import { adminApi } from "../../../api";
import { organizationId } from "../runtime/adminContext";

interface CreateAdminOrganizationActionsContext {
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  refresh: () => Promise<void>;
  organizationSlug: string;
  organizationName: string;
}

export function createAdminOrganizationActions({
  setLoading,
  setError,
  refresh,
  organizationSlug,
  organizationName,
}: CreateAdminOrganizationActionsContext) {
  const setMinimumDesktopVersion = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get(
      "minimumDesktopVersion",
    );
    if (typeof value !== "string") return;
    setLoading(true);
    setError(null);
    try {
      await adminApi.setMinimumDesktopVersion(organizationId, value);
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
  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const organization = await adminApi.createOrganization(
        organizationSlug,
        organizationName,
      );
      sessionStorage.setItem(
        "oxide.enterprise.admin.organization",
        organization.id,
      );
      window.location.assign(
        `${window.location.pathname}?organization=${encodeURIComponent(organization.id)}`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  return { setMinimumDesktopVersion, createOrganization };
}
