import { describe, expect, it } from "vitest";

import {
  getFountainPlainText,
  parseFountainInline,
} from "@/lib/fountain/inline";

describe("parseFountainInline", () => {
  it("parses italic, bold, bold italic, and underline", () => {
    expect(parseFountainInline("*a* **b** ***c*** _d_")).toEqual([
      { children: [{ type: "text", value: "a" }], type: "italic" },
      { type: "text", value: " " },
      { children: [{ type: "text", value: "b" }], type: "bold" },
      { type: "text", value: " " },
      { children: [{ type: "text", value: "c" }], type: "bold-italic" },
      { type: "text", value: " " },
      { children: [{ type: "text", value: "d" }], type: "underline" },
    ]);
  });

  it("nests emphasis", () => {
    expect(parseFountainInline("**bold *and italic* text**")).toEqual([
      {
        children: [
          { type: "text", value: "bold " },
          { children: [{ type: "text", value: "and italic" }], type: "italic" },
          { type: "text", value: " text" },
        ],
        type: "bold",
      },
    ]);
  });

  it("keeps unmatched markers and escapes as text", () => {
    expect(parseFountainInline("5 * 3 = \\*15\\*")).toEqual([
      { type: "text", value: "5 * 3 = *15*" },
    ]);
  });

  it("does not let emphasis cross a line break", () => {
    expect(parseFountainInline("*one\ntwo*")).toEqual([
      { type: "text", value: "*one\ntwo*" },
    ]);
  });

  it("parses notes", () => {
    expect(parseFountainInline("He waits. [[ Too slow? ]]")).toEqual([
      { type: "text", value: "He waits. " },
      { type: "note", value: "Too slow?" },
    ]);
  });
});

describe("getFountainPlainText", () => {
  it("drops markup and notes", () => {
    expect(getFountainPlainText("**Run**, _now_! [[cut?]]")).toBe("Run, now! ");
  });
});
