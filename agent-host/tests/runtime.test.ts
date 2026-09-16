import { describe, expect, it } from "vitest";
import {
  modelUsage,
  splitPromptAtBoundaries,
  systemPrompt,
} from "../src/runtime.js";
import { toolObservationDetail } from "../src/tools.js";

describe("long prompt segmentation", () => {
  it("preserves every character and does not split surrogate pairs", () => {
    const prompt = `${"requirement line\n".repeat(700)}tail constraint 😀 MUST remain`;
    const chunks = splitPromptAtBoundaries(prompt, 4_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(prompt);
    expect(chunks.at(-1)?.text).toContain("tail constraint 😀 MUST remain");
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.start).toBe(chunks[index - 1]?.end);
    }
  });
});

describe("Agent process narration", () => {
  it("requires a concise public description before each work phase", () => {
    const prompt = systemPrompt("agent");
    expect(prompt).toContain("Before each distinct work phase");
    expect(prompt).toContain("then perform that phase's tool calls");
    expect(prompt).toContain("never reveal hidden reasoning");
    expect(prompt).toContain(
      "project.writeFile changes apply immediately without a pre-approval prompt",
    );
    expect(prompt).toContain("kept or undone");
  });
});

describe("model usage projection", () => {
  it("accepts complete provider usage and rejects partial metadata", () => {
    expect(
      modelUsage({
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 30,
          total_tokens: 150,
        },
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
    expect(
      modelUsage({
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 30,
        },
      }),
    ).toBeNull();
  });
});

describe("tool observation presentation", () => {
  it("keeps a bounded output preview and reports truncation metadata", () => {
    const detail = toolObservationDetail({
      summary: "query.runReadOnly returned a bounded result",
      data: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Lin" },
      ],
      rowCount: 2,
      byteCount: 64,
      truncated: false,
      artifactRef: null,
    });

    expect(detail).toContain("2 rows · 64 bytes");
    expect(detail).toContain("Output preview");
    expect(detail).toContain('"name": "Ada"');
  });

  it("does not inline an offloaded artifact", () => {
    const detail = toolObservationDetail({
      summary: "metadata.listObjects result was offloaded",
      rowCount: 500,
      byteCount: 80_000,
      truncated: true,
      artifactRef: "tool-result-1",
    });

    expect(detail).toContain("500 rows · 80,000 bytes · truncated");
    expect(detail).not.toContain("Output preview");
    expect(detail.length).toBeLessThanOrEqual(2_400);
  });
});
