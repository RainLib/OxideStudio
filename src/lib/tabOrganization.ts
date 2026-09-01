import type {
  TabGroupMode,
  TabPlacement,
  TabSortMode,
} from "@/lib/appSettings";

export type OrganizableTab = {
  id: string;
  title: string;
  isPinned: boolean;
  connectionId?: string;
  createdAt?: number;
};

export type TabConnectionIdentity = {
  id: string;
  name: string;
  driver: string;
};

export type OrganizedTab<T extends OrganizableTab> = {
  tab: T;
  groupKey: string;
  groupLabel: string;
  startsGroup: boolean;
  startsRegularRegion: boolean;
};

const tabCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function connectionIdentityMap(connections: readonly TabConnectionIdentity[]) {
  return new Map(connections.map((connection) => [connection.id, connection]));
}

function tabGroup(
  tab: OrganizableTab,
  groupMode: TabGroupMode,
  connections: ReadonlyMap<string, TabConnectionIdentity>,
) {
  if (groupMode === "none") return { key: "", label: "" };
  const connection = tab.connectionId
    ? connections.get(tab.connectionId)
    : undefined;
  if (groupMode === "connection") {
    return {
      key: connection?.id || tab.connectionId || "~unbound",
      label: connection?.name || tab.connectionId || "No connection",
    };
  }
  return {
    key: connection?.driver || "~unbound",
    label: connection?.driver || "No connection",
  };
}

function organizePartition<T extends OrganizableTab>(
  tabs: readonly T[],
  groupMode: TabGroupMode,
  sortMode: TabSortMode,
  connections: ReadonlyMap<string, TabConnectionIdentity>,
) {
  const earliestKnownCreation = tabs.reduce(
    (earliest, tab) =>
      typeof tab.createdAt === "number" && Number.isFinite(tab.createdAt)
        ? Math.min(earliest, tab.createdAt)
        : earliest,
    Number.POSITIVE_INFINITY,
  );
  const legacyCreationBase =
    (Number.isFinite(earliestKnownCreation)
      ? earliestKnownCreation
      : Date.now()) - tabs.length;
  return tabs
    .map((tab, sourceIndex) => ({
      tab,
      sourceIndex,
      group: tabGroup(tab, groupMode, connections),
    }))
    .sort((left, right) => {
      if (groupMode !== "none") {
        const groupOrder = tabCollator.compare(
          left.group.key,
          right.group.key,
        );
        if (groupOrder !== 0) return groupOrder;
      }
      if (sortMode === "created-asc") {
        const createdOrder =
          (left.tab.createdAt ?? legacyCreationBase + left.sourceIndex) -
          (right.tab.createdAt ?? legacyCreationBase + right.sourceIndex);
        if (createdOrder !== 0) return createdOrder;
      } else if (sortMode === "title-asc") {
        const titleOrder = tabCollator.compare(left.tab.title, right.tab.title);
        if (titleOrder !== 0) return titleOrder;
      }
      return left.sourceIndex - right.sourceIndex;
    });
}

/**
 * Returns the exact visual order used by the tab strip. Pinned and regular
 * tabs remain separate ordering regions so grouping can never move a regular
 * tab in front of a pinned one.
 */
export function organizeEditorTabs<T extends OrganizableTab>(
  tabs: readonly T[],
  groupMode: TabGroupMode,
  sortMode: TabSortMode,
  connectionList: readonly TabConnectionIdentity[],
): OrganizedTab<T>[] {
  const connections = connectionIdentityMap(connectionList);
  const partitions = [
    organizePartition(
      tabs.filter((tab) => tab.isPinned),
      groupMode,
      sortMode,
      connections,
    ),
    organizePartition(
      tabs.filter((tab) => !tab.isPinned),
      groupMode,
      sortMode,
      connections,
    ),
  ];
  const hasPinnedTabs = (partitions[0]?.length ?? 0) > 0;

  return partitions.flatMap((partition, partitionIndex) =>
    partition.map((entry, index) => ({
      tab: entry.tab,
      groupKey: entry.group.key,
      groupLabel: entry.group.label,
      startsGroup:
        groupMode !== "none" &&
        (index === 0 || partition[index - 1]?.group.key !== entry.group.key),
      startsRegularRegion:
        hasPinnedTabs && partitionIndex === 1 && index === 0,
    })),
  );
}

export function canManuallyReorderTabs(sortMode: TabSortMode) {
  return sortMode === "manual";
}

export function tabPlacementFlexDirection(placement: TabPlacement) {
  if (placement === "bottom") return "flex-col-reverse" as const;
  if (placement === "right") return "flex-row-reverse" as const;
  if (placement === "left") return "flex-row" as const;
  return "flex-col" as const;
}
