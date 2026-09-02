import { AisetError } from "../core/errors.ts";

export interface StartServerOptions {
  bin: string;
  hostname: string;
  /** 0 lets OpenCode pick a free port; the bound URL is read back from its output. */
  port: number;
  cwd: string;
  /** How long to wait for the "listening on" line before giving up. */
  readyTimeoutMs?: number;
}

export interface OpenCodeServer {
  url: string;
  /** Resolves once the process has exited. */
  stop(): Promise<void>;
  /** Whatever the server wrote to stderr, for diagnosing a failed start. */
  stderr(): string;
}

const READY = /listening on (https?:\/\/\S+)/i;

/**
 * Stops the server by the port it told us it bound to.
 *
 * On Windows `opencode` on PATH is a `.cmd` shim that launches the real binary
 * and exits, so the process we spawned is gone before we ever kill it and the
 * actual server is left listening — which also keeps our inherited pipes open,
 * so the CLI never exits. Its own `POST /global/dispose` answers `true` without
 * shutting down, so the listener is the only handle we have left. It is a safe
 * one: this URL was parsed from the output of the server we started.
 *
 * Elsewhere the direct kill already worked and this is a no-op — including when
 * recovery calls it on a server whose process we never spawned, which is the
 * one case where nothing else can reach it.
 */
export async function stopServerAt(url: string): Promise<void> {
  if (process.platform !== "win32") return;
  const port = Number.parseInt(new URL(url).port, 10);
  if (!Number.isFinite(port) || port <= 0) return;
  try {
    const kill = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue |` +
          " Select-Object -ExpandProperty OwningProcess -Unique |" +
          " ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );
    await kill.exited;
  } catch {
    // Nothing more we can do; the run itself is already recorded.
  }
}

/**
 * Spawns `opencode serve` and waits until it reports its bound URL.
 *
 * OpenCode is the execution engine (charter §4.2); AISET never runs agents
 * itself. This is the one place a process is started.
 */
export async function startServer(opts: StartServerOptions): Promise<OpenCodeServer> {
  const timeoutMs = opts.readyTimeoutMs ?? 30_000;
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(
      [opts.bin, "serve", "--hostname", opts.hostname, "--port", String(opts.port)],
      { cwd: opts.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
  } catch {
    throw new AisetError(
      `could not start '${opts.bin} serve'`,
      "is OpenCode installed and on PATH? run: aiset doctor",
    );
  }

  let stderrText = "";
  const drain = async (stream: ReadableStream<Uint8Array>, onLine: (l: string) => void) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const i = buf.indexOf("\n");
        if (i < 0) break;
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    if (buf) onLine(buf);
  };

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AisetError("OpenCode server did not start in time", stderrText.trim())),
      timeoutMs,
    );
    const settle = (line: string) => {
      const m = READY.exec(line);
      if (m?.[1]) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    // The banner goes to stdout on some builds and stderr on others; watch both.
    void drain(proc.stdout, settle);
    void drain(proc.stderr, (l) => {
      stderrText += `${l}\n`;
      settle(l);
    });
    void proc.exited.then(() => {
      clearTimeout(timer);
      reject(new AisetError("OpenCode server exited before it was ready", stderrText.trim()));
    });
  });

  let stopped = false;
  return {
    url,
    stderr: () => stderrText,
    async stop() {
      if (stopped) return;
      stopped = true;
      proc.kill();
      const forced = setTimeout(() => proc.kill(9), 3_000);
      await Promise.race([proc.exited, Bun.sleep(6_000)]);
      clearTimeout(forced);
      await stopServerAt(url);
    },
  };
}
