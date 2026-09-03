/** @jsxImportSource @opentui/react */

/**
 * The `/model` picker: a filtered list of OpenRouter models, mounted over the
 * prompt while it is open. It only chooses an id — persistence still goes
 * through `/model <id>`, so the shell has exactly one write path.
 */
import { type InputRenderable, type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listOpenRouterModels, type OpenRouterModel } from "../../ai/openrouter-models.ts";
import { colors } from "../theme.ts";

interface ModelPickerProps {
  /** Currently configured `opencode.model`, or null when unset. */
  current: string | null;
  onPick: (id: string) => void;
  onCancel: () => void;
}

/** Rows visible at once; the scrollbox handles the rest. */
const VISIBLE_ROWS = 10;

function contextLabel(model: OpenRouterModel): string {
  return model.contextLength ? `${Math.round(model.contextLength / 1000)}k` : "—";
}

export function ModelPicker({ current, onPick, onCancel }: ModelPickerProps) {
  const inputRef = useRef<InputRenderable | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let live = true;
    void listOpenRouterModels().then((catalogue) => {
      if (!live) return;
      setModels(catalogue.models);
      setSource(catalogue.reason ? `${catalogue.source} — ${catalogue.reason}` : catalogue.source);
    });
    return () => {
      live = false;
    };
  }, []);

  const matches = useMemo(() => {
    const all = models ?? [];
    const needle = filter.trim().toLowerCase();
    if (needle === "") return all;
    return all.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle),
    );
  }, [models, filter]);

  // A shrinking filter must not leave the cursor past the end of the list.
  useEffect(() => {
    setIndex((value) => (value >= matches.length ? Math.max(0, matches.length - 1) : value));
  }, [matches.length]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollChildIntoView(`model-${index}`), 0);
  }, [index]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      key.preventDefault();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      setIndex((value) => Math.max(0, Math.min(matches.length - 1, value + delta)));
      key.preventDefault();
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      const delta = (key.name === "pageup" ? -1 : 1) * VISIBLE_ROWS;
      setIndex((value) => Math.max(0, Math.min(matches.length - 1, value + delta)));
      key.preventDefault();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const chosen = matches[index];
      if (chosen) onPick(chosen.id);
      key.preventDefault();
    }
  });

  return (
    <box
      style={{
        flexShrink: 0,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        border: true,
        borderColor: colors.accent,
        backgroundColor: colors.surface,
      }}
    >
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        <text selectable={false} style={{ fg: colors.accent, attributes: TextAttributes.BOLD }}>
          select model
        </text>
        <text selectable={false} style={{ fg: colors.muted, marginLeft: 2, flexGrow: 1 }}>
          {models === null
            ? "loading models…"
            : `${matches.length}/${models.length} · ${source} · current ${current ?? "unset"}`}
        </text>
      </box>

      <box style={{ flexDirection: "row", alignItems: "center" }}>
        <text selectable={false} style={{ fg: colors.accent, width: 2 }}>
          /
        </text>
        <input
          ref={inputRef}
          focused
          value={filter}
          placeholder="filter by id or name"
          onInput={(next: string) => {
            setFilter(next);
            setIndex(0);
          }}
          style={{
            flexGrow: 1,
            textColor: colors.textStrong,
            backgroundColor: colors.surface,
            focusedTextColor: colors.textStrong,
            focusedBackgroundColor: colors.surface,
            placeholderColor: colors.muted,
            cursorColor: colors.accent,
          }}
        />
      </box>

      <scrollbox
        ref={scrollRef}
        focused={false}
        style={{ height: VISIBLE_ROWS, width: "100%" }}
        viewportOptions={{ paddingRight: 1 }}
      >
        {matches.length === 0 ? (
          <text selectable={false} style={{ fg: colors.muted }}>
            {models === null ? "  loading…" : "  no model matches that filter"}
          </text>
        ) : (
          matches.map((entry, row) => (
            <box
              key={entry.id}
              id={`model-${row}`}
              style={{
                width: "100%",
                flexDirection: "row",
                backgroundColor: row === index ? colors.surfaceSelected : colors.surface,
              }}
            >
              <text
                selectable={false}
                style={{
                  fg: row === index ? colors.accent : colors.text,
                  attributes: row === index ? TextAttributes.BOLD : undefined,
                  flexGrow: 1,
                  truncate: true,
                }}
              >
                {`${current === `openrouter/${entry.id}` ? "●" : " "} ${entry.id}`}
              </text>
              <text selectable={false} style={{ fg: colors.muted }}>
                {contextLabel(entry)}
              </text>
            </box>
          ))
        )}
      </scrollbox>

      <text selectable={false} style={{ fg: colors.muted, truncate: true }}>
        ↑↓ move · enter select · esc cancel · type to filter
      </text>
    </box>
  );
}
