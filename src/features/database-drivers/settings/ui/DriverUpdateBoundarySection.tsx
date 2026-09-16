import {
  SettingRow,
  SettingsDivider,
} from "@/features/settings/ui/SettingsFields";

export function DriverUpdateBoundarySection() {
  return (
    <>
      <SettingsDivider title="Update boundary" />
      <SettingRow label="Independent updates:">
        <span className="text-[12px] text-[hsl(var(--wb-text))]">
          External sidecar packages use an independent update boundary
        </span>
      </SettingRow>
      <p className="max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Bundled clients remain linked into the application as a recovery
        channel. Offline packages are copied through a bounded staging area,
        reject symbolic links, and are committed only when the manifest
        signature, target, protocol major, and entrypoint digest pass
        validation. Activation keeps one previous version for atomic rollback;
        bundled clients remain the recovery channel.
      </p>
    </>
  );
}
