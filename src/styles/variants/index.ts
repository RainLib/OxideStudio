/**
 * CVA Variants - 统一导出所有样式变体
 *
 * 使用方式：
 * import { containerVariants, iconButtonVariants } from '@/styles/variants';
 */

// 布局相关
export {
  containerVariants,
  panelVariants,
  dividerVariants,
  draggableRegionVariants,
  type ContainerVariants,
  type PanelVariants,
  type DividerVariants,
  type DraggableRegionVariants,
} from "./layout";

// 按钮相关
export {
  iconButtonVariants,
  toolbarButtonVariants,
  tabButtonVariants,
  closeButtonVariants,
  type IconButtonVariants,
  type ToolbarButtonVariants,
  type TabButtonVariants,
  type CloseButtonVariants,
} from "./button";

// 面板相关
export {
  sidebarVariants,
  activityBarVariants,
  activityBarItemVariants,
  statusBarVariants,
  tabBarVariants,
  panelHeaderVariants,
  windowDragRegionVariants,
  type SidebarVariants,
  type ActivityBarVariants,
  type ActivityBarItemVariants,
  type StatusBarVariants,
  type TabBarVariants,
  type PanelHeaderVariants,
  type WindowDragRegionVariants,
} from "./panel";

export {
  valueEditorStateButtonVariants,
  type ValueEditorStateButtonVariants,
} from "./valueEditor";

export { popupVariants } from "./popup";
