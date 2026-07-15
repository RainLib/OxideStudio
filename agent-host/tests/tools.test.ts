import { describe, expect, it } from "vitest";
import { canonicalInputDigest } from "../src/tools.js";

describe("canonicalInputDigest", () => {
  it("is stable across insertion order and non-ASCII keys", () => {
    const left = {
      "\u{1f600}": 4,
      z: 1,
      "私": { beta: true, alpha: false },
      "\ue000": 3,
    };
    const right = {
      "\ue000": 3,
      "私": { alpha: false, beta: true },
      z: 1,
      "\u{1f600}": 4,
    };

    expect(canonicalInputDigest(left)).toBe(canonicalInputDigest(right));
    expect(canonicalInputDigest(left)).toBe(
      "ade0aa354115444ab93a17956cefbf7d9bf9fa7ed7f65fb4373741e3aa29d2f4",
    );
  });
});
