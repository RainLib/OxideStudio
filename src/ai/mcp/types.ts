export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolCallResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
};
