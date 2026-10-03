# GitDiagram

Visualize any codebase: turn any public or private GitHub repository into an interactive architecture diagram, or watch it explained in a one-minute narrated video. AI agents can use it too, through the [MCP server](#use-gitdiagram-from-ai-agents) or the Markdown version of any diagram (`localhost:3000/owner/repo.md`).

**[Try GitDiagram →](http://localhost:3000/)** · Or replace `hub` with `diagram` in any GitHub repository URL.

[![GitDiagram front page](./docs/readme_img.png)](http://localhost:3000/)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- sponsor:start -->

> <a href="http://localhost:3000/out/sent-2026-09?placement=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="./public/sponsors/sent-logo-dark.svg" /><img src="./public/sponsors/sent-logo.png" alt="Sent" width="104" align="middle" /></picture></a>&nbsp;&nbsp; <sub>Sponsored</sub>
>
> SMS, WhatsApp, and RCS through one API. [Try Sent →](http://localhost:3000/out/sent-2026-09?placement=readme)

<!-- sponsor:end -->

## New: explainer videos

GitDiagram can now turn a repository into a narrated video of about a minute. The video starts with what the project is for and what people do with it, then shows briefly how its main parts fit together and one decision under the hood.

[![Watch GitDiagram explain itself in a minute](./docs/readme_video.jpg)](http://localhost:3000/sripavantejb/gitora/video)

- **[Watch the gallery →](http://localhost:3000/videos)** or add `/video` to any diagram URL, such as `localhost:3000/owner/repo/video`.
- **Download an MP4** in landscape or vertical (9:16), with captions burned in.
- **Making new videos is in early access.** Anyone can watch videos that already exist.

## Features

- **Watch a repository explained** in a narrated video, or press **Video** on any diagram page.
- **Explore the architecture** with an AI-generated diagram and streamed explanation.
- **Jump to the code** by clicking any component's linked file or directory.
- **Use private repositories** with a GitHub token via **Private Repos** in the header.
- **Export diagrams** as PNG or copy the Mermaid source.

## Use GitDiagram from AI agents

GitDiagram is a remote MCP server at `http://localhost:3000/mcp` (no key or sign-in). Agents can read a public repository's architecture explanation, components, connections and Mermaid source, search the stored diagrams, and get explainer videos.

[![Add to Claude](https://img.shields.io/badge/Claude-Add_connector-D97757?style=flat-square&logo=claude&logoColor=white)](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=GitDiagram&connectorUrl=https%3A%2F%2Flocalhost%3A3000%2Fmcp)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/link/mcp/install?name=gitdiagram&config=eyJ1cmwiOiJodHRwczovL2dpdGRpYWdyYW0uY29tL21jcCJ9)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=gitdiagram&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Flocalhost%3A3000%2Fmcp%22%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=gitdiagram&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Flocalhost%3A3000%2Fmcp%22%7D&quality=insiders)

```bash
# Claude Code: the plugin adds the MCP server and a /gitdiagram skill
claude plugin marketplace add sripavantejb/gitora
claude plugin install gitdiagram@gitdiagram
# ...or just the MCP server
claude mcp add --transport http gitdiagram http://localhost:3000/mcp

# Codex
codex mcp add gitdiagram --url http://localhost:3000/mcp

# Gemini CLI
gemini extensions install https://github.com/sripavantejb/gitora

# GitHub Copilot CLI
copilot mcp add --transport http gitdiagram http://localhost:3000/mcp
```

In other clients (ChatGPT, Windsurf, Zed, LM Studio, Goose and more), add a remote MCP server with the URL `http://localhost:3000/mcp`. Then ask something like "how is fastapi/fastapi structured?".

## Run locally

Requires [Bun](https://bun.sh/), Cloudflare R2, Upstash Redis, and an OpenAI or OpenRouter API key. See the [setup guide](docs/dev-setup.md) for prerequisites and configuration.

```bash
git clone https://github.com/sripavantejb/gitora.git
cd gitdiagram
bun install
cp .env.example .env
```

Fill in `.env` using the [configuration guide](docs/dev-setup.md#configure), then start the app:

```bash
bun run dev
```

Open [localhost:3000](http://localhost:3000).

Explainer videos are off by default. To turn them on, set `VIDEO_EXPLAINER_ENABLED=1`, `NEXT_PUBLIC_VIDEO_EXPLAINER=1`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `OPENROUTER_API_KEY` (for the voice) in `.env`. See `.env.example` for the other video settings.

## Development

Built with Next.js, React, TypeScript, Tailwind CSS, and Mermaid. Videos use Claude or GPT for the script and scenes and OpenRouter (Gemini 3.8 Flash TTS) for the voice. Deployed on Vercel.

- [Architecture](docs/architecture.md) — generation pipeline, storage, and API
- [Development guide](docs/dev-setup.md) — setup, checks, and deployment
- [Deployment recovery](docs/deployment-failover.md) — Railway/Docker fallback

Contributions are welcome. Open an issue or pull request with a focused description and [verification notes](docs/dev-setup.md#verify).

Inspired by [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/).
