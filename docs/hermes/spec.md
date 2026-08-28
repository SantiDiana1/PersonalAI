# Spec — Hermes

> **A home-scale project.** This spec assumes a single operator, personal use — not production, not multi-user.

## 0. Important clarification: what "Hermes" means here

**Hermes = [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) deployed on a local server (today WSL2/Docker Desktop; a Mac Mini is the planned target, not a VPS — a cost decision, see [architecture.md §Deployment](../architecture.md#deployment))**, not an orchestrator we build from scratch. It is an open-source project (MIT, ~230k★) from Nous Research that already ships with:

- An **agent loop** with a swappable model (Anthropic, OpenAI, OpenRouter, Nous Portal, custom endpoints).
- Its own **persistent memory** (curated memory, FTS5 session search, user modelling) and a **skills system** (procedural memory, compatible with the open [agentskills.io](https://agentskills.io/) standard).
- A **multi-platform gateway** (Telegram, Discord, Slack, WhatsApp, Signal, CLI) — a single process, speakable from a phone while it works on the local server.
- A built-in **cron scheduler** for automations ("daily reports, nightly backups, weekly audits... running unattended").
- **Subagent delegation** to parallelise work.
- **Seven command-execution backends**: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox — with container isolation already part of its security model ("Command approval, DM pairing, container isolation").
- **Native MCP integration**: "Connect any MCP server for extended capabilities" — this is the extension mechanism used for everything hermes-agent does not ship with out of the box.

Given this, **our job is not to reimplement any of the above**. It is to build the three pieces it lacks for this specific use case:

1. **`claude-code-runner-mcp`** — an MCP server that knows how to launch Claude Code in a one-shot Docker container per task (section 3).
2. **`brain-mcp`** — an adapter MCP server over our Personal Brain's API (full contract in [personal-brain/spec.md](../personal-brain/spec.md#52-the-mcp-api-appsbrain-mcp-what-hermes-actually-consumes)).
3. **The `resolve-issue` Skill** — the procedure, in hermes-agent's skill format, telling the agent what to do and in what order (section 5).

Everything else (reading GitHub Issues, reading Notion, reading Jira) is handled by registering **already-existing third-party** MCP servers for those platforms — we write no connectors of our own.

### 0.1 Authentication: two separate paths, not one

> **Rewritten 2026-08-26 (US-13.7).** Until that date this section claimed the _whole_ system authenticated through a single shared Pro session. **That is false** since the Anthropic policy change verified in Phase 12 (US-12.3), and it was not a nuance: it misdescribed **where the money goes**. The previous version sat for a while with an "INVALIDATED" banner on top while the text still said the opposite — it is replaced in full.

The system has **two separate consumption paths**, billed differently. Confusing them is the mistake that cost the whole of Phase 12.

**Path 1 — the runner (`claude-code-runner-mcp`): the Pro subscription. Still works.**

Each task launches a one-shot container that runs `claude -p`, the official Claude Code binary, with `CLAUDE_CODE_OAUTH_TOKEN` injected as an environment variable. Anthropic accepts that use against the subscription: it is its own client. Verified after the lockout with `checkSessionValid` → `{"valid": true}`.

**Path 2 — hermes-agent's agent loop: paid credits. Cannot use the plan.**

hermes-agent makes direct HTTP requests to `api.anthropic.com` and **never invokes the `claude` binary** — checked in its source: `hermes_cli/providers.py` contains no `subprocess`/`Popen`/`spawn`, and the alias `"claude-code": "anthropic"` (line 265) is a pure alias, not a different path. For Anthropic that is a _third-party app_, and since the policy change it rejects it with `HTTP 400 invalid_request_error`: _"Third-party apps now draw from your extra usage, not your plan limits"_.

**It is not a 429 for exhausted quota. It is a 400, a policy rejection.** The distinction is diagnostic and worth keeping handy: a `429 rate_limit_error` means the request **was accepted** and counted against a quota; a `400` means it was not even admitted. That is exactly how it was confirmed, on 2026-08-26, that reactivating credits had unblocked the system: the same call went from `400` to `429`.

Everything conversational depends on path 2 — `run-task`, `resolve-issue`, `resolve-jira-task`, `status-report`, `ask-brain`, `run-design-task`— because all of them go through the agent loop. The control bot (`apps/control-bot`) is the only surface that survives a cutoff of both paths, precisely because it uses no model at all.

**The operational consequence, which is what actually matters**: as long as the agent loop draws on credits, **every turn costs real money**, including every pass of a cronjob that finds nothing to do. Spend control stops being hygiene and becomes the main brake — see US-13.6 in the roadmap (an explicit monthly cap) and the cron cost note in [decisions-log.md](../decisions-log.md#milestone-v2--qué-es-la-segunda-versión).

The secret is still a single one (`hermes-claude-auth`, the OAuth token's value), shared by both paths via their respective `.env` files. What changed is not how the credential is stored, but **what each use is billed against**.

### 0.2 Risk note — updated, no longer theoretical

> **Rewritten 2026-08-26 (US-13.7).** The previous version said "no technical block: the OAuth token is valid for any call". That has stopped being true for the agent loop.

Using a consumer account's OAuth token outside Claude Code and Claude.ai **violates Anthropic's consumer Terms of Service**, and since the policy change **Anthropic enforces it technically**, not only contractually:

- **For the agent loop (path 2), there is a technical block and it has already materialised.** It is not a pending risk: it happened, took down everything conversational in the system, and drove Phases 12 and 13. The way to operate within the rules is for that path to draw on paid credits or another provider — which is the current configuration.
- **For the runner (path 1), the contractual risk remains live and unresolved.** Anthropic today accepts `claude -p` with that token against the subscription, but the use this project makes of it — invoking it unattended from an agent — is not the interactive use the ToS contemplate. It remains **consciously** accepted by the Operator as a low-volume personal experiment, with the same possible consequence as before: the entire Pro account suspended, not just the automated usage.
- **What changed, in one sentence**: the risk stopped being uniform. One path has already been cut off and regularised; the other remains a bet.
- Mitigation unchanged: the token is the single point of failure. If Anthropic revokes the session, it is re-authenticated by hand (§3.3). Re-authentication **is not automated**, deliberately, so as not to worsen the situation with additional token extraction.

### 0.3 Design correction — `hermes-claude-auth` is a token, not a file volume

**Verified in practice while running US-0.4 (Phase 0)**: this document's original design assumed `claude setup-token` generates a persistent session file (something like `~/.claude/.credentials.json`) that could be mounted as a read-only Docker volume and shared between containers. **That is not the case**:

- `claude setup-token` (`Usage: claude setup-token [options]` — _"Set up a long-lived authentication token"_) **prints the token to stdout** and persists no reusable session file in `~/.claude/`. Confirmed by mounting a Docker volume at a one-shot container's `$HOME`, running `claude setup-token` through a full interactive login, and then verifying that neither `~/.claude/.credentials.json` nor any real token in `~/.claude.json` exists (only startup metadata) — the volume was left with no credentials after login.
- The real mechanism, documented by Anthropic for this case (headless/CI), is: capture the printed token and export it as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable — natively supported by both `claude -p` (the CLI) and hermes-agent (`hermes_cli/auth.py: api_key_env_vars=(...,"CLAUDE_CODE_OAUTH_TOKEN")`).

**Corrected design**: `hermes-claude-auth` is the **token's value** (`sk-ant-oat01-...`), generated once with `claude setup-token`, stored as a secret (`.env` outside git on the local server, this project's only environment — never in the repo nor baked into an image), and injected as `CLAUDE_CODE_OAUTH_TOKEN` both in the hermes-agent process and in every ephemeral container of `claude-code-runner-mcp`. Every reference in this document to a "`hermes-claude-auth` volume mounted read-only at `/root/.claude`" should be read as "`CLAUDE_CODE_OAUTH_TOKEN` environment variable injected from the `hermes-claude-auth` secret" — the rest of the reasoning (single shared session, no API key, the §0.2 ToS risk, manual re-authentication) does not change.

Verified end to end (US-0.4): `docker run --env-file .env ... claude -p "..."` responds correctly using only `CLAUDE_CODE_OAUTH_TOKEN`, with the token's value never exposed in any log.

**This section remains valid as written** after the §0.1/§0.2 rewrite (US-13.7): the finding is about **how the credential is stored** (a token in an environment variable, not a file volume), and Anthropic's policy change did not touch that. The only phrase that needs re-reading with §0.1 in mind is "single shared session": the credential is indeed a single one, but **what is billed against it is no longer**.

## 1. Objectives

- Reduce the time between "I write an issue in one of my repos (or send it a task over Telegram)" and "I have a PR that resolves it, or tries to".
- Turn Hermes into my personal AI system, speakable from my phone (Telegram, §9) — not just a bot that reacts to GitHub labels.
- Show how to extend an already-mature third-party agent with our own MCP servers and skills, rather than building an orchestrator from scratch.
- Demonstrate a safe isolation pattern for delegating code execution to a coding agent (Claude Code) without giving it unrestricted access to the local server.
- Serve as a reference consumer of Brain — validate that organisational memory adds real value to an acting agent.
- Experiment, for personal use, with a single auth mechanism via the Pro subscription for the whole system (see §0.1), avoiding separate API credentials for each component.

## 2. Non-objectives (v1)

- We do not modify hermes-agent's source — it is deployed as is (upstream image) and only configured; its `anthropic`/`claude-code` provider already supports `CLAUDE_CODE_OAUTH_TOKEN` out of the box (see §0.1/§0.3), no wrapper needed.
- It does not replace a human reviewing the PR before merging — the flow opens PRs, it does not merge them automatically.
- It does not manage whole projects or plan sprints — it only executes tasks already defined and explicitly labelled for it.
- It supports no multiple users/tenants — a single operator (me) configures their own credentials and their own hermes-agent instance.
- It implements no heuristics for which issues are worth picking up — selection is explicit (label/state at the source), not inferred.
- Re-authenticating the Claude Code session when it expires or is revoked is not automated — it is a manual step for the operator (see 3.3).
- This system is not deployed for third parties nor offered as a service — strictly personal use, given the ToS risk described in §0.2.

## 3. `claude-code-runner-mcp`

The component closest to "building an executor from scratch" in the whole project — the piece we genuinely write ourselves, in TypeScript.

### 3.1 MCP contract

It exposes two tools. `run_coding_task` is the main one (the only one until Phase 5);
`get_runner_status` was added in Phase 6 ([decisions-log.md — Phase 6](../decisions-log.md#fase-6--cierre-operativo-y-superficie-conversacional),
US-6.3/US-6.4) as a bounded exception to the original design's "single tool"
principle — it is read-only, takes no parameters, and does not widen the
attack surface the way a generic execution tool would (see the docstring of
`createMcpServer` in `src/mcpServer.ts` for the full reasoning):

```ts
// tool: get_runner_status
//
// No input. Read-only summary for the status-report skill (on demand) and
// the periodic summary cronjob. Reuses checkSessionValid (§3.3) — it
// launches the same session-check one-shot container run_coding_task uses —
// plus a new query against runner.task_runs (§7).
interface GetRunnerStatusOutput {
  session:
    { valid: true } | { valid: false; reason: 'expired' | 'revoked' | 'unknown'; detail: string };
  persistenceAvailable: boolean; // false if DATABASE_URL is not configured
  tasksNeedingAttention: Array<{
    id: string;
    repo: string;
    taskTitle: string;
    status: 'needs_human_input' | 'failed';
    startedAt: string;
    finishedAt?: string;
  }>; // needs_human_input/failed from the last 7 days
  tasksStartedLast5h: number | null; // an approximation, NOT real Anthropic telemetry
  tasksStartedLast7d: number | null;
}
```

`run_coding_task`:

```ts
// tool: run_coding_task
//
// Auth: the container receives NO new Anthropic credential. It inherits
// the operator's Claude Code session via the hermes-claude-auth secret
// (a long-lived token, injected as the CLAUDE_CODE_OAUTH_TOKEN
// environment variable), generated once on the host with
// `claude setup-token`. It is the SAME session hermes-agent uses for its
// own chat (see spec §0.1/§0.3). See §3.2 and §3.3.
interface RunCodingTaskInput {
  repo: string; // owner/repo
  baseBranch?: string; // defaults to the repo's default branch
  taskTitle: string;
  taskDescription: string;
  brainContext?: string; // text already retrieved from brain-mcp, to inject into the prompt
  timeoutSeconds?: number; // defaults to 1800 (30 min)
}

interface RunCodingTaskOutput {
  status: 'success' | 'failed' | 'needs_human_input' | 'timed_out';
  branchName?: string; // the pushed branch, if there were changes
  commitShas?: string[];
  summary: string; // a summary of what was done, generated by Claude Code
  logsUrl?: string; // a reference to stored logs, if applicable
}
```

`needs_human_input` covers both the cases where Claude Code needs clarification about the task and the case of an expired or revoked Claude Code session (see 3.3) — the `summary` distinguishes the reason.

### 3.2 What it does internally

1. Checks that the Claude Code session token (`hermes-claude-auth`) is still valid (see 3.3). If not, it returns `status: 'needs_human_input'` immediately, without launching a container.
2. Shallow-clones the given repo into an ephemeral volume.
3. Generates a `prompt.md` with: the task's title + description, `brainContext` if provided, and basic repo style/convention instructions.
4. Launches a Docker container (`docker run`, via `dockerode`) from a `claude-code-runner-image` image (Node.js + git + the Claude Code CLI installed, no credentials baked in).
5. Mounts the volume with the repo + `prompt.md`, and injects as environment variables: `CLAUDE_CODE_OAUTH_TOKEN` (the `hermes-claude-auth` secret, the operator's authenticated Claude Code session) and a short-lived GitHub token scoped to that specific repo.
6. Runs `claude -p` non-interactively against the prompt, with a timeout.
7. On completion (or timeout), collects from the container: the generated commits and a `result.json` that Claude Code (or a wrapper around it) writes with a summary and status.
8. Runs `docker rm -f` on the container — always, whatever the outcome. The `hermes-claude-auth` secret is neither touched nor destroyed; it is shared across runs, including hermes-agent's own.
9. Pushes the branch (if there were changes) and returns the `RunCodingTaskOutput` as the MCP tool's response. Opening the PR itself is **not** done by this tool — the Skill does that by calling the GitHub MCP, so GitHub logic is not duplicated in two places.

### 3.3 Known limitation: session expiry or revocation

Claude Code's OAuth session token expires periodically (on the order of hours) and, being used outside Anthropic's intended use (§0.2), can also be **revoked without notice** if Anthropic detects the usage pattern. This is an accepted limitation, not a bug to fix:

- `claude-code-runner-mcp` checks the session's validity (e.g. `claude /status` or equivalent) **before** launching each container (step 3.2.1).
- hermes-agent itself should run an equivalent check before processing any message, since it shares the same session.
- If the session has expired or been revoked, the tool returns `status: 'needs_human_input'` with an explicit `summary`, distinguishing the two cases where possible ("session expired, requires `claude /login`" vs. "session rejected by the server — possible revocation, check account status before retrying").
- The `resolve-issue` Skill (section 5) treats this case like any other `needs_human_input`: it comments on the original task and opens no PR.
- Re-authentication (`claude /login` or `claude setup-token` on the host) is **manual**. It is not automated.
- Practical consequence: if Hermes is going to run unattended for several days, this status is worth monitoring (via hermes-agent's Telegram/Discord gateway, section 9) so that expiry — or an eventual account suspension — is not discovered only once tasks pile up in `needs_human_input`.

### 3.4 Execution isolation (non-negotiable)

The full, numbered requirements live in **[docs/security.md](../security.md)**, the single source of truth. Summary of what applies to this component:

- One ephemeral container per task, destroyed on completion or timeout — no orphan containers are ever left behind (SEC-5.4).
- The container **has no access to the Docker socket** (SEC-5.1) and its network is restricted to an allowlist (`api.anthropic.com`, `github.com`), with no free internet access (SEC-5.2).
- Least-privilege GitHub credentials (SEC-6.1), never a global account token. The Claude Code token, shared via the `hermes-claude-auth` secret, is injected only as an environment variable, never written to disk (SEC-6.2).
- No access to the host filesystem beyond that task's ephemeral workspace (SEC-5.6).
- `claude-code-runner-mcp` is the **only** component in the system with access to the host's Docker socket (SEC-4.1) — neither hermes-agent nor brain-mcp have it.

This is the most sensitive security part of the project: an agent that executes arbitrary code delegated by another agent is, by definition, an attack surface. Special care around **prompt injection** from third-party issue bodies (see section 6 and [security.md §0](../security.md#0-why-this-document-exists)).

### 3.5 MCP transport: HTTP on the internal network, not stdio

**Architecture decision (Phase 2).** The runner is exposed over **Streamable HTTP** (the official SDK's `StreamableHTTPServerTransport`), not stdio, and runs in **its own container** — the only one with the Docker socket mounted.

The reason is direct: an stdio MCP server runs as a _subprocess of its client_. Registering the runner over stdio would make it live inside the hermes-agent container, and that container would then need the Docker socket — precisely the component that ingests untrusted text. That breaks SEC-2.1, the requirement the whole architecture hangs from. See the comparison of rejected alternatives in [security.md §1](../security.md#1-the-central-concept-the-docker-socket-is-the-master-key).

Consequences:

- Registered in hermes-agent with `hermes mcp add claude-code-runner --url http://claude-code-runner:8080/mcp --auth header` (not `--command`).
- The port is **not published** to the host or the LAN — it lives only on the internal Compose network (SEC-3.1).
- Every request requires `Authorization: Bearer <secret>` (SEC-3.2). No valid header → `401`, nothing executes.
- The surface remains exactly one tool, `run_coding_task` (SEC-3.3).

### 3.6 Implementation note: workspace paths in a containerised deployment

A non-obvious detail that **blocks** the deployment in §3.5 if ignored, found while designing Phase 2.

When the runner ran on the host (Phase 1), it cloned the repo into its own temporary directory (`mkdtemp` under `/tmp`) and passed it as a bind mount to the ephemeral container. That works because the path exists on the host, which is what resolves bind mounts.

Putting the runner inside a container **breaks this silently**: the runner would ask the Docker daemon to mount `/tmp/claude-code-runner-XXX`, but the daemon resolves that path **on the host**, where it does not exist (or, worse, exists as something else). The ephemeral container would receive an empty `/workspace` and the task would fail confusingly, with no clear error.

**Solution adopted**: a dedicated workspace root, mounted in the runner's container at **the same path** it has on the host (e.g. `/var/lib/personalai/workspaces` → `/var/lib/personalai/workspaces`). That way every path the runner computes is also valid for the daemon. This requires making the checkout root configurable (the `CLAUDE_CODE_RUNNER_WORKSPACE_ROOT` variable) instead of using `os.tmpdir()` directly. That root contains only project workspaces (SEC-4.4).

**Verified empirically (Phase 2, US-2.1)**, running the same scenario under both configurations from inside the runner's container: without the shared root, the sibling container receives an **empty** `/workspace` (confirming the failure is real and silent); with the root mounted at the same path, it correctly sees the checkout's contents.

**Operational note**: since the runner's container runs as root (see the reasoning in its `Dockerfile`), workspace directories appear on the host owned by root. This is not a functional problem — they are created and deleted by the runner itself, which is root inside its container — but it is worth knowing when inspecting or cleaning that root by hand from the host.

### 3.7 `run_claude_command` (Phase 8 of the [roadmap](../decisions-log.md#fase-8--comandos-de-claude-code-vía-chat-run_claude_command))

**Implemented, with the contract redesigned after empirically verifying US-8.1** — see the real finding below. This section's original design (before implementation) proposed returning an already-published `artifactUrl`; it was dropped on real evidence, not on a hypothesis.

**Motivation**: `run_coding_task` assumes a task's result is code — a branch with commits. But Claude Code ships slash commands that produce no diff, but a self-contained HTML page instead (`/design` for design canvases, `/dataviz` for visualisations). Hermes had no way to be asked "design me a landing page for X" and return that kind of deliverable — it only knew how to ask for code.

**Real finding (US-8.1)**: verified empirically, twice — first with `ANTHROPIC_API_KEY`, then repeating the test with the real OAuth token from `hermes-claude-auth` (the exact same mechanism this runner uses in production) — that `claude -p` in headless mode **does not have the `Artifact` tool available in the session's toolset**, and it does not even appear as a deferred tool (`ToolSearch` returns "No matching deferred tools found"). This happens even though the [official Artifacts documentation](https://code.claude.com/docs/en/artifacts) lists the Pro plan as compatible and does not explicitly exclude `-p`/headless mode from its availability table (it only excludes "Agent SDK, GitHub Action, and MCP server contexts"), and even though the rest of the documented requirements are met (CLI v2.1.245 ≥ v2.1.183 required, no `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`/`CLAUDE_CODE_DISABLE_ARTIFACT`). With real Claude Code trying to publish, the observed error was the one expected by design (`ToolSearch` with no result), not a network or plan error — so it is not (only) the proxy allowlist either (`api.anthropic.com`/`github.com`, without `platform.claude.com`/`claude.ai`, which the [network documentation](https://code.claude.com/docs/en/network-config) flags as necessary for auth/publish) that blocks it, although that would also need widening if this changed. Conclusion: not confirmable without access to the real deployment (the eventual Mac Mini) to rule out something host-specific, but with the same image/CLI/token there is no reason to expect a different result there.

**Implemented MCP contract** (`apps/claude-code-runner-mcp/src/types.ts`), a new tool separate from `run_coding_task`:

```ts
// tool: run_claude_command
//
// Same auth, same container isolation and same rate limiting as
// run_coding_task (§3.2–§3.4) — it shares infrastructure, it is not a
// new component, just a second way of invoking the same runner.
const ALLOWED_SLASH_COMMANDS = ['/design', '/dataviz'] as const;

interface RunClaudeCommandInput {
  slashCommand: (typeof ALLOWED_SLASH_COMMANDS)[number]; // validated against the fixed allowlist, NOT an arbitrary command
  prompt: string; // free text after the command (e.g. "landing page for my project X")
  repo?: string; // optional: only if the command needs context from a specific repo (cloned read-only, no push)
  brainContext?: string; // same as in run_coding_task
  timeoutSeconds?: number; // defaults to 900 (15 min)
}

interface RunClaudeCommandOutput {
  status: 'success' | 'failed' | 'needs_human_input' | 'timed_out';
  htmlContent?: string; // the actual self-contained HTML generated — NEVER an already-published link
  summary: string;
  logsUrl?: string;
}
```

Design points:

- **A command allowlist, not free-form commands.** The same principle as "the MCP surface remains exactly one tool" (SEC-3.3) — here it translates into "the executable-command surface is exactly this list" (`ALLOWED_SLASH_COMMANDS`), validated both in the tool's Zod schema (`mcpServer.ts`) and in `runClaudeCommand()` (`isAllowedSlashCommand`, defence in depth if something calls it directly).
- **No commit, no PR, no publishing.** The deliverable is `htmlContent`. The container entrypoint (`docker/runner/entrypoint.sh`, mode detected by the presence of `command-prompt.md` instead of `prompt.md`) asks Claude Code to write the result to `/workspace/artifact-output.html` instead of trying to publish it — the runner reads it from there after `docker wait`, the same way it already reads `result.json` for `run_coding_task`.
- Container isolation (SEC-5.\*), the shared session (§0.1) and rate limiting (SEC-4.3) apply the same way they do to `run_coding_task` — they share the same runner and the same 5h/weekly window quota.

**Delivering the result**: reuses the immediate-confirmation-plus-one-shot-cronjob mechanism from §9.3. **A real correction, verified in production** (the first real request from Telegram): pasting `htmlContent` as plain text is technically correct but useless in practice — the Operator cannot open a landing page from a code block on their phone. Fix: `run_claude_command` also writes a persistent copy of the HTML to `CLAUDE_CODE_RUNNER_ARTIFACTS_DIR` (if configured — a volume shared at the same path between `claude-code-runner` and `hermes`, the same pattern as §3.6's `WORKSPACE_ROOT`) and returns `htmlFilePath`; the Skill then replies with the `MEDIA:<htmlFilePath>` tag that hermes-agent's gateway recognises and delivers as a real, openable `.html` attachment. Without the variable configured, it falls back to pasting `htmlContent` as text, explicitly warning that it needs to be saved by hand. Actually publishing it as an Artifact on claude.ai (copying it into the Operator's own Claude Code/claude.ai session) remains a manual action either way.

**Dedicated skill: `run-design-task`** (`hermes/skills/run-design-task/`), not an extension of `run-task`/`resolve-issue` — mixing "coding task" and "Artifact task" in the same skill would force that discrimination logic to live inside an already-complex skill. Triggered by chat (Telegram), following the same pattern as `run-task` (§9.3: immediate confirmation + `cronjob(repeat: 1)`). The issue/ticket-triggered variant is left unbuilt — there is no real use case for it yet, and it will be added if one appears.

## 4. Third-party MCP servers (GitHub, Notion, Jira, Azure DevOps)

Already-existing, maintained MCP servers are used, not connectors of our own:

- **GitHub**: [github/github-mcp-server](https://github.com/github/github-mcp-server) (official). Authenticates with a GitHub App or a fine-grained PAT, scoped only to the repos where I want Hermes to act (`issues:write`, `contents:write`, `pull_requests:write` — nothing else).
- **Notion**: Notion's official MCP server. Points at one specific database ("Hermes Tasks"), filtered by a `status` property.
- **Jira**: an Atlassian/community MCP server, configured with a fixed JQL (`labels = hermes AND status = "To Do"` by default). The Operator's **personal** source (post-v1, [decisions-log.md — Phase 7](../decisions-log.md#fase-7--ampliar-fuentes-y-canales)).
- **Azure DevOps**: an official or community MCP server (evaluate [microsoft/azure-devops-mcp](https://github.com/microsoft/azure-devops-mcp) at implementation time), with a work-item filter equivalent to Jira's JQL. A source belonging to **the Operator's employer** — **never** registered on the same hermes-agent instance as the personal sources. See §4.1.

Registered in hermes-agent (`hermes/config/hermes.config.yaml` + `hermes mcp add <server>`), each with its own least-privilege credentials. These credentials (GitHub/Notion/Jira/Azure DevOps) are conventional API keys/tokens — only the Anthropic model part uses the shared Pro session (§0.1), and only on the personal instance (§4.1).

### 4.1 Dual deployment: personal instance vs. work instance (post-v1)

**Architecture decision** (full detail and reasoning in [decisions-log.md — Phase 10](../decisions-log.md#fase-10--despliegue-dual-instancia-personal-vs-instancia-de-trabajo--futurible)): as soon as Azure DevOps (or another source belonging to the Operator's employer) enters the picture, it is **not** added as one more MCP server to the already-deployed hermes-agent instance. A **second, complete instance** is deployed, isolated from the first: its own `docker-compose.yml`, its own `.env`, its own Docker network, its own Telegram bot (a different `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_USERS`), and — crucially — **its own Anthropic auth**, not `hermes-claude-auth`. The ToS risk described in §0.2 is explicitly accepted for personal use; it is not simply carried over to an employer's data and credentials.

Direct consequence for `claude-code-runner-mcp`: if the work instance ever needs to execute coding tasks, that is a **separate deployment** of the component (its own container, its own `CLAUDE_CODE_RUNNER_AUTH_TOKEN`, its own Postgres database) — not a "client" parameter added to the personal runner. The isolation in §3.4 applies the same way, but twice over.

Numbered, verifiable requirements in [security.md §9 (SEC-7.1–SEC-7.5)](../security.md#9-layer-7--isolation-between-the-personal-and-work-instances-phase-10-of-v2).

## 5. The `resolve-issue` Skill

Lives in `hermes/skills/resolve-issue/`, in hermes-agent's skill format (compatible with [agentskills.io](https://agentskills.io/) — exact format confirmed at implementation time, using upstream `hermes-agent/skills/` and `hermes-agent/optional-skills/` as reference). It is, essentially, a natural-language procedure plus metadata that the agent itself executes using the available MCP tools:

1. Lists candidate tasks by calling the GitHub MCP / Notion MCP / Jira MCP tools (issues/tickets with the agreed label or state).
2. For each new task: calls `brain_query` (brain-mcp) with the task's title/description to get relevant context (conventions, prior decisions, similar past issues).
3. Calls `run_coding_task` (claude-code-runner-mcp) with the task plus Brain's context.
4. If `status === 'success'`: opens a PR via the GitHub MCP with the summary as its description, and comments on the original task (in whichever source it came from) with the link.
5. If `failed`/`needs_human_input`/`timed_out`: comments on the original task explaining what happened, without opening a PR.
6. Always calls `brain_record_observation` (brain-mcp) with the result — this step is not optional, it is what closes the learning loop.

hermes-agent's **native cron** (`hermes cron`) fires this skill every N minutes (configurable). No scheduler of our own is built.

## 6. Security — component-specific checklist (OWASP-relevant)

> The complete model, layered and with numbered requirements (`SEC-x.y`) verifiable phase by phase, lives in **[docs/security.md](../security.md)**. This section summarises what is specific to Hermes; on any discrepancy, `security.md` wins.

- **Prompt injection from external issues/tickets**: an issue's body is untrusted input — it can contain instructions aimed at the agent ("ignore your instructions and..."). This is the _expected_ failure mode, not a hypothesis. The defence is not trying to detect the injection, but making sure **the component that ingests it holds no dangerous permissions**: hermes-agent runs in a container with no Docker socket (SEC-2.1) and the most it can ask the runner for is a fixed-shape coding task (SEC-3.3). Even if the ephemeral container's prompt is compromised, that container has no free network (SEC-5.2) nor access to the host (SEC-5.6).
- **hermes-agent command approval**: the defaults `approvals.mode: manual` and `approvals.cron_mode: deny` are kept (SEC-2.3). A nuance verified in hermes-agent's source (`tools/approval.py`): this mechanism covers **shell commands**, not MCP tool calls — which is why the `resolve-issue` Skill works exclusively via MCP (section 5), letting it run unattended under cron **without** relaxing `cron_mode`.
- **Agent access from Telegram**: deny by default plus an explicit user allowlist (SEC-1.1); the allow-all flags are never enabled (SEC-1.2). See also §9.4.
- **Network perimeter**: zero inbound ports on the home router (SEC-0.1) — possible because both Telegram (long polling) and the GitHub cron generate exclusively outbound traffic.
- **Secret management**: GitHub/Notion/Jira tokens in a `.env` outside git on the local server — never in the repo nor baked into any Docker image. The Claude Code token (`hermes-claude-auth`) lives exclusively in a `.env`/secret store outside git, injected as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, and is never copied into the image nor written to disk inside a container.
- **Least privilege**: the GitHub App/PAT is limited to the explicitly chosen repos, not the whole account.
- **Rate limiting**: a limit on concurrent/hourly tasks in `claude-code-runner-mcp`, to keep a loop (e.g. an issue that re-opens itself) from exhausting the Pro subscription's 5h/weekly window or GitHub's quota. Especially relevant here because **hermes-agent and `claude-code-runner-mcp` share the same quota** (§0.1) — a spike of coding tasks can leave chat with no window left, and vice versa.
- **Account risk (§0.2)**: since this use violates the consumer ToS, it is recommended not to use the personal "work" Pro account (the one used for daily professional development) for this experiment, if keeping a separate low-cost account dedicated only to Hermes is feasible — that way an eventual suspension does not affect professional use. This is left as an operator decision, not a spec requirement.

## 7. Data model

hermes-agent manages its own memory/state — we do not duplicate it. The only thing we persist ourselves is `claude-code-runner-mcp`'s operational state (Postgres, `runner` schema):

```sql
create table task_runs (
  id uuid primary key default gen_random_uuid(),
  repo text not null,
  task_title text not null,
  status text not null default 'running', -- running|success|failed|timed_out|needs_human_input
  brain_context jsonb,
  result jsonb,
  branch_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

Mostly useful for debugging and for personal usage metrics (number of tasks resolved, success rate, frequency of `needs_human_input` due to an expired/revoked session).

## 8. Technical stack

- **hermes-agent**: deployed as is (upstream Docker image), with no code changes at all — its `anthropic`/`claude-code` provider already supports `CLAUDE_CODE_OAUTH_TOKEN` out of the box (see §0.1/§0.3). No wrapper needed.
- **`claude-code-runner-mcp`** and **`brain-mcp`**: TypeScript + Node.js, the official MCP SDK (`@modelcontextprotocol/sdk`), `dockerode` to orchestrate containers.
- Postgres for the runner's operational state (a schema separate from Brain's).
- `pino` for structured logging.
- The `hermes-claude-auth` secret (the long-lived `CLAUDE_CODE_OAUTH_TOKEN` token, generated manually by the operator before the first deployment via `claude setup-token` run on the host, stored in a `.env`/secret store outside git), **shared between hermes-agent and `claude-code-runner-mcp`** — see §0.3.

## 9. Conversational interaction (Telegram)

Hermes is not just "a bot that closes GitHub issues" — this project's goal (see `docs/decisions-log.md` §Milestone v1) is for it to be my personal AI system, speakable from my phone. hermes-agent already ships with a multi-platform gateway out of the box (§0); this section documents specifically how the Telegram channel is used, implemented in Phase 3 of the roadmap.

### 9.1 Gateway configuration

`hermes gateway setup` registers the Telegram bot (a bot token from @BotFather) and turns on **DM pairing**: the gateway only responds to a `chat_id` explicitly paired by the Operator. Any message from an unpaired `chat_id` is ignored or answered with an explicit rejection — a task is never executed on the basis of an unverified sender. This reuses the same security model hermes-agent already documents ("Command approval, DM pairing, container isolation", §0), it is not a new mechanism.

### 9.2 From message to task

A conversational message like "resolve issue #42 in my-repo" or "fix X in repo Y" is translated into the same parameters (`repo`, `taskTitle`, `taskDescription`) that `run_coding_task` consumes — it is the same tool the `resolve-issue` Skill uses (section 5), only the trigger is a chat message rather than the GitHub cron. The skill implementing this is `run-task` (`hermes/skills/run-task/SKILL.md`), available in any interactive turn (not only under cron) via hermes-agent's standard progressive-disclosure mechanism (`skills_list()`/`skill_view()`). If the message does not make the repo or the task's scope clear, Hermes asks before executing — it never assumes a default repo nor over-interprets an ambiguous request.

### 9.3 Immediate confirmation and completion notification

`run_coding_task` can take up to the configured timeout (30 minutes by default, §3.1) — it would not be reasonable to leave the Telegram conversation blocked waiting for the tool's response within the same turn.

**Mechanism chosen: a one-shot cronjob (`cronjob(action='create', repeat=1)`), with no explicit `deliver`.** Implemented in the `run-task` skill (`hermes/skills/run-task/SKILL.md`).

This section's original design laid out two options to decide between empirically during Phase 3: subagent delegation (`delegate_task`) as the preferred one, and polling `runner.task_runs` via cron as a fallback. **Neither was used**, after reading hermes-agent's actual source (`tools/delegate_tool.py`, `tools/cronjob_tools.py`) inside the deployed container itself:

- **`delegate_task` is dropped, it is not a viable alternative.** Its own tool description says so explicitly: it runs _synchronously_ within the parent turn, and if the parent turn is interrupted (the Operator sends another message, `/stop`, `/new`) the child is cancelled and its work discarded — "children cannot continue in the background". That is exactly the opposite of what US-3.3/US-3.4 need: a task lasting up to 30 minutes, where it is more than likely the Operator writes something else in the meantime. The tool's own documentation recommends, for "durable work that must survive the current turn", using `cronjob(action='create')` — which is what was implemented.
- Polling `runner.task_runs` was not needed: hermes-agent's cronjob delivery mechanism already solves this natively. If the `deliver` parameter is omitted when creating the job, `tools/cronjob_tools.py::_origin_from_env()` captures `platform`/`chat_id`/`thread_id` from the active session (via `gateway.session_context.get_session_env`) and uses them as the default destination — the same mechanism (`cron.wrap_response: true`) already used by any hermes-agent cronjob, not a channel purpose-built for this project.

The resulting flow, in two separate turns:

1. **Interactive turn (Telegram → Hermes)**: acknowledges the request, clarifies if needed (§9.2), and as soon as `repo`/`taskTitle`/`taskDescription` are clear, calls `cronjob(action='create', prompt=<self-contained>, schedule=<a few seconds in the future>, repeat=1)` with no `deliver` set. Replies immediately — "Got it, I'm on it — I'll let you know right here when it's done" — without waiting for the cronjob to fire. This turn ends here; the chat is free again.
2. **The cronjob's turn (independent, minutes later)**: the self-contained prompt (the sub-turn has no memory of the original conversation) instructs it to call `run_coding_task` and, if `status === 'success'`, open a PR with the GitHub MCP's `create_pull_request`. Its final response is delivered automatically to the originating chat/thread — with no explicit `send_message` call nor delivery logic of our own.

Pending verification (Phase 3, US-3.3/US-3.4): at least one real end-to-end run, including a task lasting several minutes, confirming the confirmation arrives within seconds and the completion notice reaches the same thread with no manual intervention.

### 9.4 Security

The input channel (GitHub vs. Telegram) never changes the execution's security guarantees: a task started from Telegram goes through the same `run_coding_task`, with the same container isolation (§3.4) and the same rate limiting (SEC-4.3), as one originating from a GitHub issue (SEC-1.4).

Two points specific to this channel, both non-negotiable:

- **Access control (SEC-1.1/SEC-1.2)**: a Telegram bot is discoverable — its username is public and anyone can message it. hermes-agent already denies by default (verified in `gateway/run.py::_is_user_authorized`, whose resolution ends in "Default: deny"); on top of that an explicit allowlist (`TELEGRAM_ALLOWED_USERS`) and/or hand-approved DM pairing is set. The allow-all flags (`GATEWAY_ALLOW_ALL_USERS`, `TELEGRAM_ALLOW_ALL_USERS`) are never enabled. Verified with a second Telegram account, not assumed.
- **No network exposure (SEC-0.1)**: talking to Hermes from outside the house **requires opening no router port**. The gateway uses long polling against `api.telegram.org` (`getUpdates`, verified in `gateway/platforms/telegram.py`), not webhooks: both the Operator and Hermes talk to Telegram's servers, never directly to each other. Any suggestion to "expose it with a tunnel to make it work" signals a misunderstanding, not a real need.

### 9.5 `status-report` and `ask-brain` (Phase 6)

Two more conversational skills, alongside `run-task` — both
read-only (never call `run_coding_task`, never mutate anything beyond
`brain_ingest` on Brain's own memory), documented in detail in
`hermes/skills/status-report/SKILL.md` and `hermes/skills/ask-brain/SKILL.md`.

- **`status-report`**: replies with Hermes' operational state (shared OAuth
  session, tasks in `needs_human_input`/`failed`, an approximate reading of
  the Pro window's usage) via the `get_runner_status` tool (§3.1). Two
  triggers for the same skill: on demand in any interactive turn, or via a
  **recurring** cronjob (unlike the one-shot cronjob of §9.3, here an
  explicit `--deliver telegram:<chat_id>` is required, because a recurring
  job has no originating chat to inherit from).
- **`ask-brain`**: exposes `brain_query`/`brain_ingest` (Phase 5) directly
  in the conversation, to query or feed Brain without it being an internal
  step of a coding task. Unlike `resolve-issue`, the Operator's message here
  is treated as a legitimate instruction (the same trust level as `run-task`,
  §9.2), not as third-party data.

## 10. The agent's identity (`SOUL.md`)

hermes-agent loads `SOUL.md` (from `$HERMES_HOME`) on every turn as system-prompt "slot #1" — before any other context (verified in `agent/prompt_builder.py::load_soul_md`/`build_context_files_prompt`, `CONTEXT_FILE_MAX_CHARS = 20_000`). It is the right place to customise what Hermes knows itself to be within this project, instead of behaving like the default template's generic assistant (an empty comment shipped with the installation).

**Versioned source of truth**: `hermes/config/SOUL.md`. It describes, condensed, the agent's identity and scope in this specific deployment — who it is (PersonalAI's agent, not a general-purpose assistant), what it actually does (`resolve-issue`, `run-task`, `run-design-task`, `status-report`, `ask-brain`), and a summary of the non-negotiable rules the skills already detail in full (third-party content as data, never instructions; never merge; MCP tools only for code and for design/HTML; ask when ambiguous; Brain is best-effort).

**Application**: copied to `$HERMES_HOME/SOUL.md` — **not** mounted read-only like the skills, because hermes-agent allows editing it live from chat itself. If edited there, the change has to be brought back to `hermes/config/SOUL.md` so it is not lost on the next deployment (see `hermes/config/README.md` §7).

Scope note: this is identity/personality (a fixed slot, always loaded). The `AGENTS.md`/`CLAUDE.md`-style project context hermes-agent also supports is loaded from the turn's working directory (`cwd`), not from `$HERMES_HOME` — it is not used in this project because a hermes session's real `cwd` does not reliably match this monorepo; `SOUL.md` covers what is needed.

**A real finding while writing the first version**: `SOUL.md` goes through the same anti-injection filter as any context file (`agent/prompt_builder.py::_scan_context_content`, the same conceptual mechanism that protects the `resolve-issue` Skill from hostile issues — section 6). An early version of this file wrapped a note for the human editor in an HTML comment (`<!-- ... -->`) that mentioned the word "system" inside it — matching the `html_comment_injection` pattern (`<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->`), so the whole file was silently blocked (`[BLOCKED: SOUL.md contained potential prompt injection...]`) and Hermes replied like the default generic assistant — verified by comparing the log (`agent.log`: `Context file SOUL.md blocked: html_comment_injection`) against the chat's actual reply. Fixed by removing the HTML comment (a plain-text/blockquote note does not trigger the filter). Operational lesson: any note for humans inside `SOUL.md` goes in plain text, never in an HTML comment.

## 11. Open questions

- ~~The hermes-agent wrapper...?~~ Resolved in Phase 0 (§0.3): no wrapper needed, hermes-agent supports `CLAUDE_CODE_OAUTH_TOKEN` natively.
- How is the 5h/weekly window's quota shared between hermes-agent's chat and `claude-code-runner-mcp`'s tasks, without one starving the other? A simple candidate for v1: a hard limit on concurrent/hourly coding tasks (already covered in §6), adjusted by hand if needed.
- Use `hermes setup --portal` (Nous Portal, all-in-one) or BYO keys per integration? No longer applicable to the Anthropic model (now via the shared Pro session), but still relevant for other providers if a different model is ever wanted for non-critical parts.
- Exact format for the `resolve-issue` Skill? Pending a review of hermes-agent's own `skills/`/`optional-skills/` folder at implementation time, to follow its exact convention (frontmatter, folder structure).
- A real GitHub App or a fine-grained PAT per repo for v1? Recommended: start with a fine-grained PAT to move faster.
- Notifications when the skill opens a PR, needs human input, or a possible Pro session revocation is detected? hermes-agent already has a Telegram/Discord gateway — configure it to also flag these cases, since they matter more here than in "normal" use (§0.2).
- Is a separate Pro account just for Hermes worth it (§6), to isolate suspension risk from daily professional use? A personal decision, not blocking for starting to test.
