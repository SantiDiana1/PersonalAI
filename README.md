# PersonalAI

A portfolio monorepo demonstrating two AI-agent architecture patterns that are currently prominent in "agentic engineering":

1. **[Hermes](docs/hermes/spec.md)** — a local deployment (today WSL2/Docker Desktop; the planned target is a Mac Mini) of **[hermes-agent](https://github.com/NousResearch/hermes-agent)** (Nous Research's open-source agent), configured and extended with our own and third-party MCP servers (GitHub, our own Brain) plus a custom Skill that teaches it to pick up tasks and delegate the code work to ephemeral Claude Code instances running in Docker containers. In v1 you can talk to it either by labelling GitHub issues or directly over Telegram — sending it ad-hoc tasks and getting notified when they're done.
2. **[Personal Brain](docs/personal-brain/spec.md)** — a shared memory that agents can query, inspired by the "company brain" pattern described at [vectorize.io](https://vectorize.io/articles/how-to-build-company-brain) and [gurusup.com](https://gurusup.com/es/brain). **Important**: in this project Brain is deliberately built basic (ingestion + semantic similarity search, nothing more) — the consolidation layer (fact extraction, contradiction reconciliation, mental models) that would complete the "company brain" pattern is designed in the spec but remains future work I'll build on my own later. See [personal-brain/spec.md §0](docs/personal-brain/spec.md#0-scope-of-this-project--read-this-first).

These aren't two isolated demos: **Hermes queries Brain (via MCP) before acting.** That's the throughline and the most interesting part of this project from a portfolio standpoint — it isn't "another Claude Code wrapper" or "another RAG over my notes," it's the combination of an already-mature autonomous agent, extended with purpose-built tools, plus a simple memory that keeps real context of what it does.

> **Important**: "Hermes" is not an orchestrator built from scratch. It is [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), an existing MIT-licensed project with a multi-platform gateway (Telegram, Discord, Slack...), persistent memory, a skills system, a cron scheduler, subagent delegation, and execution backends (local, Docker, SSH...) plus native MCP integration. Our work isn't reinventing that engine — it's **deploying and extending it**: registering the MCP servers it needs (GitHub/Notion/Jira/Brain) and building the MCP server that knows how to launch Claude Code in an isolated per-task container. See [hermes/spec.md](docs/hermes/spec.md#0-important-clarification-what-hermes-means-here) for the full detail of this distinction.

## Project goal

This project is, first and foremost, **my personal AI system** — an all-in-one backed by Claude Code, deployed on a local server (today WSL2/Docker Desktop; the planned target is a dedicated Mac Mini — see [docs/architecture.md §Deployment](docs/architecture.md#deployment)), reachable from my phone. It's also a technical portfolio piece (it demonstrates that I can design and build autonomous agents and the Hermes ↔ MCP ↔ memory integration pattern), but that's secondary to actual use. **v1** — see [docs/decisions-log.md §Milestone v1](docs/decisions-log.md#milestone-v1--qué-es-la-primera-versión) — is Hermes deployed locally, resolving GitHub issues, reachable over Telegram, with a basic Brain consulted before acting. Notion/Jira, portfolio polish, and the full Company Brain (real consolidation) remain **future work**, explicitly post-v1 and not blocking the milestone.

## Security

This system executes code written by an autonomous agent, reads text from untrusted sources (GitHub issue bodies, Telegram messages), and runs on a personal machine rather than a disposable server — a combination that is genuinely dangerous if badly assembled. **[docs/security.md](docs/security.md)** is the single source of truth for the project's security model: numbered, non-negotiable requirements (`SEC-x.y`) layered from the home-network perimeter down to the ephemeral container where Claude Code actually runs, plus an explicit section on what the model does **not** protect against. No secret is ever committed to this repository — `.env` files stay local and out of git; only `.env.example` templates with empty values are tracked. If you believe you've found a security issue, please open an issue rather than a PR with a working exploit.

## Getting started

**[docs/quickstart.md](docs/quickstart.md)** — from a clean `git clone` to a running
system, with every manual credential explained and what "done" means for each one.

To work on the code without deploying the full stack, you just need:

- **Node.js 20** or higher
- **pnpm 9** (the repo pins `packageManager` in the root `package.json`)
- **Docker** and **Docker Compose**

## Documentation structure (spec-driven development)

This repo is developed following a _spec-first_ approach: before writing code, detailed specs are defined so that Claude Code (or another coding agent) has enough context to implement without ambiguity.

| Document                                                    | Contents                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/quickstart.md](docs/quickstart.md)                     | From a clean clone to a working system — manual credentials, `.env`, build, verification                                                   |
| [docs/architecture.md](docs/architecture.md)                 | System overview, monorepo structure, Hermes ↔ MCP servers ↔ Brain integration diagram                                                      |
| [docs/roadmap.md](docs/roadmap.md)                            | **Start here to understand what this is and what's next**: current status and open phases                                                  |
| [docs/decisions-log.md](docs/decisions-log.md)               | The full engineering log: every closed phase, every bug found, every discarded hypothesis and every reverted decision, with its reasoning  |
| [docs/agent-evals/spec.md](docs/agent-evals/spec.md)         | Spec for the injection-resistance eval suite — turns `security.md`'s requirements into executable checks (Phase 18)                        |
| [docs/security.md](docs/security.md)                          | **Security model**: numbered non-negotiable requirements (`SEC-x.y`) by layer, what each phase verifies, and which risks are accepted       |
| [docs/hermes/spec.md](docs/hermes/spec.md)                    | Spec for hermes-agent's deployment/configuration + specs for the MCP servers and Skill we built                                            |
| [docs/personal-brain/spec.md](docs/personal-brain/spec.md)   | Full functional and technical spec for the Personal Brain                                                                                   |

## Decisions already made (don't ask again)

- **Hermes = NousResearch/hermes-agent, deployed** — not a custom orchestrator. What we build is: (a) an MCP server that knows how to launch Claude Code in Docker per task, (b) an MCP adapter server for Brain, (c) hermes-agent's configuration (registered MCP servers, cron, model, Telegram gateway), and (d) a Skill that defines the "pick up task → ask Brain → delegate to Claude Code → report" procedure.
- **Stack**: TypeScript throughout the code we build ourselves (the MCP servers, Brain). hermes-agent itself is upstream Python/TypeScript — we don't touch it beyond configuration.
- **Task integrations for Hermes in v1**: GitHub Issues (labelled) and Telegram (conversational, ad-hoc) — both via what hermes-agent already ships (GitHub MCP + native gateway), no custom connectors. Notion and Jira remain future work post-v1.
- **Claude Code execution isolation**: every task runs in an ephemeral Docker container, with its own repo checkout, launched by our `claude-code-runner` MCP server, and destroyed on completion — regardless of whether the task came from GitHub or Telegram.
- **Privilege separation (non-negotiable)**: `claude-code-runner-mcp` runs in its own container and is the **only** one with access to the Docker socket; hermes-agent runs in a container **without** it and talks to the runner over authenticated MCP-over-HTTP on an internal network. Reason: access to the Docker socket ≡ full control of the host, and hermes-agent is the component that ingests untrusted text (issue bodies). See [docs/security.md](docs/security.md).
- **No inbound ports**: talking to Hermes from outside the house requires opening nothing on the router — the Telegram gateway uses long polling and the GitHub cron polls outbound. No tunnels, no port forwarding (SEC-0.1/SEC-0.2).
- **Infrastructure**: a local server (today the Operator's WSL2/Docker Desktop; planned target is a dedicated Mac Mini) running Docker. A VPS was ruled out on cost grounds — see [docs/architecture.md §Deployment](docs/architecture.md#deployment) for the reasoning and the security/availability implications.
- **Relationship between the projects**: Brain is the shared memory, exposed as an MCP server; hermes-agent (and potentially other MCP-compatible agents in the future) query and write to it. Brain must be able to live and be evaluated independently of Hermes.
- **Scope**: personal, not multi-tenant — but Brain's data model is designed so the pattern generalises to a real "company brain" in the future (see Brain's spec, permissions section).
- **Brain stays basic in this project**: ingestion + similarity search, no consolidation layer (LLM-based fact extraction, reconciliation, mental models). That layer is designed in the spec as a reference but not built here — it's future work I'll do on my own.
- **Phase order (Milestone v1 = Phases 0–5)**: foundation (0), `claude-code-runner-mcp` (1), hermes-agent locally + GitHub (2), Telegram (3), basic Brain (4), Brain↔Hermes integration (5). Notion/Jira and portfolio polish are future work, post-v1. See [docs/roadmap.md](docs/roadmap.md).

## Usage metrics

`personalai-metrics` (in `apps/metrics-cli`) prints a read-only report of the system's actual usage: tasks delegated to Claude Code and their per-tool success rate, plus events ingested into Brain. It needs `DATABASE_URL` pointing at the same database used by the runner and Brain.

```sh
pnpm --filter @personalai/metrics-cli run build
DATABASE_URL=postgresql://... node apps/metrics-cli/dist/index.js
DATABASE_URL=postgresql://... node apps/metrics-cli/dist/index.js --json
```

The same metrics can be requested over Telegram: Hermes serves them with the `get_metrics` MCP tool through the `status-report` skill ("give me the metrics", "how many tasks have you resolved?"). The SQL lives in `@personalai/shared`, so both surfaces report the same numbers.

There's also a Telegram **control bot** (`apps/control-bot`) with its own token: `/metrics` answers by computing directly against the database, with no model in the loop and without spending Claude Pro quota. It's the deterministic path; the conversational one still exists for anyone who prefers to ask in natural language.

The task count over the last 5 hours is a **proxy** for the Claude Pro quota window, not actual consumption: Anthropic doesn't expose that telemetry via API (see Phase 12 of the roadmap).

## License

This project is for personal use and is not licensed for redistribution.
