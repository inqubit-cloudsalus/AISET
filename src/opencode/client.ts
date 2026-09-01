import { AisetError } from "../core/errors.ts";
import { type OpenCodeEvent, OpenCodeEventSchema } from "./types.ts";

export interface CreateSessionInput {
  title: string;
  agent?: string;
}

export interface PromptInput {
  sessionId: string;
  text: string;
  agent?: string;
  /** "provider/model"; split on the first slash so model ids may contain slashes. */
  model?: string | null;
}

/** The slice of OpenCode's HTTP API the adapter uses. Faked in tests. */
export interface OpenCodeApi {
  createSession(input: CreateSessionInput): Promise<string>;
  prompt(input: PromptInput): Promise<void>;
  abort(sessionId: string): Promise<void>;
  events(signal: AbortSignal): AsyncIterable<OpenCodeEvent>;
}

export function splitModel(model: string | null | undefined): {
  providerID: string;
  modelID: string;
} | null {
  if (!model) return null;
  const i = model.indexOf("/");
  if (i <= 0 || i === model.length - 1) {
    throw new AisetError(
      `model '${model}' is not in provider/model form`,
      "e.g. opencode/big-pickle",
    );
  }
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

/**
 * Client for a running `opencode serve`, per `docs/opencode-api-1.18.25.json`.
 *
 * Prompts are sent with `prompt_async`: OpenCode acknowledges immediately and
 * everything that follows arrives on the `/event` stream, which is the single
 * source the mapper reads.
 */
export class HttpOpenCodeApi implements OpenCodeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly directory: string,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl}${path}?directory=${encodeURIComponent(this.directory)}`;
  }

  private async post(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    if (!res.ok) {
      throw new AisetError(
        `OpenCode ${path} failed with ${res.status}`,
        (await res.text()).slice(0, 500),
      );
    }
    return res;
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const res = await this.post("/session", { title: input.title, agent: input.agent });
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== "string") {
      throw new AisetError(
        "OpenCode created a session without an id",
        JSON.stringify(body).slice(0, 300),
      );
    }
    return body.id;
  }

  async prompt(input: PromptInput): Promise<void> {
    const model = splitModel(input.model);
    await this.post(`/session/${input.sessionId}/prompt_async`, {
      agent: input.agent,
      ...(model ? { model } : {}),
      parts: [{ type: "text", text: input.text }],
    });
  }

  async abort(sessionId: string): Promise<void> {
    await this.post(`/session/${sessionId}/abort`);
  }

  async *events(signal: AbortSignal): AsyncIterable<OpenCodeEvent> {
    const res = await fetch(this.url("/event"), {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new AisetError(
        `OpenCode event stream failed with ${res.status}`,
        "is the server still up?",
      );
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; only `data:` lines carry payload.
        for (;;) {
          const i = buf.indexOf("\n\n");
          if (i < 0) break;
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const parsed = parseFrame(line.slice(5).trim());
            if (parsed) yield parsed;
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

/** A malformed or unrecognised frame is dropped, never fatal to a live run. */
export function parseFrame(raw: string): OpenCodeEvent | null {
  if (raw.length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = OpenCodeEventSchema.safeParse(json);
  return result.success ? result.data : null;
}
