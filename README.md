# Gitora

Understand any GitHub repository: generate an interactive architecture diagram, explore a navigable map of its code, and ask an AI guide questions that are answered with real citations into the source.

Gitora is built on GitDiagram and adds **Gitty**, a codebase explorer powered by Gemma.

**[Try it locally →](http://localhost:3000/)** · Open any repository at `localhost:3000/owner/repo`, or its explorer at `localhost:3000/owner/repo/explore`.

[![Gitora front page](./docs/readme_img.png)](http://localhost:3000/)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- sponsor:start -->

> <a href="http://localhost:3000/out/sent-2026-09?placement=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="./public/sponsors/sent-logo-dark.svg" /><img src="./public/sponsors/sent-logo.png" alt="Sent" width="104" align="middle" /></picture></a>&nbsp;&nbsp; <sub>Sponsored</sub>
>
> SMS, WhatsApp, and RCS through one API. [Try Sent →](http://localhost:3000/out/sent-2026-09?placement=readme)

<!-- sponsor:end -->

## Features

### Gitty: explore a codebase

Open `/owner/repo/explore` to get:

- **Codebase map**: files, symbols and services laid out as an interactive graph, built by static analysis (parsed declarations and resolved imports), not guessed by a model.
- **Ask**: chat with Gitty about the repository. It gathers evidence with read-only tools (`read_file`, `find_symbol`, `find_references`, `get_dependents`, `get_callers`, `search_code`, `get_git_history`, `trace_feature` and more), then streams an answer with `[[path:line]]` citations. Citations to code the model was never shown are rejected.
- **Explain, Why and Impact**: select any node to have it explained, see the evidence for why it exists, or see everything that depends on it before you change it. Dependents are computed deterministically from imports.
- **GitBrief**: a short explanation of whatever you click on the map.
- **Learn**: a suggested reading order through the repository (overview, entry points, core, edges).
- **Trace**: follow a feature across layers. Candidate files and links come from the analysis; the model can only order and explain them.
- **Source viewer and command search** to jump straight to any file or symbol.

Gitty is read-only: it never runs commands, changes files, or sends secrets to the model (outgoing messages are redacted).

### Architecture diagrams

- **AI-generated diagram** of any public or private repository, with a streamed explanation.
- **Jump to the code** by clicking a component's linked file or directory.
- **Private repositories** with a GitHub token via **Private Repos** in the header.
- **Export** as PNG or copy the Mermaid source.
- **Explainer videos** (optional, feature-flagged): a narrated one-minute walkthrough of a repository.

### For AI agents

A read-only MCP server at `http://localhost:3000/mcp` exposes stored diagrams (explanation, components, connections, Mermaid source), and every diagram has a Markdown version at `localhost:3000/owner/repo.md`.

```bash
claude mcp add --transport http gitdiagram http://localhost:3000/mcp
codex mcp add gitdiagram --url http://localhost:3000/mcp
```

## Run locally

Requires [Bun](https://bun.sh/) 1.3.14 or later.

```bash
git clone https://github.com/sripavantejb/gitora.git
cd gitora
bun install
cp .env.example .env
```

Configure what you want to use in `.env`, then start the app:

```bash
bun run dev
```

Open [localhost:3000](http://localhost:3000).

### Gitty only (quickest)

Gitty needs just one AI provider. When the diagram generator is not configured, repository pages open the explorer automatically.

| Option                         | Set in `.env`                                                       |
| ------------------------------ | ------------------------------------------------------------------- |
| Gemma on Hugging Face          | `HF_TOKEN` (optional `HF_GEMMA_MODEL`)                              |
| Gemma on Google AI Studio      | `GEMMA_API_KEY`                                                     |
| Your own Gemma server          | `GEMMA_BASE_URL` (an OpenAI-compatible `/v1` URL) and `GEMMA_MODEL` |
| OpenAI, OpenRouter, or another | `GITTY_AI_PROVIDER` plus that provider's key and `GITTY_MODEL`      |

If `GEMMA_API_KEY` is set alongside another Gemma provider, Google AI Studio is used as an automatic fallback (`GEMMA_FALLBACK=off` disables it). Set `GITHUB_PAT` to raise GitHub's API rate limits. See `.env.example` for timeouts, retries, tool-calling mode and rate limits.

### Diagram generator

The diagram generator additionally needs Cloudflare R2, Upstash Redis, `CACHE_KEY_SECRET`, and an OpenAI or OpenRouter API key. See the [setup guide](docs/dev-setup.md).

Explainer videos are off by default. To turn them on, set `VIDEO_EXPLAINER_ENABLED=1`, `NEXT_PUBLIC_VIDEO_EXPLAINER=1`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `OPENROUTER_API_KEY` in `.env`.

## Development

Built with Next.js 16, React 19, TypeScript, Tailwind CSS and Mermaid.

```bash
bun run test        # vitest
bun run check       # lint + typecheck
bun run format:check
bun run build
```

Project layout:

- `src/app/` — pages and API routes (`api/gitty/*` for Gitty, `api/generate/*` for diagrams)
- `src/server/gitty/` — repository loading, static analysis, the agent, tools and AI providers
- `src/server/generate/` — the diagram generation pipeline
- `src/components/gitty/` — the explorer UI

More detail:

- [Architecture](docs/architecture.md) — generation pipeline, storage, and API
- [Development guide](docs/dev-setup.md) — setup, checks, and deployment
- [Deployment recovery](docs/deployment-failover.md) — Railway/Docker fallback

Contributions are welcome. Open an issue or pull request with a focused description and [verification notes](docs/dev-setup.md#verify).

Maintained by [sripavantejb](https://github.com/sripavantejb).
