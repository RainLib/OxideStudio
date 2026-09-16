let nextNodeId = 1;

export function createEditorGroupId(): string {
  return `group-${nextNodeId++}`;
}

export function createEditorSplitId(): string {
  return `split-${nextNodeId++}`;
}
