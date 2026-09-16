import { useDriverManagement } from "@/features/database-drivers/settings/useDriverManagement";
import { DriverInstallationsSection } from "@/features/database-drivers/settings/ui/DriverInstallationsSection";
import { DriverReferenceCoverageSection } from "@/features/database-drivers/settings/ui/DriverReferenceCoverageSection";
import { DriverRuntimeHealthSection } from "@/features/database-drivers/settings/ui/DriverRuntimeHealthSection";
import { DriverUpdateBoundarySection } from "@/features/database-drivers/settings/ui/DriverUpdateBoundarySection";
import { ManagedJavaRuntimesSection } from "@/features/database-drivers/settings/ui/ManagedJavaRuntimesSection";
import { RemoteSqliteWorkerSection } from "@/features/database-drivers/settings/ui/RemoteSqliteWorkerSection";
import { SignedDriverCatalogSection } from "@/features/database-drivers/settings/ui/SignedDriverCatalogSection";
import { SettingsPanel } from "@/features/settings/ui/SettingsFields";

export function DriverManagementSettings() {
  const controller = useDriverManagement();

  return (
    <SettingsPanel>
      <DriverInstallationsSection {...controller} />
      <DriverRuntimeHealthSection {...controller} />
      <DriverReferenceCoverageSection {...controller} />
      <ManagedJavaRuntimesSection {...controller} />
      <RemoteSqliteWorkerSection {...controller} />
      <SignedDriverCatalogSection {...controller} />
      <DriverUpdateBoundarySection />
    </SettingsPanel>
  );
}
