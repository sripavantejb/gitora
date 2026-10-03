# GitDiagram plugin

[GitDiagram](http://localhost:3000) turns any public GitHub repository into an interactive architecture diagram. This plugin connects your agent to GitDiagram's remote MCP server (`http://localhost:3000/mcp`, no key or sign-in) and adds a `gitdiagram` skill, so you can ask for a repository's architecture explanation, main components and their source paths, how they connect, and its Mermaid source, or search the diagrams GitDiagram has already made.

## Install

In Claude Code:

```bash
claude plugin marketplace add sripavantejb/gitora
claude plugin install gitdiagram@gitdiagram
```

Then ask something like "how is fastapi/fastapi structured?" or run `/gitdiagram vercel/next.js`.

## Tools

- `get_repository_diagram`: the explanation, components, connections and Mermaid source of a public repository's diagram.
- `find_repository_diagrams`: find a project's exact `owner/repo` among GitDiagram's diagrams.
- `get_explainer_video`: the link and transcript of a repository's narrated explainer video, if one exists.

All tools are read-only. Privacy policy: http://localhost:3000/privacy. Support: sripavantejb@example.com.
