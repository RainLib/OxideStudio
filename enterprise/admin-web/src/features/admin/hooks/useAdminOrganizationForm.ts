import { useState } from "react";

export function useAdminOrganizationForm() {
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");

  return {
    organizationName,
    setOrganizationName,
    organizationSlug,
    setOrganizationSlug,
  };
}
