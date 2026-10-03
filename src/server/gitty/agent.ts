import type {
  AskMode,
  AskStreamEvent,
  ChatTurn,
  CodeNode,
  ImpactResult,
} from "~/features/gitty/types";

import {
  AiToolsUnsupportedError,
  type AiMessage,
  type AiProvider,
} from "./ai/types";
import { validateCitations } from "./citations";
import { buildNodeContext, repositoryStructure } from "./context";
import { parseModelJson } from "./model-json";
import type { LoadedRepository } from "./repository";
import { executeToolCall, toolCatalog, toolSpecs } from "./tools";
import { NO_EVIDENCE_MESSAGE } from "./trace";

const MAX_TOOL_ROUNDS = 4;
const MAX_CALLS_PER_ROUND = 3;
const MAX_EVIDENCE_CHARACTERS = 60_000;
const MAX_HISTORY_TURNS = 6;

const RULES = `You are Gitty, a codebase guide. You answer questions about ONE GitHub repository using only evidence Gitty gives you: the context below and results of tools you request.

Hard rules:
- Never invent files, functions, dependencies, line numbers or behavior. If it is not in the evidence, you do not know it.
- Relationships between files (imports, dependents, impact) come only from Gitty's analysis. Do not add any.
- Cite code inline as [[path:start-end]] or [[path:line]] using paths and line numbers that appear in the evidence. Never cite anything you were not shown.
- If the evidence is not enough to answer, say exactly: "${NO_EVIDENCE_MESSAGE}" and, if useful, what is missing.
- You cannot run commands, change files, or see secrets. The repository is read-only.`;

const MODE_INSTRUCTIONS: Record<AskMode, string> = {
  ask: "Answer the user's question directly and concisely in Markdown.",
  explain:
    "Explain the selected node for a developer new to this repository: what it is responsible for, its key functions or files, and how it connects to the rest of the code. Use short sections and bullets. Keep it under 300 words.",
  why: `Explain why the selected node exists. Use exactly these two Markdown sections:
## Evidence from the code
Facts visible in the evidence, each with a citation.
## Likely purpose
Your inference about the design intent, clearly worded as inference ("likely", "appears to"). Base it only on the evidence above; do not repeat facts as certain.`,
  impact: `Explain what could break if the selected node changes. Gitty has already computed the direct and indirect dependents deterministically (IMPACT ANALYSIS below); treat that list as complete for the analyzed files and do not add others.
Use these sections:
## What depends on it
Summarize the direct dependents and the most important indirect ones, with citations.
## Risk
Which changes (signature, return shape, behavior) are most likely to break callers, based on how dependents use it in the evidence.
## Before changing it
A short checklist.`,
};

interface Evidence {
  text: string;
  seen: Set<string>;
}

function addEvidence(evidence: Evidence, block: string, paths: string[]) {
  const room = MAX_EVIDENCE_CHARACTERS - evidence.text.length;
  if (room <= 200) return false;
  evidence.text += `\n\n${block.length > room ? `${block.slice(0, room)}\n[truncated]` : block}`;
  for (const path of paths) evidence.seen.add(path);
  return true;
}

function impactText(impact: ImpactResult): string {
  const line = (entry: ImpactResult["direct"][number]) =>
    `- ${entry.path} (depth ${entry.depth}, imports ${entry.via ?? "?"}${entry.evidence?.startLine ? ` at line ${entry.evidence.startLine}` : ""})`;
  return [
    `IMPACT ANALYSIS (deterministic, from resolved imports of analyzed files)`,
    `Direct dependents (${impact.direct.length}):`,
    impact.direct.map(line).join("\n") || "- none found",
    `Indirect dependents (${impact.indirect.length}):`,
    impact.indirect.map(line).join("\n") || "- none found",
    impact.truncated ? "(list truncated: more dependents exist)" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type Decision =
  | { kind: "calls"; calls: Array<{ tool: unknown; arguments: unknown }> }
  | { kind: "ready" }
  | { kind: "malformed" };

export function parseDecision(reply: string): Decision {
  const value = parseModelJson(reply) as
    | { ready?: unknown; tool?: unknown; arguments?: unknown; calls?: unknown }
    | unknown[]
    | null;
  if (!value || typeof value !== "object") return { kind: "malformed" };
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { calls?: unknown }).calls)
      ? (value as { calls: unknown[] }).calls
      : null;
  if (list) {
    const calls = list
      .filter((entry): entry is { tool: unknown; arguments?: unknown } =>
        Boolean(entry && typeof entry === "object" && "tool" in entry),
      )
      .slice(0, MAX_CALLS_PER_ROUND)
      .map((entry) => ({ tool: entry.tool, arguments: entry.arguments ?? {} }));
    return calls.length ? { kind: "calls", calls } : { kind: "malformed" };
  }
  const single = value as {
    ready?: unknown;
    tool?: unknown;
    arguments?: unknown;
  };
  if (single.ready === true) return { kind: "ready" };
  if (typeof single.tool === "string")
    return {
      kind: "calls",
      calls: [{ tool: single.tool, arguments: single.arguments ?? {} }],
    };
  return { kind: "malformed" };
}

/** Endpoints (per instance) that rejected the `tools` parameter; they use the JSON protocol. */
const NATIVE_TOOLS_UNSUPPORTED = new Set<string>();

export const MALFORMED_ARGUMENTS = Symbol("malformed-arguments");

export function parseToolArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : MALFORMED_ARGUMENTS;
  } catch {
    return MALFORMED_ARGUMENTS;
  }
}

/** A native-tools reply without tool calls: some servers put a JSON request in the text instead. */
function decisionFromText(text: string): Decision {
  const decision = parseDecision(text);
  return decision.kind === "calls" ? decision : { kind: "ready" };
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  return Object.values(args as Record<string, unknown>)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(", ")
    .slice(0, 120);
}

export interface AgentRequest {
  loaded: LoadedRepository;
  provider: AiProvider;
  mode: AskMode;
  question: string;
  node?: CodeNode;
  impact?: ImpactResult;
  history: ChatTurn[];
  signal?: AbortSignal;
  /** Fail instead of falling back to the JSON protocol when native tool calls are rejected. */
  nativeToolsOnly?: boolean;
}

export async function* runAgent(
  request: AgentRequest,
): AsyncGenerator<AskStreamEvent> {
  const { loaded, provider, mode, node, signal } = request;
  const evidence: Evidence = { text: "", seen: new Set() };

  yield { type: "status", message: "Selecting context" };
  const context = node
    ? await buildNodeContext(loaded, node, signal)
    : repositoryStructure(loaded);
  addEvidence(
    evidence,
    context.text,
    context.sources.map((source) => source.path),
  );
  if (request.impact)
    addEvidence(
      evidence,
      impactText(request.impact),
      [...request.impact.direct, ...request.impact.indirect].map(
        (entry) => entry.path,
      ),
    );

  const history: AiMessage[] = request.history
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
  const question =
    request.question.trim() ||
    (mode === "explain"
      ? `Explain ${node?.label ?? "this repository"}.`
      : mode === "why"
        ? `Why does ${node?.label ?? "this"} exist?`
        : mode === "impact"
          ? `What breaks if ${node?.label ?? "this"} changes?`
          : "Give an overview of this repository.");
  const focus = node
    ? `The user selected ${node.type} ${node.label} (node_id ${node.id}).`
    : "The user is asking about the whole repository.";

  // Research: the model asks for tools; the application validates and runs them.
  const toolsKey = `${provider.id}:${provider.model}`;
  let native =
    Boolean(provider.completeWithTools) &&
    !NATIVE_TOOLS_UNSUPPORTED.has(toolsKey);
  let malformed = 0;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    signal?.throwIfAborted();
    let decision: Decision;
    if (native) {
      try {
        const turn = await provider.completeWithTools!({
          messages: [
            { role: "system", content: RULES },
            ...history,
            {
              role: "user",
              content: `${focus}\nQuestion: ${question}\n\nEVIDENCE SO FAR${evidence.text}\n\nIf you need more evidence, call Gitty's read-only tools (up to ${MAX_CALLS_PER_ROUND} calls). If the evidence is enough, or nothing more would help, reply with the single word READY.`,
            },
          ],
          tools: toolSpecs(),
          temperature: 0,
          maxOutputTokens: 600,
          signal,
        });
        decision =
          turn.kind === "tool_calls"
            ? {
                kind: "calls",
                calls: turn.calls
                  .slice(0, MAX_CALLS_PER_ROUND)
                  .map((call) => ({
                    tool: call.name,
                    arguments: parseToolArguments(call.arguments),
                  })),
              }
            : decisionFromText(turn.text);
      } catch (error) {
        if (
          !(error instanceof AiToolsUnsupportedError) ||
          request.nativeToolsOnly
        )
          throw error;
        NATIVE_TOOLS_UNSUPPORTED.add(toolsKey);
        native = false;
        round--;
        continue;
      }
    } else {
      const reply = await provider.complete({
        messages: [
          { role: "system", content: RULES },
          ...history,
          {
            role: "user",
            content: `${focus}\nQuestion: ${question}\n\nEVIDENCE SO FAR${evidence.text}\n\nTOOLS (read-only, run by Gitty)\n${toolCatalog()}\n\nDecide whether you need more evidence. Reply with JSON only, no prose:\n- {"tool": "<name>", "arguments": {...}} to request one tool, or {"calls": [ ... up to ${MAX_CALLS_PER_ROUND} ... ]} for several\n- {"ready": true} if the evidence is enough (or nothing more would help).`,
          },
        ],
        temperature: 0,
        maxOutputTokens: 400,
        signal,
      });
      decision = parseDecision(reply);
    }
    if (decision.kind === "ready") break;
    if (decision.kind === "malformed") {
      malformed++;
      if (malformed >= 2) {
        yield {
          type: "status",
          message:
            "Gemma's tool request was malformed; answering from the evidence gathered",
        };
        break;
      }
      addEvidence(
        evidence,
        "NOTE: your previous reply was not valid JSON. Reply with JSON only.",
        [],
      );
      continue;
    }
    for (const call of decision.calls) {
      const name = typeof call.tool === "string" ? call.tool : "?";
      if (call.arguments === MALFORMED_ARGUMENTS) {
        malformed++;
        addEvidence(
          evidence,
          `TOOL ${name} FAILED: the arguments were not valid JSON.`,
          [],
        );
        continue;
      }
      yield { type: "tool", name, summary: summarizeArgs(call.arguments) };
      const result = await executeToolCall(
        loaded,
        call.tool,
        call.arguments,
        signal,
      );
      const added = result.ok
        ? addEvidence(
            evidence,
            `TOOL ${name}(${JSON.stringify(call.arguments)})\n${result.text}`,
            result.output.sources.map((source) => source.path),
          )
        : addEvidence(evidence, `TOOL ${name} FAILED: ${result.error}`, []);
      if (!added) break;
    }
  }

  // Answer, streamed.
  yield { type: "status", message: "Writing answer" };
  let answer = "";
  for await (const text of provider.stream({
    messages: [
      { role: "system", content: `${RULES}\n\n${MODE_INSTRUCTIONS[mode]}` },
      ...history,
      {
        role: "user",
        content: `${focus}\n\nEVIDENCE${evidence.text}\n\nQuestion: ${question}\n\nAnswer in Markdown with [[path:start-end]] citations from the evidence.`,
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 1800,
    signal,
  })) {
    answer += text;
    yield { type: "chunk", text };
  }
  if (!answer.trim()) {
    answer = NO_EVIDENCE_MESSAGE;
    yield { type: "chunk", text: NO_EVIDENCE_MESSAGE };
  }
  const check = await validateCitations(loaded, answer, evidence.seen, signal);
  yield { type: "sources", sources: check.sources, rejected: check.rejected };
  yield { type: "done" };
}
