/**
 * Turns one sentence typed in the shell into a team of well-specified agent
 * prompts.
 *
 * This is the first consumer of AISET's own model access, and it stays on the
 * right side of the charter: it *plans*, it never performs engineering work.
 * Everything it produces is handed to OpenCode, which remains the only
 * execution engine.
 */
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { AisetError } from "../core/errors.ts";
import { log } from "../core/logger.ts";
import { getModel, resolveSelection } from "./provider.ts";

/** OpenCode's own agents. Anything outside this set would fail at launch. */
export const AGENT_ROLES = ["build", "plan", "general"] as const;

export const TeamPlanSchema = z.object({
  /** Names the group run in `/runs`. */
  title: z.string().min(1).max(80),
  /** One line: why the work was split this way. */
  rationale: z.string().min(1).max(400),
  tasks: z
    .array(
      z.object({
        agent: z.enum(AGENT_ROLES),
        title: z.string().min(1).max(60),
        /** The whole brief for one agent — self-contained, no placeholders. */
        prompt: z.string().min(20),
      }),
    )
    .min(1)
    .max(6),
});
export type TeamPlan = z.infer<typeof TeamPlanSchema>;
export type TeamTask = TeamPlan["tasks"][number];

/**
 * The substance of the feature. Every rule here exists because the agents run
 * blind: in parallel, in one working directory, unable to see each other, this
 * conversation, or the request the user actually typed.
 */
const SYSTEM_PROMPT = `You are AISET's planner. You turn one engineering request into a team of OpenCode agents that will run AT THE SAME TIME, in the SAME working directory, with no way to talk to each other.

Rules:
- Split the request into the fewest independent tasks that cover it. One task is a perfectly good plan for a small request; never invent work to fill a team.
- Two tasks must never write the same file. Partition by directory or by file, and say so in each prompt.
- Each prompt is the agent's entire brief. It cannot see this conversation, the other tasks, or the user's words. Restate the stack, the exact paths to create, and the command that proves the work (a build, a test, a script to run).
- When the user delegates a shared decision ("any design system", "whatever styling you like"), DECIDE IT HERE and repeat the same decision verbatim in every prompt, so the agents cannot diverge.
- Work every task depends on — scaffolding a project, installing a framework, creating a shared layout — belongs to exactly ONE task, and the other prompts must say they assume it exists and must not create it.
- Never ask a question, never leave a placeholder, never say "as appropriate". If something is unspecified, choose and state the choice.
- Choose the agent per task: "build" writes and edits code, "plan" investigates and produces a written plan or spec, "general" for anything else.
- Prompts are instructions to an engineer, not descriptions of them. Write imperatively.`;

export interface PlanOptions {
  /** Injected in tests; production resolves the configured model. */
  model?: LanguageModel;
  root?: string;
}

/**
 * Produces a plan, or throws `AisetError` with a hint. It never returns a
 * half-formed plan: the schema is the contract the launcher relies on.
 */
export async function planTeam(request: string, opts: PlanOptions = {}): Promise<TeamPlan> {
  const text = request.trim();
  if (text === "") throw new AisetError("nothing to plan", "describe the work you want done");

  const root = opts.root ?? process.cwd();
  const selection = await resolveSelection({}, root);
  const model = opts.model ?? getModel(selection);

  let plan: TeamPlan;
  try {
    const result = await generateObject({
      model,
      schema: TeamPlanSchema,
      system: SYSTEM_PROMPT,
      prompt: text,
    });
    plan = result.object;
  } catch (err) {
    // A model that answers with prose, or refuses, must fail here — launching
    // agents on a half-parsed plan would be worse than launching none.
    throw new AisetError(
      `could not plan this request: ${err instanceof Error ? err.message : String(err)}`,
      `check the model set with /model (${selection.provider}/${selection.model}) and try a more concrete request`,
    );
  }

  await log(
    "info",
    "planner.completed",
    {
      provider: selection.provider,
      model: selection.model,
      tasks: plan.tasks.length,
      agents: plan.tasks.map((task) => task.agent),
    },
    root,
  );
  return plan;
}
