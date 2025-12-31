# Shared Components

This directory contains reusable UI components that can be used across the application.

## Structure

```
shared/
├── Layout/          # Layout components (Container, Panel, etc.)
├── Typography/      # Text components (Heading, Text, Code, etc.)
├── Form/           # Form components (FormField, Label, etc.)
└── Feedback/       # Feedback components (Loading, Error, Empty, etc.)
```

## Usage

```typescript
import { Panel, Heading, LoadingSpinner } from "@/components/shared";

function MyComponent() {
  return (
    <Panel>
      <Heading>Title</Heading>
      <LoadingSpinner />
    </Panel>
  );
}
```

## Guidelines

1. **Single Responsibility**: Each component should do one thing well
2. **Composition over Configuration**: Prefer composition patterns over complex props
3. **TypeScript First**: All components must have proper type definitions
4. **Accessible**: Follow ARIA guidelines where applicable
5. **Themeable**: Use theme tokens from `@/theme` instead of hardcoded values
