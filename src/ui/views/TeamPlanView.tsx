/** @jsxImportSource @opentui/react */

/**
 * The approval step between a typed request and a running team.
 *
 * Agents write real files, so the plan is shown in full — every prompt, not a
 * summary of one — and nothing starts until the human says so.
 */
import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef } from "react";
import type { TeamPlan } from "../../ai/planner.ts";
import { colors } from "../theme.ts";

interface TeamPlanViewProps {
  plan: TeamPlan;
  onApprove: () => void;
  onCancel: () => void;
}

/** Rows of plan visible at once; the rest scrolls. */
const VISIBLE_ROWS = 14;

export function TeamPlanView({ plan, onApprove, onCancel }: TeamPlanViewProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "n") {
      onCancel();
      key.preventDefault();
      return;
    }
    if (key.name === "return" || key.name === "enter" || key.name === "y") {
      onApprove();
      key.preventDefault();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      scrollRef.current?.scrollBy(key.name === "up" ? -2 : 2);
      key.preventDefault();
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      scrollRef.current?.scrollBy((key.name === "pageup" ? -1 : 1) * VISIBLE_ROWS);
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
        borderColor: colors.warn,
        backgroundColor: colors.surface,
      }}
    >
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        <text selectable={false} style={{ fg: colors.warn, attributes: TextAttributes.BOLD }}>
          plan
        </text>
        <text selectable={false} style={{ fg: colors.textStrong, marginLeft: 2, truncate: true }}>
          {plan.title}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text selectable={false} style={{ fg: colors.muted }}>
          {`${plan.tasks.length} agent(s)`}
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        focused={false}
        style={{ height: VISIBLE_ROWS, width: "100%" }}
        viewportOptions={{ paddingRight: 1 }}
      >
        <text selectable style={{ fg: colors.muted }}>
          {plan.rationale}
        </text>
        {plan.tasks.map((task, index) => (
          <box key={task.title} style={{ width: "100%", flexDirection: "column", marginTop: 1 }}>
            <box style={{ flexDirection: "row" }}>
              <text
                selectable={false}
                style={{ fg: colors.accent, attributes: TextAttributes.BOLD }}
              >
                {`${index + 1}. ${task.agent}`}
              </text>
              <text selectable style={{ fg: colors.textStrong, marginLeft: 2, truncate: true }}>
                {task.title}
              </text>
            </box>
            <text selectable style={{ fg: colors.text }}>
              {task.prompt}
            </text>
          </box>
        ))}
      </scrollbox>

      <text selectable={false} style={{ fg: colors.muted, truncate: true }}>
        enter or y launches all agents · esc or n cancels · ↑↓ scrolls
      </text>
    </box>
  );
}
