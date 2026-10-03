import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AskStreamEvent } from "~/features/gitty/types";

import { MALFORMED_ARGUMENTS, parseToolArguments, runAgent } from "../agent";
import { runBrief } from "../brief";
import { SHOP_FILES, fixtureRepository } from "../test-fixture";
import { toolSpecs } from "../tools";
import { backoffDelay, isLocalEndpoint, postWithRetry } from "./http";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { FallbackProvider } from "./fallback";
import { GOOGLE_OPENAI_BASE_URL, resolveAiConfig } from "./provider";
import { stripThoughts, ThoughtFilter } from "./thoughts";
import { REDACTED, redactSecrets, withRedaction } from "./redact";
import {
  AiProviderError,
  AiToolsUnsupportedError,
  type AiProvider,
  type AiRequest,
} from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sse = (events: string[]) =>
  new Response(events.map((event) => `data: ${event}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });

describe("resolveAiConfig", () => {
  it("uses an OpenAI-compatible endpoint when GEMMA_BASE_URL is set (no key needed)", () => {
    const config = resolveAiConfig({
      AI_PROVIDER: "gemma",
      GEMMA_MODEL: "gemma-4-26B-A4B",
      GEMMA_BASE_URL: "http://localhost:8000/v1",
    });
    expect(config).toMatchObject({
      id: "gemma",
      style: "openai",
      model: "gemma-4-26B-A4B",
      problem: undefined,
    });
  });

  it("refuses a local endpoint on Vercel", () => {
    const config = resolveAiConfig({
      VERCEL: "1",
      GEMMA_BASE_URL: "http://127.0.0.1:8000/v1",
    });
    expect(config.problem).toMatch(/local address .* Vercel/);
  });

  it("uses Google AI Studio's OpenAI-compatible endpoint with only an API key", () => {
    expect(resolveAiConfig({ GEMMA_API_KEY: "k" })).toMatchObject({
      style: "google-openai",
      model: "gemma-4-26b-a4b-it",
      baseUrl: GOOGLE_OPENAI_BASE_URL,
      problem: undefined,
    });
    expect(resolveAiConfig({ GEMMA_API_KEY: "k" }).fallback).toBeUndefined();
    expect(
      resolveAiConfig({ GEMMA_API_KEY: "k", GEMMA_API_STYLE: "google" }).style,
    ).toBe("google");
    expect(resolveAiConfig({}).problem).toMatch(/GEMMA_BASE_URL/);
  });

  it("adds Google AI Studio as the fallback for another primary", () => {
    const config = resolveAiConfig({ HF_TOKEN: "hf", GEMMA_API_KEY: "k" });
    expect(config.style).toBe("huggingface");
    expect(config.fallback).toMatchObject({
      style: "google-openai",
      model: "gemma-4-26b-a4b-it",
      apiKey: "k",
    });
    expect(
      resolveAiConfig({
        HF_TOKEN: "hf",
        GEMMA_API_KEY: "k",
        GEMMA_FALLBACK: "off",
      }).fallback,
    ).toBeUndefined();
    const vercelLocal = resolveAiConfig({
      VERCEL: "1",
      GEMMA_BASE_URL: "http://localhost:8000/v1",
      GEMMA_API_KEY: "k",
    });
    expect(vercelLocal.problem).toMatch(/local address/);
    expect(vercelLocal.fallback?.style).toBe("google-openai");
  });

  it("ignores AI_PROVIDER values that configure the diagram generator", () => {
    expect(
      resolveAiConfig({ AI_PROVIDER: "openai", GEMMA_API_KEY: "k" }).id,
    ).toBe("gemma");
    expect(
      resolveAiConfig({ GITTY_AI_PROVIDER: "openai", OPENAI_API_KEY: "k" }).id,
    ).toBe("openai");
  });

  it("rejects invalid or credential-bearing URLs and clamps limits", () => {
    expect(resolveAiConfig({ GEMMA_BASE_URL: "not a url" }).problem).toMatch(
      /valid URL/,
    );
    expect(
      resolveAiConfig({ GEMMA_BASE_URL: "https://u:p@host/v1" }).problem,
    ).toMatch(/credentials/);
    expect(
      resolveAiConfig({ GEMMA_BASE_URL: "ftp://host/v1" }).problem,
    ).toMatch(/http/);
    const config = resolveAiConfig({
      GEMMA_BASE_URL: "https://h/v1",
      GEMMA_TIMEOUT_MS: "1",
      GEMMA_MAX_RETRIES: "99",
    });
    expect(config).toMatchObject({ timeoutMs: 5_000, maxRetries: 5 });
  });

  it("uses Gemma on Hugging Face when only HF_TOKEN is set", () => {
    expect(resolveAiConfig({ HF_TOKEN: "hf_x" })).toMatchObject({
      style: "huggingface",
      model: "google/gemma-4-31B-it",
      problem: undefined,
    });
    expect(
      resolveAiConfig({
        HF_TOKEN: "hf_x",
        HF_GEMMA_MODEL: "google/gemma-4-26B-A4B-it",
      }).model,
    ).toBe("google/gemma-4-26B-A4B-it");
    expect(
      resolveAiConfig({ HF_TOKEN: "hf_x", GEMMA_BASE_URL: "https://h/v1" })
        .style,
    ).toBe("openai");
  });

  it("keeps Google's native API for a googleapis base URL unless it is the /openai one", () => {
    const google = "https://generativelanguage.googleapis.com/v1beta";
    expect(
      resolveAiConfig({ GEMMA_BASE_URL: google, GEMMA_API_KEY: "k" }).style,
    ).toBe("google");
    expect(
      resolveAiConfig({
        GEMMA_BASE_URL: `${google}/openai`,
        GEMMA_API_KEY: "k",
      }).style,
    ).toBe("openai");
  });
});

describe("endpoint helpers", () => {
  it("recognises local and private hosts", () => {
    for (const url of [
      "http://localhost:8000/v1",
      "http://127.0.0.1/v1",
      "http://[::1]:8000",
      "http://192.168.1.4/v1",
      "http://10.0.0.2",
    ])
      expect(isLocalEndpoint(url)).toBe(true);
    expect(isLocalEndpoint("https://api.example.com/v1")).toBe(false);
  });

  it("backs off exponentially, honours Retry-After, and caps the wait", () => {
    expect(backoffDelay(0, null, () => 0)).toBe(500);
    expect(backoffDelay(2, null, () => 0)).toBe(2000);
    expect(backoffDelay(0, 3000, () => 0)).toBe(3000);
    expect(backoffDelay(10, null, () => 0)).toBe(8000);
  });
});

const options = {
  label: "Gemma",
  endpoint: "host",
  timeoutMs: 2_000,
  maxRetries: 1,
};

describe("postWithRetry", () => {
  it("retries a transient status, then returns the success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 503, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { response, done } = await postWithRetry(
      "https://host/v1/chat/completions",
      { method: "POST" },
      options,
    );
    done();
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a client error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { response, done } = await postWithRetry(
      "https://host/v1",
      { method: "POST" },
      options,
    );
    done();
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains an unreachable local server after retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(
      postWithRetry(
        "http://localhost:8000/v1/chat/completions",
        { method: "POST" },
        { ...options, maxRetries: 0 },
      ),
    ).rejects.toThrow(/Is the local inference server running/);
  });

  it("times out a silent endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    await expect(
      postWithRetry(
        "https://host/v1",
        { method: "POST" },
        { ...options, timeoutMs: 50, maxRetries: 0 },
      ),
    ).rejects.toThrow(/didn't respond within/);
  });

  it("never retries after the caller aborts", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("aborted"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      postWithRetry(
        "https://host/v1",
        { method: "POST" },
        { ...options, signal: controller.signal },
      ),
    ).rejects.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAICompatibleProvider", () => {
  const provider = new OpenAICompatibleProvider({
    id: "gemma",
    label: "Gemma",
    model: "gemma-4-26B-A4B",
    baseUrl: "http://localhost:8000/v1/",
    maxRetries: 0,
  });
  const request: AiRequest = { messages: [{ role: "user", content: "hi" }] };

  it("posts to /chat/completions without an Authorization header when no key is set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "hello" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider.complete(request)).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/v1/chat/completions");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gemma-4-26B-A4B",
      stream: false,
    });
  });

  it("returns native tool calls with their raw arguments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "a",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const turn = await provider.completeWithTools({
      ...request,
      tools: toolSpecs(),
    });
    expect(turn).toEqual({
      kind: "tool_calls",
      calls: [
        { id: "a", name: "read_file", arguments: '{"path":"README.md"}' },
      ],
    });
  });

  it("reports an endpoint without tool support", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              message: '"auto" tool choice requires --enable-auto-tool-choice',
            },
          },
          { status: 400 },
        ),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      provider.completeWithTools({ ...request, tools: [] }),
    ).rejects.toBeInstanceOf(AiToolsUnsupportedError);
  });

  it("maps failures to actionable messages", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "model not found" } },
            { status: 404 },
          ),
        ),
    );
    await expect(provider.complete(request)).rejects.toThrow(
      /isn't available at localhost:8000/,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 })),
    );
    await expect(provider.complete(request)).rejects.toThrow(
      /rejected the API key/,
    );
  });

  it("streams content deltas", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sse([
            JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
            "[DONE]",
          ]),
        ),
    );
    let text = "";
    for await (const chunk of provider.stream(request)) text += chunk;
    expect(text).toBe("Hello");
  });
});

describe("tool specs", () => {
  it("describe every tool as a JSON Schema object", () => {
    const specs = toolSpecs();
    expect(specs).toHaveLength(12);
    for (const spec of specs) {
      expect(spec.parameters.type).toBe("object");
      expect(spec.parameters).not.toHaveProperty("$schema");
    }
  });

  it("parse model arguments defensively", () => {
    expect(parseToolArguments('{"path":"a"}')).toEqual({ path: "a" });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("{oops")).toBe(MALFORMED_ARGUMENTS);
    expect(parseToolArguments("[1]")).toBe(MALFORMED_ARGUMENTS);
  });
});

describe("redaction", () => {
  it("removes credentials and keeps the surrounding code", () => {
    const text = [
      `const token = "ghp_${"a".repeat(36)}";`,
      `key: AIza${"B".repeat(35)}`,
      `password = "hunter2hunter2"`,
      `postgres://admin:s3cretpass@db.internal:5432/app`,
      `-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`,
      `export function add(a, b) { return a + b; }`,
    ].join("\n");
    const result = redactSecrets(text, []);
    expect(result).not.toMatch(/ghp_a|AIzaB|hunter2|s3cretpass|BEGIN RSA/);
    expect(result).toContain(`password = "${REDACTED}"`);
    expect(result).toContain("postgres://admin:[REDACTED]@db.internal");
    expect(result).toContain("export function add(a, b)");
  });

  it("removes this server's own secret values", () => {
    vi.stubEnv("GITHUB_PAT", "plain-looking-value-1234");
    expect(redactSecrets("echo plain-looking-value-1234")).toBe(
      `echo ${REDACTED}`,
    );
    vi.unstubAllEnvs();
  });

  it("scrubs every message a wrapped provider sends", async () => {
    const seen: string[] = [];
    const inner: AiProvider = {
      id: "test",
      model: "m",
      complete: async (request) => {
        seen.push(...request.messages.map((message) => message.content));
        return "";
      },
      async *stream() {},
    };
    await withRedaction(inner).complete({
      messages: [{ role: "user", content: `github_pat_${"x".repeat(50)}` }],
    });
    expect(seen).toEqual([REDACTED]);
  });
});

async function collect(events: AsyncIterable<AskStreamEvent>) {
  const list: AskStreamEvent[] = [];
  for await (const event of events) list.push(event);
  return list;
}

describe("ThoughtFilter", () => {
  it("removes inline reasoning, including tags split across chunks", () => {
    expect(stripThoughts("<thought>plan it</thought>OK")).toBe("OK");
    expect(stripThoughts("No thoughts here.")).toBe("No thoughts here.");
    const filter = new ThoughtFilter();
    const out = [
      "<tho",
      "ught>secret plan",
      "</tho",
      "ught>\n\nThe ",
      "answer <b>",
    ]
      .map((chunk) => filter.push(chunk))
      .join("");
    expect(out + filter.flush()).toBe("The answer <b>");
    const orphan = new ThoughtFilter();
    expect(
      orphan.push("</thou") +
        orphan.push("ght>An order is saved") +
        orphan.flush(),
    ).toBe("An order is saved");
  });
});

describe("FallbackProvider", () => {
  const ok = (model: string, text = model): AiProvider => ({
    id: "gemma",
    model,
    complete: async () => text,
    async *stream() {
      yield text;
    },
  });
  const failing = (model: string, afterChunk = false): AiProvider => ({
    id: "gemma",
    model,
    complete: async () => {
      throw new AiProviderError("out of credits", 402);
    },
    async *stream() {
      if (afterChunk) yield "partial";
      throw new AiProviderError("out of credits", 402);
    },
  });

  it("uses the backup when the primary fails, and reports which model answered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new FallbackProvider(failing("hf"), ok("google"));
    expect(await provider.complete({ messages: [] })).toBe("google");
    expect(provider.model).toBe("google");
    let text = "";
    for await (const chunk of provider.stream({ messages: [] })) text += chunk;
    expect(text).toBe("google");
  });

  it("keeps the primary when it works", async () => {
    const provider = new FallbackProvider(ok("hf"), ok("google"));
    expect(await provider.complete({ messages: [] })).toBe("hf");
    expect(provider.model).toBe("hf");
  });

  it("never restarts a stream that already produced text, or after an abort", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new FallbackProvider(failing("hf", true), ok("google"));
    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of provider.stream({ messages: [] }))
        chunks.push(chunk);
    }).rejects.toThrow(/out of credits/);
    expect(chunks).toEqual(["partial"]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      new FallbackProvider(failing("hf"), ok("google")).complete({
        messages: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/out of credits/);
  });
});

describe("GitBrief", () => {
  it("explains a node from its context, keeps only verifiable citations, and caches", async () => {
    const loaded = fixtureRepository(SHOP_FILES);
    const node = loaded.graph.nodes.find(
      (entry) => entry.id === "file:src/server/db.ts",
    )!;
    const complete = vi.fn(async (request: AiRequest) => {
      expect(request.messages[1]!.content).toContain("src/server/db.ts");
      return "Creates the database client [[src/server/db.ts:1-3]] used by [[src/made/up.ts:1]].";
    });
    const provider: AiProvider = {
      id: "gemma",
      model: "brief-test",
      complete,
      async *stream() {},
    };
    const result = await runBrief(loaded, node, provider);
    expect(result.sources.map((source) => source.path)).toEqual([
      "src/server/db.ts",
    ]);
    expect(result.rejected).toEqual(["[[src/made/up.ts:1]]"]);
    await runBrief(loaded, node, provider);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("agent tool calling", () => {
  const loaded = fixtureRepository(SHOP_FILES);

  function fakeProvider(overrides: Partial<AiProvider>): AiProvider {
    return {
      id: "gemma",
      model: `m-${Math.random()}`,
      complete: async () => '{"ready": true}',
      async *stream() {
        yield "Orders are created in [[src/server/orders.ts:1-3]].";
      },
      ...overrides,
    };
  }

  it("runs validated native tool calls and rejects unknown or malformed ones", async () => {
    let round = 0;
    const provider = fakeProvider({
      completeWithTools: async () =>
        round++ === 0
          ? {
              kind: "tool_calls",
              calls: [
                {
                  id: "1",
                  name: "find_symbol",
                  arguments: '{"name":"createOrder"}',
                },
                { id: "2", name: "run_shell", arguments: '{"cmd":"cat .env"}' },
                { id: "3", name: "read_file", arguments: "{not json" },
              ],
            }
          : { kind: "text", text: "READY" },
    });
    const events = await collect(
      runAgent({
        loaded,
        provider,
        mode: "ask",
        question: "Where are orders created?",
        history: [],
      }),
    );
    const tools = events
      .filter((event) => event.type === "tool")
      .map((event) => event.type === "tool" && event.name);
    expect(tools).toEqual(["find_symbol", "run_shell"]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("falls back to the JSON protocol when the endpoint rejects native tools", async () => {
    const complete = vi.fn(
      async () => '{"tool": "find_symbol", "arguments": {"name": "saveOrder"}}',
    );
    complete
      .mockResolvedValueOnce(
        '{"tool": "find_symbol", "arguments": {"name": "saveOrder"}}',
      )
      .mockResolvedValue('{"ready": true}');
    const provider = fakeProvider({
      complete,
      completeWithTools: async () => {
        throw new AiToolsUnsupportedError();
      },
    });
    const events = await collect(
      runAgent({
        loaded,
        provider,
        mode: "ask",
        question: "Where are orders saved?",
        history: [],
      }),
    );
    expect(
      events.some(
        (event) => event.type === "tool" && event.name === "find_symbol",
      ),
    ).toBe(true);
    expect(complete).toHaveBeenCalled();
  });

  it("surfaces the error when native tools are required", async () => {
    const provider = fakeProvider({
      completeWithTools: async () => {
        throw new AiToolsUnsupportedError();
      },
    });
    await expect(
      collect(
        runAgent({
          loaded,
          provider,
          mode: "ask",
          question: "?",
          history: [],
          nativeToolsOnly: true,
        }),
      ),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});
