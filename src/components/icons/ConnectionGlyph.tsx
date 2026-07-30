import {
  Boxes,
  Cloud,
  Database,
  FileJson,
  HardDrive,
  KeyRound,
  Monitor,
  Search,
  Server,
  type LucideIcon,
} from "lucide-react";
import { defaultConnectionIcon } from "@/lib/databaseDialect";
import type { CSSProperties } from "react";
import { DatabaseBrandIcon } from "./DatabaseBrandIcon";

export const CONNECTION_ICON_OPTIONS = [
  "Database",
  "Monitor",
  "KeyRound",
  "Search",
  "FileJson",
  "Server",
  "HardDrive",
  "Cloud",
  "Boxes",
] as const;

const CONNECTION_ICONS: Record<string, LucideIcon> = {
  Boxes,
  Cloud,
  Database,
  FileJson,
  HardDrive,
  KeyRound,
  Monitor,
  Search,
  Server,
};

interface ConnectionGlyphProps {
  driver: string;
  icon?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function ConnectionGlyph({
  driver,
  icon,
  size = 14,
  className,
  style,
  title,
}: ConnectionGlyphProps) {
  const defaultIcon = defaultConnectionIcon(driver);
  const iconName = icon || defaultIcon;
  if (!icon || icon === defaultIcon) {
    return (
      <DatabaseBrandIcon
        driver={driver}
        size={size}
        className={className}
        style={style}
        title={title}
      />
    );
  }
  const Icon = CONNECTION_ICONS[iconName] || Database;
  return (
    <Icon
      size={size}
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    />
  );
}
