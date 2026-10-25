# CVA 样式系统使用指南

## 弹出层统一约定

应用弹窗统一使用 `Dialog`，菜单、下拉和提示使用 `components/ui/` 对应组件；自绘弹层复用 `popupVariants`。配色、字号、密度和动效由 `src/styles/overlays.css` 管理，不在业务组件重复设置底色、圆角或阴影。复杂弹窗使用 `DialogContent layout="custom"`，自行管理布局与操作栏；普通弹窗使用默认布局。

确认、文本输入和消息提示使用 `@/lib/appDialogs` 的 `confirmAction`、`promptValue`、`showMessage`，不要使用 `window.confirm/prompt/alert`。确认与输入均为异步操作，必须 `await` 用户的决定再执行后续操作；取消输入返回 `null`，空字符串是有效输入。可通过 options 配置标题、操作文案、危险样式和 AbortSignal。原生 `title` 属性由 `AppTooltipHost` 统一展示，图标按钮仍应显式提供 `aria-label`。

弹窗进入/退出为 180/120ms，菜单为 120/80ms，Tooltip 为 100/80ms。不要叠加旧的 zoom/slide 动画类。应用和系统减少动态设置覆盖 Portal 与自绘弹层；系统文件选择器保持平台外观。

## 快速开始

### 导入方式

```typescript
// 导入 cn 工具函数（必需）
import { cn } from "@/styles/utils";

// 导入需要的变体
import {
  containerVariants,
  iconButtonVariants,
  panelVariants,
} from "@/styles/variants";
```

### 基础使用

```typescript
// ✅ 正确：使用 CVA 变体
<div className={containerVariants({ layout: "workspace" })}>

// ✅ 正确：组合变体和自定义类名
<div className={cn(
  iconButtonVariants({ size: "md", variant: "ghost" }),
  "custom-class"
)}>

// ❌ 错误：直接内联样式
<div className="h-screen w-screen flex flex-col bg-[#131313]">
```

---

## 可用变体

### 1. 容器变体 (Container Variants)

**导入**: `import { containerVariants } from "@/styles/variants"`

#### 参数

| 参数        | 选项                                                             | 说明       |
| ----------- | ---------------------------------------------------------------- | ---------- |
| `layout`    | `workspace`, `connection`, `content`, `contentRow`, `contentCol` | 预定义布局 |
| `direction` | `row`, `col`                                                     | Flex 方向  |
| `align`     | `start`, `center`, `end`, `stretch`                              | 垂直对齐   |
| `justify`   | `start`, `center`, `end`, `between`                              | 水平对齐   |
| `gap`       | `none`, `xs`, `sm`, `md`, `lg`                                   | 间距       |

#### 示例

```typescript
// 页面根容器
<div className={containerVariants({ layout: "workspace" })}>

// 灵活内容区
<div className={containerVariants({
  direction: "row",
  layout: "content",
  gap: "md"
})}>
```

---

### 2. 面板变体 (Panel Variants)

**导入**: `import { panelVariants } from "@/styles/variants"`

#### 参数

| 参数         | 选项                                                        | 说明                     |
| ------------ | ----------------------------------------------------------- | ------------------------ |
| `side`       | `left`, `right`, `top`, `bottom`                            | 面板位置（自动添加边框） |
| `background` | `primary`, `secondary`, `tertiary`                          | 背景色                   |
| `size`       | `titleBar`, `appBar`, `statusBar`, `activityBar`, `sidebar` | 预定义尺寸               |

#### 示例

```typescript
// AppBar
<div className={cn(
  panelVariants({ side: "top", background: "secondary", size: "appBar" }),
  "flex items-center"
)}>

// 左侧边栏
<div className={panelVariants({ side: "left", background: "secondary" })}>
```

---

### 3. 按钮变体 (Button Variants)

**导入**: `import { iconButtonVariants } from "@/styles/variants"`

#### 图标按钮 (Icon Button)

| 参数       | 选项                                  | 说明     |
| ---------- | ------------------------------------- | -------- |
| `variant`  | `ghost`, `danger`, `active`, `orange` | 按钮风格 |
| `size`     | `xs`, `sm`, `md`, `lg`                | 按钮尺寸 |
| `disabled` | `true`, `false`                       | 禁用状态 |

#### 示例

```typescript
// 工具栏按钮
<Button className={iconButtonVariants({ size: "md", variant: "ghost" })}>
  <PanelLeft size={16} />
</Button>

// 关闭按钮
<Button className={iconButtonVariants({ size: "sm", variant: "danger" })}>
  <X size={14} />
</Button>
```

---

### 4. 侧边栏变体 (Sidebar Variants)

**导入**: `import { sidebarVariants, panelHeaderVariants } from "@/styles/variants"`

#### Sidebar

| 参数          | 选项                               | 说明                       |
| ------------- | ---------------------------------- | -------------------------- |
| `side`        | `left`, `right`                    | 侧边栏位置                 |
| `background`  | `primary`, `secondary`, `tertiary` | 背景色                     |
| `collapsible` | `true`, `false`                    | 是否可折叠（添加过渡动画） |

#### Panel Header

| 参数      | 选项              | 说明     |
| --------- | ----------------- | -------- |
| `size`    | `sm`, `md`, `lg`  | 头部高度 |
| `variant` | `default`, `bold` | 文字样式 |

#### 示例

```typescript
// 侧边栏
<div
  className={sidebarVariants({
    side: "left",
    background: "secondary",
    collapsible: true,
  })}
>
  {/* 头部 */}
  <div className={panelHeaderVariants({ size: "md", variant: "bold" })}>
    Details
  </div>
</div>
```

---

### 5. 分割线变体 (Divider Variants)

**导入**: `import { dividerVariants } from "@/styles/variants"`

#### 参数

| 参数          | 选项                           | 说明   |
| ------------- | ------------------------------ | ------ |
| `orientation` | `horizontal`, `vertical`       | 方向   |
| `color`       | `default`, `subtle`, `divider` | 颜色   |
| `spacing`     | `none`, `xs`, `sm`, `md`       | 外边距 |

#### 示例

```typescript
// 垂直分割线
<div
  className={dividerVariants({
    orientation: "vertical",
    color: "divider",
    spacing: "xs",
  })}
/>
```

---

## 设计 Tokens

### 颜色系统

**导入**: `import { colors } from "@/styles/tokens"`

```typescript
colors.background.primary; // #131313 - 主背景
colors.background.secondary; // #1a1a1a - 次级背景
colors.background.tertiary; // #1e1e1e - 编辑器背景
colors.border.default; // #333 - 默认边框
colors.text.primary; // #e5e5e5 - 主要文字
colors.accent.orange; // #f97316 - 主题橙色
```

### 间距系统

**导入**: `import { spacing } from "@/styles/tokens"`

```typescript
spacing.appBar; // 3rem (48px)
spacing.titleBar; // 2rem (32px)
spacing.statusBar; // 1.75rem (28px)
spacing.activityBar; // 3rem (48px)
spacing.sidebarMin; // 280px
```

---

## 最佳实践

### ✅ 推荐做法

```typescript
// 1. 优先使用预定义变体
<div className={containerVariants({ layout: "workspace" })}>

// 2. 使用 cn() 组合类名
<div className={cn(
  iconButtonVariants({ size: "md" }),
  "custom-additional-class"
)}>

// 3. 复用设计 tokens
import { colors } from "@/styles/tokens";
const customColor = colors.accent.orange;

// 4. 类型安全
const variant: IconButtonVariants = { size: "md", variant: "ghost" };
<Button className={iconButtonVariants(variant)}>
```

### ❌ 反模式

```typescript
// ❌ 避免：重复的内联样式
<div className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]">

// ❌ 避免：硬编码颜色值
<div className="bg-[#131313] border-[#333]">

// ❌ 避免：未使用 cn() 合并类名
<div className={`${iconButtonVariants()} custom-class`}>

// ✅ 正确
<div className={cn(iconButtonVariants(), "custom-class")}>
```

---

## 迁移检查清单

将现有组件迁移到 CVA 时，请遵循以下步骤：

- [ ] **步骤 1**: 添加必要的导入

  ```typescript
  import { cn } from "@/styles/utils";
  import { containerVariants, iconButtonVariants } from "@/styles/variants";
  ```

- [ ] **步骤 2**: 识别可复用的样式模式

  - 容器布局 → `containerVariants`
  - 按钮 → `iconButtonVariants` / `toolbarButtonVariants`
  - 面板 → `panelVariants` / `sidebarVariants`

- [ ] **步骤 3**: 替换内联样式

  ```typescript
  // 之前
  <div className="h-screen w-screen flex flex-col bg-[#131313]">

  // 之后
  <div className={containerVariants({ layout: "workspace" })}>
  ```

- [ ] **步骤 4**: 验证视觉效果一致

  - 运行应用，对比截图
  - 确保悬停、激活状态正常

- [ ] **步骤 5**: 检查 TypeScript 类型
  - 确保无类型错误
  - 享受自动补全和类型提示

---

## 常见问题

### Q: 如何添加自定义类名？

```typescript
// 使用 cn() 合并
<div className={cn(
  containerVariants({ layout: "content" }),
  "my-custom-class",
  condition && "conditional-class"
)}>
```

### Q: 如何覆盖变体样式？

```typescript
// 后面的类名会覆盖前面的（tailwind-merge 自动处理）
<div className={cn(
  iconButtonVariants({ size: "md" }),  // h-8 w-8
  "h-10 w-10"  // 覆盖为 h-10 w-10
)}>
```

### Q: 如何创建新变体？

在 `/src/styles/variants/` 目录下创建新文件或在现有文件中添加：

```typescript
export const myCustomVariant = cva("base-classes", {
  variants: {
    size: {
      sm: "text-sm",
      lg: "text-lg",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});
```

### Q: 性能影响？

CVA 是零运行时开销的，所有计算在构建时完成。Tailwind 的 tree-shaking 会移除未使用的样式，最终包大小不会增加。

---

## 额外资源

- [CVA 官方文档](https://cva.style)
- [Tailwind CSS 文档](https://tailwindcss.com)
- [项目实现计划](implementation_plan.md)

---

> **提示**: 养成使用 CVA 变体的习惯，代码可读性和可维护性会显著提升。如遇问题，参考现有组件实现（如 `AppBar.tsx`, `workspace.tsx`）。
