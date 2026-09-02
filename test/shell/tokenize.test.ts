import { describe, expect, test } from "bun:test";
import { tokenize } from "../../src/shell/tokenize.ts";

describe("tokenize", () => {
  test("splits on whitespace exactly as a plain split did", () => {
    expect(tokenize("runs --status running --limit 5")).toEqual([
      "runs",
      "--status",
      "running",
      "--limit",
      "5",
    ]);
    expect(tokenize("  run   r_01  ")).toEqual(["run", "r_01"]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  test("a quoted prompt is one argument", () => {
    expect(
      tokenize('multi-launch --agent build "add the parser" --agent review "audit src/db"'),
    ).toEqual([
      "multi-launch",
      "--agent",
      "build",
      "add the parser",
      "--agent",
      "review",
      "audit src/db",
    ]);
  });

  test("single quotes work too, and keep backslashes literal", () => {
    expect(tokenize("launch 'C:\\Users\\me'")).toEqual(["launch", "C:\\Users\\me"]);
  });

  test("a quote may be escaped inside a double-quoted prompt", () => {
    expect(tokenize('launch "say \\"hi\\" twice"')).toEqual(["launch", 'say "hi" twice']);
  });

  test("an empty quoted string is still an argument", () => {
    expect(tokenize('launch ""')).toEqual(["launch", ""]);
  });

  test("an unterminated quote yields what was typed rather than throwing", () => {
    expect(tokenize('multi-launch --agent build "half a prompt')).toEqual([
      "multi-launch",
      "--agent",
      "build",
      "half a prompt",
    ]);
  });
});
