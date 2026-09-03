/** @jsxImportSource @opentui/react */

import {
  type InputRenderable,
  MouseButton,
  type MouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { planTeam, type TeamPlan } from "../../ai/planner.ts";
import { readConfig } from "../../core/config.ts";
import { AisetError } from "../../core/errors.ts";
import { orphanNotice } from "../../opencode/recover.ts";
import { dispatch } from "../../shell/commands.ts";
import { promptCompletions } from "../../shell/prompt-state.ts";
import { shellHeader } from "../../shell/session.ts";
import { planToTasks, runGroup } from "../../shell/team.ts";
import type { Session, ShellBlock } from "../../shell/types.ts";
import { copyText } from "../clipboard.ts";
import { colors, formatTimestamp } from "../theme.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import { TeamPlanView } from "./TeamPlanView.tsx";

interface ShellViewProps {
  session: Session;
}

interface ActionProps {
  label: string;
  hint: string;
  onActivate: () => void;
}

const WORDMARK = [
  " █████╗ ██╗███████╗███████╗████████╗",
  "██╔══██╗██║██╔════╝██╔════╝╚══██╔══╝",
  "███████║██║███████╗█████╗     ██║   ",
  "██╔══██║██║╚════██║██╔══╝     ██║   ",
  "██║  ██║██║███████║███████╗   ██║   ",
  "╚═╝  ╚═╝╚═╝╚══════╝╚══════╝   ╚═╝   ",
] as const;

const WORDMARK_SHADOW = " ▀▀▀▀▀  ▀▀ ▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀   ▀▀▀▀   ";

const TEAM_MARK = [
  "    ▄███▄       ▄███▄       ▄███▄    ",
  "  ╭███████╮   ╭███████╮   ╭███████╮  ",
  "  ├───────┤   ├───────┤   ├───────┤  ",
  "  │ •   • │   │ •   • │   │ •   • │  ",
  "  ╰───┬───╯   ╰───┬───╯   ╰───┬───╯  ",
] as const;

function BrandLockup() {
  return (
    <box
      style={{
        height: 10,
        flexShrink: 0,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 3,
        border: ["bottom"],
        borderColor: colors.chrome,
        backgroundColor: colors.surface,
      }}
    >
      <box style={{ width: 44, flexDirection: "column" }}>
        {WORDMARK.map((line, index) => (
          <box key={line} style={{ height: 1, flexDirection: "row" }}>
            <text selectable={false} style={{ fg: colors.accent, attributes: TextAttributes.BOLD }}>
              {line}
            </text>
            <text selectable={false} style={{ fg: colors.accentSoft }}>
              {index === 0 ? " " : "▐"}
            </text>
          </box>
        ))}
        <text selectable={false} style={{ fg: colors.accentSoft }}>
          {WORDMARK_SHADOW}
        </text>
        <text selectable={false} style={{ fg: colors.muted }}>
          <span fg={colors.accent}>◆</span> AI SOFTWARE ENGINEERING TEAM
        </text>
      </box>

      <box style={{ width: 42, flexDirection: "column", alignItems: "center" }}>
        {TEAM_MARK.map((line, index) => (
          <text
            key={line}
            selectable={false}
            style={{
              fg: index < 2 ? colors.accent : colors.text,
              attributes: index < 2 ? TextAttributes.BOLD : undefined,
            }}
          >
            {line}
          </text>
        ))}
        <text selectable={false} style={{ fg: colors.chrome }}>
          ──────── ENGINEERING CELL ────────
        </text>
        <text selectable={false}>
          <span fg={colors.accent} attributes={TextAttributes.BOLD}>
            DESIGN
          </span>
          <span fg={colors.muted}> · </span>
          <span fg={colors.ok} attributes={TextAttributes.BOLD}>
            BUILD
          </span>
          <span fg={colors.muted}> · </span>
          <span fg={colors.warn} attributes={TextAttributes.BOLD}>
            REVIEW
          </span>
          <span fg={colors.muted}> · </span>
          <span fg={colors.textStrong} attributes={TextAttributes.BOLD}>
            SHIP
          </span>
        </text>
      </box>
    </box>
  );
}

function Action({ label, hint, onActivate }: ActionProps) {
  const renderer = useRenderer();
  const [hovered, setHovered] = useState(false);
  const activate = (event: MouseEvent) => {
    if (renderer.getSelection()?.getSelectedText()) return;
    if (event.button !== MouseButton.LEFT) return;
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  };
  return (
    // OpenTUI boxes are terminal hit-test targets rather than DOM elements;
    // the same actions are available from the keyboard shortcuts in `hint`.
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithMouseEvents: terminal renderable
    <box
      onMouseOver={() => {
        setHovered(true);
        renderer.setMousePointer("pointer");
      }}
      onMouseOut={() => {
        setHovered(false);
        renderer.setMousePointer("default");
      }}
      onMouseUp={activate}
      style={{
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: hovered ? colors.surfaceSelected : colors.surfaceRaised,
      }}
    >
      <text selectable={false} style={{ fg: hovered ? colors.textStrong : colors.text }}>
        {label}
      </text>
      <text selectable={false} style={{ fg: colors.muted }}>
        {` ${hint}`}
      </text>
    </box>
  );
}

function Block({
  block,
  index,
  selected,
  onSelect,
}: {
  block: ShellBlock;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const renderer = useRenderer();
  const [hovered, setHovered] = useState(false);
  const input = block.kind === "input";
  const error = block.kind === "error";
  const marker = input ? "›" : error ? "!" : "│";
  const markerColor = input ? colors.accent : error ? colors.fail : colors.chrome;
  return (
    // Keyboard users select transcript entries with option+up/down.
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithMouseEvents: terminal renderable
    <box
      id={`transcript-${index}`}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (renderer.getSelection()?.getSelectedText()) return;
        if (event.button !== MouseButton.LEFT) return;
        onSelect();
      }}
      style={{
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: input ? 1 : 0,
        paddingBottom: input ? 1 : 0,
        backgroundColor: selected
          ? colors.surfaceSelected
          : hovered
            ? colors.surfaceRaised
            : colors.background,
      }}
    >
      <text
        selectable={false}
        style={{ width: 2, fg: markerColor, attributes: TextAttributes.BOLD }}
      >
        {marker}
      </text>
      <text
        selectable
        style={{
          flexGrow: 1,
          flexShrink: 1,
          fg: error ? colors.fail : input ? colors.accent : colors.text,
          selectionBg: colors.selection,
          selectionFg: colors.selectionText,
          wrapMode: "word",
        }}
      >
        {block.text}
      </text>
    </box>
  );
}

function setInputValue(input: InputRenderable | null, value: string) {
  if (!input) return;
  input.value = value;
  input.cursorOffset = value.length;
}

export function ShellView({ session }: ShellViewProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const inputRef = useRef<InputRenderable | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const history = useRef<string[]>([]);
  const historyIndex = useRef<number | null>(null);
  const draft = useRef("");
  const lastInterrupt = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme } = session;

  const [blocks, setBlocks] = useState<ShellBlock[]>(() => {
    const opening: ShellBlock[] = [
      {
        kind: "output",
        text: "Welcome to AISET. Launch a task, inspect a run, or type /help to explore commands.",
      },
    ];
    const orphans = orphanNotice(session.db);
    if (orphans)
      opening.push({ kind: "error", text: `${orphans} — use /recover to inspect them.` });
    return opening;
  });
  const [busy, setBusy] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [notice, setNotice] = useState("drag to select · release to copy");
  const [picker, setPicker] = useState(false);
  const [pickerCurrent, setPickerCurrent] = useState<string | null>(null);
  const [plan, setPlan] = useState<TeamPlan | null>(null);
  const [header, setHeader] = useState(() => shellHeader(session));

  const narrow = dimensions.width < 86;
  const compact = dimensions.height < 22;
  const showBrand = dimensions.width >= 100 && dimensions.height >= 30;
  const completions = useMemo(
    () =>
      promptCompletions({
        buffer: value,
        cursor: value.length,
        history: [],
        historyIndex: null,
        draft: "",
      }),
    [value],
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice("drag to select · release to copy"), 2200);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!busy) return;
    const headerTimer = setInterval(() => setHeader(shellHeader(session)), 1000);
    const spinnerTimer = setInterval(
      () => setSpinnerFrame((frame) => (frame + 1) % theme.symbols.spinner.length),
      90,
    );
    return () => {
      clearInterval(headerTimer);
      clearInterval(spinnerTimer);
    };
  }, [busy, session, theme.symbols.spinner.length]);

  const updateFollowing = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const max = Math.max(0, scroll.scrollHeight - scroll.viewport.height);
    setFollowing(scroll.scrollTop >= max - 1);
  }, []);

  const toBottom = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTo(scroll.scrollHeight);
    setFollowing(true);
  }, []);

  const append = useCallback((next: ShellBlock[]) => {
    if (next.length === 0) return;
    setBlocks((current) => [...current, ...next]);
  }, []);

  const openPicker = useCallback(() => {
    setValue("");
    setInputValue(inputRef.current, "");
    void readConfig(session.ctx.paths.root)
      .catch(() => null)
      .then((config) => setPickerCurrent(config?.opencode.model ?? null));
    setPicker(true);
  }, [session]);

  /** Serialises one unit of shell work, keeping the busy indicator honest. */
  const enqueue = useCallback((work: () => Promise<void>) => {
    pending.current += 1;
    setBusy(true);
    queue.current = queue.current
      .then(work)
      .catch(() => {})
      .finally(() => {
        pending.current -= 1;
        if (pending.current === 0) setBusy(false);
      });
  }, []);

  /**
   * A line with no leading slash is a request for work: the model plans a team
   * from it, and the plan is shown for approval before an agent touches a file.
   */
  const planRequest = useCallback(
    (line: string) => {
      enqueue(async () => {
        try {
          setPlan(
            await planTeam(line, {
              model: session.plannerModel,
              root: session.ctx.paths.root,
            }),
          );
        } catch (err) {
          const hint = err instanceof AisetError && err.hint ? `\n› ${err.hint}` : "";
          append([
            {
              kind: "error",
              text: `team: ${err instanceof Error ? err.message : String(err)}${hint}`,
            },
          ]);
        }
      });
    },
    [append, enqueue, session],
  );

  const launchPlan = useCallback(
    (approved: TeamPlan) => {
      setPlan(null);
      enqueue(async () => {
        const emit = (block: ShellBlock) => append([block]);
        const config = await readConfig(session.ctx.paths.root).catch(() => null);
        const result = await runGroup(session, planToTasks(approved, config?.opencode), emit, {
          wait: false,
          title: approved.title,
          oc: config?.opencode,
          label: "team",
        });
        append(result.blocks);
        setHeader(shellHeader(session));
      });
    },
    [append, enqueue, session],
  );

  const submit = useCallback(
    (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      // Bare `/model` is the one command with an interactive form; with an
      // argument it stays a plain command so scripts and tests behave alike.
      if (line === "/model") {
        openPicker();
        return;
      }
      if (history.current.at(-1) !== line) history.current.push(line);
      historyIndex.current = null;
      draft.current = "";
      setValue("");
      setInputValue(inputRef.current, "");
      append([{ kind: "input", text: line }]);
      setFollowing(true);
      setTimeout(toBottom, 0);

      if (!line.startsWith("/")) {
        planRequest(line);
        return;
      }

      enqueue(async () => {
        const result = await dispatch(session, line, (block) => append([block]));
        if (result.effect === "clear") {
          setBlocks([]);
          setSelected(null);
        } else {
          append(result.blocks);
        }
        if (result.effect === "exit") renderer.destroy();
        setHeader(shellHeader(session));
      });
    },
    [append, enqueue, openPicker, planRequest, renderer, session, toBottom],
  );

  const copySelection = useCallback(async () => {
    const text = renderer.getSelection()?.getSelectedText() ?? "";
    if (!text) return false;
    const copied = await copyText(renderer, text);
    showNotice(copied ? "copied selection" : "clipboard unavailable");
    if (copied) queueMicrotask(() => renderer.clearSelection());
    return true;
  }, [renderer, showNotice]);

  const moveHistory = useCallback(
    (direction: -1 | 1) => {
      if (history.current.length === 0) return;
      if (historyIndex.current === null) {
        if (direction > 0) return;
        draft.current = value;
        historyIndex.current = history.current.length - 1;
      } else {
        const nextIndex = historyIndex.current + direction;
        if (nextIndex < 0) return;
        if (nextIndex >= history.current.length) {
          historyIndex.current = null;
          setValue(draft.current);
          setInputValue(inputRef.current, draft.current);
          return;
        }
        historyIndex.current = nextIndex;
      }
      const nextValue = history.current[historyIndex.current] ?? "";
      setValue(nextValue);
      setInputValue(inputRef.current, nextValue);
    },
    [value],
  );

  const complete = useCallback(() => {
    if (completions.length === 0) return;
    let next = completions[0] ?? value;
    if (completions.length > 1) {
      while (next && !completions.every((candidate) => candidate.startsWith(next))) {
        next = next.slice(0, -1);
      }
    } else {
      next += " ";
    }
    setValue(next);
    setInputValue(inputRef.current, next);
  }, [completions, value]);

  useKeyboard((key) => {
    // While an overlay is mounted it owns the keyboard: the prompt's history,
    // completion and scroll bindings would otherwise fight its own.
    if (picker || plan) {
      if (key.ctrl && key.name === "c") {
        setPicker(false);
        setPlan(null);
        key.preventDefault();
        key.stopPropagation();
      }
      return;
    }
    const selection = renderer.getSelection()?.getSelectedText();
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      key.stopPropagation();
      if (selection) {
        void copySelection();
      } else if (value.length > 0) {
        setValue("");
        setInputValue(inputRef.current, "");
        showNotice("input cleared");
      } else if (Date.now() - lastInterrupt.current < 1200) {
        renderer.destroy();
      } else {
        lastInterrupt.current = Date.now();
        showNotice("press ctrl+c again to quit");
      }
      return;
    }
    if (key.name === "escape" && selection) {
      renderer.clearSelection();
      key.preventDefault();
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      const scroll = scrollRef.current;
      if (!scroll) return;
      scroll.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(1, scroll.viewport.height - 2));
      setTimeout(updateFollowing, 0);
      key.preventDefault();
      return;
    }
    if (key.ctrl && key.name === "home") {
      scrollRef.current?.scrollTo(0);
      setFollowing(false);
      key.preventDefault();
      return;
    }
    if (key.ctrl && key.name === "end") {
      toBottom();
      key.preventDefault();
      return;
    }
    if (key.option && (key.name === "up" || key.name === "down")) {
      const delta = key.name === "up" ? -1 : 1;
      const next = Math.max(0, Math.min(blocks.length - 1, (selected ?? blocks.length) + delta));
      setSelected(next);
      setTimeout(() => scrollRef.current?.scrollChildIntoView(`transcript-${next}`), 0);
      key.preventDefault();
      return;
    }
    if (key.ctrl && key.name === "l") {
      setBlocks([]);
      setSelected(null);
      key.preventDefault();
      return;
    }
    if (key.name === "tab") {
      complete();
      key.preventDefault();
      return;
    }
    if (key.name === "up") {
      moveHistory(-1);
      key.preventDefault();
      return;
    }
    if (key.name === "down") {
      moveHistory(1);
      key.preventDefault();
      return;
    }
    if (key.ctrl && key.name === "d" && value.length === 0) {
      renderer.destroy();
      key.preventDefault();
    }
  });

  return (
    // Root mouse-up implements renderer-wide copy-on-select.
    // biome-ignore lint/a11y/noStaticElementInteractions: terminal selection surface
    <box
      onMouseUp={() => void copySelection()}
      style={{
        width: dimensions.width,
        height: dimensions.height,
        flexDirection: "column",
        backgroundColor: colors.background,
      }}
    >
      {showBrand && <BrandLockup />}

      <box
        style={{
          height: compact ? 2 : 3,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 2,
          paddingRight: 2,
          border: ["bottom"],
          borderColor: colors.chrome,
          backgroundColor: colors.surface,
        }}
      >
        <text selectable style={{ fg: colors.accent, attributes: TextAttributes.BOLD }}>
          ◆ AISET
        </text>
        <text selectable style={{ fg: colors.muted }}>
          {`  v${header.version}`}
        </text>
        {!narrow && (
          <text selectable style={{ fg: colors.muted, marginLeft: 2, flexGrow: 1, truncate: true }}>
            {session.ctx.paths.root}
          </text>
        )}
        <box style={{ flexGrow: narrow ? 1 : 0 }} />
        <text selectable={false} style={{ fg: header.current ? colors.ok : colors.warn }}>
          {header.current ? "● connected" : "● schema behind"}
        </text>
        {!narrow && (
          <text selectable={false} style={{ fg: colors.muted }}>
            {`  ${header.totalRuns} runs  ${header.totalEvents} events`}
          </text>
        )}
      </box>

      {!compact && (
        <box
          style={{
            height: 3,
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 1,
            paddingRight: 1,
            gap: 1,
            backgroundColor: colors.background,
          }}
        >
          <Action label="Help" hint="/help" onActivate={() => submit("/help")} />
          <Action
            label="Runs"
            hint="/runs"
            onActivate={() => submit("/runs --active --limit 12")}
          />
          <Action
            label="Clear"
            hint="ctrl+l"
            onActivate={() => {
              setBlocks([]);
              setSelected(null);
            }}
          />
          <Action label="Bottom" hint="ctrl+end" onActivate={toBottom} />
          <box style={{ flexGrow: 1 }} />
          {!narrow && (
            <text selectable={false} style={{ fg: colors.muted }}>
              page ↑↓ scroll · alt+↑↓ select entry
            </text>
          )}
        </box>
      )}

      <scrollbox
        ref={scrollRef}
        focused={false}
        onMouseScroll={() => setTimeout(updateFollowing, 0)}
        stickyScroll
        stickyStart="bottom"
        viewportCulling
        verticalScrollbarOptions={{
          visible: true,
          trackOptions: {
            foregroundColor: colors.accent,
            backgroundColor: colors.surfaceRaised,
          },
        }}
        viewportOptions={{ paddingRight: 1 }}
        style={{ flexGrow: 1, minHeight: 0, width: "100%" }}
      >
        <box style={{ width: "100%", height: 1 }} />
        {blocks.length === 0 ? (
          <box style={{ width: "100%", paddingLeft: 3, paddingTop: 2 }}>
            <text selectable style={{ fg: colors.muted }}>
              Transcript cleared. Type /help or choose an action above.
            </text>
          </box>
        ) : (
          blocks.map((block, index) => (
            <Block
              // Transcript entries are append-only; /clear removes the whole collection.
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only terminal transcript
              key={`${index}-${block.kind}`}
              block={block}
              index={index}
              selected={selected === index}
              onSelect={() => setSelected(index)}
            />
          ))
        )}
        <box style={{ width: "100%", height: 1 }} />
      </scrollbox>

      <box
        style={{
          height: 1,
          flexShrink: 0,
          flexDirection: "row",
          paddingLeft: 2,
          paddingRight: 2,
          backgroundColor: colors.surface,
        }}
      >
        <text selectable={false} style={{ fg: busy ? colors.warn : colors.ok }}>
          {busy
            ? `${theme.symbols.spinner[spinnerFrame % theme.symbols.spinner.length]} agents working`
            : "● ready"}
        </text>
        <text
          selectable={false}
          style={{ fg: colors.muted, flexGrow: 1, marginLeft: 2, truncate: true }}
        >
          {notice}
        </text>
        <text selectable={false} style={{ fg: following ? colors.muted : colors.warn }}>
          {following ? "FOLLOWING" : "SCROLLED BACK"}
        </text>
      </box>

      {plan && (
        <TeamPlanView
          plan={plan}
          onApprove={() => launchPlan(plan)}
          onCancel={() => {
            setPlan(null);
            append([{ kind: "output", text: "plan discarded — nothing launched" }]);
          }}
        />
      )}

      {picker && (
        <ModelPicker
          current={pickerCurrent}
          onCancel={() => setPicker(false)}
          onPick={(id) => {
            setPicker(false);
            submit(`/model ${id}`);
          }}
        />
      )}

      <box
        style={{
          minHeight: 3,
          flexShrink: 0,
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          backgroundColor: colors.surfaceRaised,
          border: ["top"],
          borderColor: busy ? colors.warn : colors.accentSoft,
        }}
      >
        <box style={{ flexDirection: "row", alignItems: "center" }}>
          <text
            selectable={false}
            style={{ fg: colors.accent, width: 2, attributes: TextAttributes.BOLD }}
          >
            ›
          </text>
          <input
            ref={inputRef}
            focused={!picker && !plan}
            value={value}
            placeholder="Describe the work to plan a team, or type /help"
            onInput={setValue}
            onSubmit={() => submit(inputRef.current?.value ?? value)}
            style={{
              flexGrow: 1,
              textColor: colors.textStrong,
              backgroundColor: colors.surfaceRaised,
              focusedTextColor: colors.textStrong,
              focusedBackgroundColor: colors.surfaceRaised,
              placeholderColor: colors.muted,
              cursorColor: colors.accent,
              selectionBg: colors.selection,
              selectionFg: colors.selectionText,
            }}
          />
          {!narrow && (
            <text selectable={false} style={{ fg: colors.muted }}>
              {formatTimestamp(new Date().toISOString()).slice(11)}
            </text>
          )}
        </box>
        <text selectable={false} style={{ fg: colors.muted, truncate: true }}>
          {completions.length > 1
            ? `  ${completions.slice(0, 8).join("  ")}`
            : "  tab complete · ↑↓ history · ctrl+d quit"}
        </text>
      </box>
    </box>
  );
}
