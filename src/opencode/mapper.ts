import type { ArtifactKind } from "../db/types.ts";
import {
  EMPTY,
  type Mapped,
  type MappedArtifact,
  type MappedEvent,
  type MappedUsage,
  type OpenCodeEvent,
} from "./types.ts";

/** Tools whose completion means a file now exists on disk. */
const WRITING_TOOLS = new Set(["write", "edit", "patch", "multiedit"]);

const MAX_MESSAGE = 2000;
const MAX_OUTPUT = 4000;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length - max} more chars)`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** A written file is a patch to the workspace; a test report is not distinguishable here. */
function artifactKind(path: string): ArtifactKind {
  return /\.(log|txt)$/i.test(path) ? "log" : "patch";
}

/**
 * Translates OpenCode's event stream into AISET rows.
 *
 * Pure: no I/O, no database, no clock. It carries the state a stream needs —
 * which session belongs to which agent, which tool calls and messages have
 * already been recorded — so replaying a transcript twice yields the same rows.
 *
 * Multi-agent shape: an OpenCode run is one root session plus one child session
 * per subagent the primary agent delegates to. Agent identity arrives on the
 * assistant messages, so every event is attributed via its session id.
 */
export class EventMapper {
  private readonly agentBySession = new Map<string, string>();
  private readonly assistantMessages = new Map<string, string>();
  private readonly text = new Map<string, Map<string, string>>();
  private readonly seenToolStates = new Set<string>();
  private readonly seenUsage = new Set<string>();
  private readonly seenArtifacts = new Set<string>();
  private readonly childSessions = new Set<string>();

  constructor(private readonly rootSessionId: string) {}

  /** Sessions this run owns: the root plus every subagent session spawned under it. */
  ownsSession(sessionId: string | null): boolean {
    return (
      sessionId === this.rootSessionId || (sessionId !== null && this.childSessions.has(sessionId))
    );
  }

  map(ev: OpenCodeEvent): Mapped {
    const p = ev.properties;
    switch (ev.type) {
      case "session.created":
        return this.onSessionCreated(p);
      case "message.updated":
        return this.onMessageUpdated(p);
      case "message.part.updated":
        return this.onPartUpdated(p);
      case "session.error":
        return this.onSessionError(p);
      case "session.idle":
        return str(p.sessionID) === this.rootSessionId
          ? { events: [], artifacts: [], usage: [], terminal: "succeeded" }
          : EMPTY;
      default:
        // Deltas, heartbeats, plugin/catalog chatter: live-TUI noise with no
        // durable meaning. Nothing is stored that the run did not actually do.
        return EMPTY;
    }
  }

  private agentFor(sessionId: string | null): string | null {
    return sessionId === null ? null : (this.agentBySession.get(sessionId) ?? null);
  }

  private onSessionCreated(p: Record<string, unknown>): Mapped {
    const info = obj(p.info);
    const id = str(info?.id);
    const parent = str(info?.parentID);
    // A reconnect replays session.created, so a session already known is not a
    // second delegation.
    if (!id || parent === null || !this.ownsSession(parent) || this.childSessions.has(id)) {
      return EMPTY;
    }
    this.childSessions.add(id);
    return {
      events: [
        {
          type: "tool",
          level: "info",
          message: `subagent session started: ${str(info?.title) ?? id}`,
          agent: this.agentFor(parent),
          data: { sessionId: id, parentSessionId: parent, title: str(info?.title) },
        },
      ],
      artifacts: [],
      usage: [],
      terminal: null,
    };
  }

  private onMessageUpdated(p: Record<string, unknown>): Mapped {
    const info = obj(p.info);
    const sessionId = str(info?.sessionID);
    if (!info || !sessionId || !this.ownsSession(sessionId)) return EMPTY;
    if (str(info.role) !== "assistant") return EMPTY;

    const id = str(info.id);
    if (!id) return EMPTY;
    const agent = str(info.agent);
    if (agent) this.agentBySession.set(sessionId, agent);
    this.assistantMessages.set(id, sessionId);

    // OpenCode re-emits the message on every change; only the completed one is
    // final, and only the first sighting of it is recorded.
    const completed = obj(info.time)?.completed !== undefined;
    if (!completed || this.seenUsage.has(id)) return EMPTY;
    this.seenUsage.add(id);

    const tokens = obj(info.tokens);
    const usage: MappedUsage = {
      provider: str(info.providerID),
      model: str(info.modelID),
      inputTokens: num(tokens?.input),
      outputTokens: num(tokens?.output),
      costUsd: num(info.cost),
    };
    return { events: this.flushText(id, agent), artifacts: [], usage: [usage], terminal: null };
  }

  /** Assistant prose is emitted once per part, when its message completes. */
  private flushText(messageId: string, agent: string | null): MappedEvent[] {
    const parts = this.text.get(messageId);
    if (!parts) return [];
    this.text.delete(messageId);
    return [...parts.values()]
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => ({
        type: "stdout" as const,
        level: "info" as const,
        message: truncate(t, MAX_MESSAGE),
        agent,
        data: { messageId },
      }));
  }

  private onPartUpdated(p: Record<string, unknown>): Mapped {
    const part = obj(p.part);
    const sessionId = str(part?.sessionID);
    if (!part || !sessionId || !this.ownsSession(sessionId)) return EMPTY;

    if (str(part.type) === "text") return this.onTextPart(part);
    if (str(part.type) === "tool") return this.onToolPart(part, sessionId);
    return EMPTY;
  }

  private onTextPart(part: Record<string, unknown>): Mapped {
    const messageId = str(part.messageID);
    const partId = str(part.id);
    const text = str(part.text);
    // Only assistant prose. The user's own prompt arrives as a text part too and
    // is already recorded on the `start` event.
    if (!messageId || !partId || text === null || !this.assistantMessages.has(messageId)) {
      return EMPTY;
    }
    let parts = this.text.get(messageId);
    if (!parts) {
      parts = new Map();
      this.text.set(messageId, parts);
    }
    parts.set(partId, text);
    return EMPTY;
  }

  private onToolPart(part: Record<string, unknown>, sessionId: string): Mapped {
    const state = obj(part.state);
    const status = str(state?.status);
    const callId = str(part.callID);
    const tool = str(part.tool) ?? "tool";
    if (!state || !callId) return EMPTY;
    // Tools are announced pending, then running, then settled. Only the settled
    // state is durable, and only once.
    if (status !== "completed" && status !== "error") return EMPTY;
    const key = `${callId}:${status}`;
    if (this.seenToolStates.has(key)) return EMPTY;
    this.seenToolStates.add(key);

    const agent = this.agentFor(sessionId);
    const input = obj(state.input) ?? {};
    const metadata = obj(state.metadata);
    const failed = status === "error";
    const output = str(state.output) ?? str(state.error);

    const event: MappedEvent = {
      type: "tool",
      level: failed ? "error" : "info",
      message: truncate(`${tool}: ${str(state.title) ?? status}`, MAX_MESSAGE),
      agent,
      data: {
        tool,
        callId,
        status,
        input,
        exit: metadata?.exit,
        output: output === null ? undefined : truncate(output, MAX_OUTPUT),
      },
    };

    return {
      events: [event],
      artifacts: failed ? [] : this.artifactsFrom(tool, input, state),
      usage: [],
      terminal: null,
    };
  }

  private artifactsFrom(
    tool: string,
    input: Record<string, unknown>,
    state: Record<string, unknown>,
  ): MappedArtifact[] {
    if (!WRITING_TOOLS.has(tool)) return [];
    const paths = [str(input.filePath), str(input.path)].filter((x): x is string => x !== null);
    for (const p of Array.isArray(state.outputPaths) ? state.outputPaths : []) {
      const s = str(p);
      if (s) paths.push(s);
    }
    const out: MappedArtifact[] = [];
    for (const path of paths) {
      if (this.seenArtifacts.has(path)) continue;
      this.seenArtifacts.add(path);
      out.push({ kind: artifactKind(path), path });
    }
    return out;
  }

  private onSessionError(p: Record<string, unknown>): Mapped {
    const sessionId = str(p.sessionID);
    if (sessionId !== null && !this.ownsSession(sessionId)) return EMPTY;
    const error = obj(p.error);
    const name = str(error?.name) ?? "error";
    const message = str(obj(error?.data)?.message) ?? name;
    return {
      events: [
        {
          type: "stderr",
          level: "error",
          message: truncate(message, MAX_MESSAGE),
          agent: this.agentFor(sessionId),
          data: { error: p.error, sessionId },
        },
      ],
      artifacts: [],
      usage: [],
      // A subagent failing is not the run failing; only the root session's
      // error is terminal.
      terminal: sessionId === null || sessionId === this.rootSessionId ? "failed" : null,
    };
  }
}
