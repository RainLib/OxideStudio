# 国际化与字体定制

OxideStudio 将语言和字体偏好保存在现有应用设置文档中。
`AppPreferencesProvider` 会在工作区 hydration 前应用这些偏好，因此语言和
UI 字号不需要等待项目、数据库、LSP 或 AI 初始化。

## 当前支持

- 语言：跟随系统、English (`en-US`) 和简体中文 (`zh-CN`)。
- UI 字号：10–20 px，作用于启动外壳、工作台、设置、数据库资源管理器、
  标签页、工具栏和 Assistant。
- SQL 编辑器字号：10–24 px，独立配置。
- 数据表格字号：10–20 px，与行高和缩放比例独立配置。

语言切换会同步更新 `document.documentElement.lang`。UI 字号通过以下语义变量
提供给界面组件：

```css
--wb-ui-font-size
--wb-ui-font-size-sm
--wb-ui-font-size-xs
--wb-ui-font-size-md
--wb-ui-font-size-lg
```

功能组件应使用这些变量，或放在 `workbench-shell` / `settings-dialog` 作用域
内。`AppSettings.appearance` 是唯一数据源；localStorage 中仅保存一份不含敏感
信息的首屏外观缓存，避免为了语言和字号阻塞启动，工作区 hydration 后会用正式
设置重新校准。

## 添加文案

1. 在 `src/i18n/messages.ts` 中添加英文 key。
2. 添加对应简体中文文案；缺失条目会产生 TypeScript 编译错误。
3. React 组件通过 `const { t } = useI18n()` 读取文案。
4. 运行时数据、SQL、数据库对象名、Provider 原始错误和模型输出不做翻译。
5. 小型动态值使用变量插值：

```tsx
t("assistant.process.more", { count })
```

当前使用轻量、类型安全的本地字典，不引入运行时 i18n 依赖。这能保持启动同步，
避免应用外壳可交互前额外加载语言包；在支持语言数量较少时也更容易审计。
