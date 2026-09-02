/**
 * Splits a submitted line into arguments, honouring quotes.
 *
 * A command that takes several prompts needs a way to say where one ends, and
 * the only notation a terminal user already knows is quoting. Unquoted input
 * tokenizes exactly as a split on whitespace did, so every existing command is
 * unaffected.
 *
 * An unterminated quote yields what has been typed so far rather than throwing:
 * a half-typed line is a normal state at a prompt, not an error.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (quote === null && /\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }

    // Only double quotes escape, as in POSIX shells: inside single quotes a
    // backslash is a backslash.
    if (quote === '"' && ch === "\\" && i + 1 < line.length) {
      const next = line[i + 1]!;
      if (next === '"' || next === "\\") {
        current += next;
        i++;
        continue;
      }
    }

    if (quote === null && (ch === '"' || ch === "'")) {
      quote = ch;
      // An empty quoted string is still an argument.
      started = true;
      continue;
    }
    if (quote === ch) {
      quote = null;
      continue;
    }

    current += ch;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}
