import { TabBarView } from "@/features/workspace-tabs/ui/TabBarView";
import type { TabBarProps } from "@/features/workspace-tabs/model/tabBar";

export type { TabBarProps };

export function TabBar(props: TabBarProps = {}) {
  return <TabBarView {...props} />;
}
