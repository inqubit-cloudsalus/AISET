import type { CliRenderer } from "@opentui/core";

async function pipeTo(command: string[], text: string): Promise<boolean> {
  try {
    const child = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    child.stdin.write(text);
    child.stdin.end();
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

/** OSC 52 first (works over SSH), then a local platform clipboard fallback. */
export async function copyText(renderer: CliRenderer, text: string): Promise<boolean> {
  if (text.length === 0) return false;
  if (renderer.copyToClipboardOSC52(text)) return true;
  if (process.platform === "win32") return pipeTo(["clip.exe"], text);
  if (process.platform === "darwin") return pipeTo(["pbcopy"], text);
  if (await pipeTo(["wl-copy"], text)) return true;
  return pipeTo(["xclip", "-selection", "clipboard"], text);
}
