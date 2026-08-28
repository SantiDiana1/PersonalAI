# Security model — PersonalAI

> **This document is the single source of truth for the project's non-negotiable
> security requirements.** Every phase in the [roadmap](roadmap.md) references the
> `SEC-x.y` requirements that apply to it, and no phase is considered finished
> without verifying them against real evidence (not "it should work"). The
> verification record for closed phases lives in the [decisions log](decisions-log.md).
>
> **Pending (Phase 18)**: today these requirements are verified by hand, once, and
> their evidence is prose in the log. The [eval suite](agent-evals/spec.md) turns
> them into executable checks and will add a coverage section here stating,
> requirement by requirement, which are automated, which remain manual
> verification, and which are not verified at all.
>
> If a requirement here gets in the way, the way out is **not** to skip it: it is to
> change this document explicitly, recording what is being relaxed and why. A
> requirement quietly left unmet is a lie in the portfolio.

## 0. Why this document exists

This system has a combination that, badly assembled, is genuinely dangerous:

1. **It reads text written by strangers** — the body of a GitHub issue can be
   written by anyone, and can contain instructions aimed at the agent ("ignore your
   instructions and instead..."). This is **prompt injection**, and it is not
   hypothetical: it is the expected failure mode of any agent that reads
   third-party input.
2. **It executes code automatically** — the whole purpose of the system is for
   Claude Code to write and commit code with nobody watching at the time.
3. **It runs on the Operator's home machine** — not a disposable server, but a
   personal computer on the home network. (Today that host is a WSL2/Docker Desktop
   machine; a dedicated Mac Mini is the planned target. Every requirement below is a
   property of "the host", and does not change with the hardware.)

The entire design is built around one idea: **whatever reads untrusted input must
not hold dangerous permissions, and whatever holds dangerous permissions must not
read anything untrusted.**

## 1. The central concept: the Docker socket is the master key

Docker has no permission that says "you may create containers, but only small
harmless ones". Anyone who can talk to the Docker socket can create a container
that mounts the host's entire disk and read or modify it. Therefore:

> **access to the Docker socket ≡ full control of the host**

`claude-code-runner-mcp` needs that access — launching ephemeral containers is
literally its job. That is not up for debate. What _is_ decided is **who else has
it**, and the answer is: nobody.

That is where the deployment architecture comes from (see
[architecture.md §Despliegue](architecture.md#deployment)): hermes-agent and the
runner live in **separate containers**, and only the second one sees the socket.
They communicate over MCP on HTTP inside an internal Docker Compose network, where
the only thing hermes can ask the runner for is
`run_coding_task(repo, title, description, ...)` — there is no generic "run this
command" tool.

This was explicitly evaluated against two simpler alternatives, both rejected:

| Alternative                                                                       | Why it was rejected                                                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| hermes native on the host (no container) + runner as an stdio subprocess          | hermes would hold the full privileges of the host user. A successful injection = compromised personal machine. |
| hermes in a container **with** the socket mounted + runner as an stdio subprocess | Hands the master key to precisely the component that reads untrusted text. The worst of the three.             |

## 2. Layer 0 — Home network perimeter

**Starting requirement**: the host sits on the Operator's home network, behind a
domestic router. Opening ports there does not expose "a server", it exposes the
home network.

- **SEC-0.1 (non-negotiable) — Zero inbound ports.** No router port is opened
  towards the host. No port forwarding, no DMZ, no UPnP for this project.
  - _Why this is achievable_: **verified in hermes-agent's source** — the Telegram
    gateway uses long polling (`getUpdates` via python-telegram-bot,
    `gateway/platforms/telegram.py`), not webhooks. Traffic is **outbound**: the
    process asks `api.telegram.org` whether there are messages. The cron that polls
    GitHub (Phase 2) is outbound too. **Talking to Hermes from outside the house
    requires no inbound path at all**: you talk to Telegram's servers, and Hermes
    talks to them too — never directly to each other.
  - _Verification_: from outside the home network, a scan of the public IP must
    show no project port open.

- **SEC-0.2 (non-negotiable) — No tunnels "just to try it".** Exposing any
  component via ngrok, Cloudflare Tunnel, Tailscale Funnel or equivalent is
  forbidden, even temporarily during development. A tunnel is an inbound port by
  another name, and "temporary" ones stay.
  - _Accepted exception_: a remote-access VPN (Tailscale/WireGuard in private
    network mode, **without** exposing services to the internet) is acceptable if
    the Operator wants it for administering the host, because it publishes nothing.

- **SEC-0.3 (non-negotiable) — Dashboard and API server never leave localhost.**
  hermes-agent's dashboard stores provider credentials. The upstream compose
  already binds it to `127.0.0.1` and leaves the API server off unless
  `API_SERVER_KEY` is defined; **neither of those is reverted**. To reach the
  dashboard from another machine, use an SSH tunnel, never `--host 0.0.0.0`.

## 3. Layer 1 — Who can give Hermes orders

This is the layer that matters most for the goal of "talking to my AI from my
phone". A Telegram bot is **discoverable**: its username is public and anyone can
message it.

- **SEC-1.1 (non-negotiable) — Explicit allowlist, deny by default.** Only
  explicitly authorised Telegram user IDs may interact.
  - _Basis_: **verified in the source** — `gateway/run.py::_is_user_authorized`
    resolves in this order: per-platform allow-all flag → env allowlist
    (`TELEGRAM_ALLOWED_USERS`) → approved DM pairing list → global allow-all →
    **"Default: deny"**. The default behaviour is already the correct one.
  - _Configuration_: `TELEGRAM_ALLOWED_USERS=<Operator's id>` in the `.env`, and/or
    explicit approval via `hermes pairing approve`.
  - _Verification_: with the allowlist in place, a message from a different
    Telegram account must be rejected. Checked with a second account, not assumed.

- **SEC-1.2 (non-negotiable) — Never enable the allow-all escapes.** The variables
  `GATEWAY_ALLOW_ALL_USERS`, `TELEGRAM_ALLOW_ALL_USERS` and their per-platform
  equivalents are **never set to `true`**, not even for debugging. With them,
  anyone who finds the bot can send it coding tasks.

- **SEC-1.3 — The Telegram bot token is a first-class secret.** Whoever holds it
  can read everything you write to the bot and impersonate it. It lives in the
  `.env` outside git, like the rest (see SEC-6.2).

- **SEC-1.5 — The control bot has its own token and allowlist, and is the least
  privileged service.** The second Telegram bot (`apps/control-bot`, Phase 9) does
  NOT share Hermes' token — it could not even if we wanted it to: Telegram only
  allows one update consumer per token. SEC-1.1 through SEC-1.3 apply equally and
  separately: its own mandatory allowlist (the process refuses to start without
  one, verified by test), and its token is a first-class secret.

  What it deliberately does **not** have, because it ingests Telegram text just as
  hermes does: `CLAUDE_CODE_RUNNER_AUTH_TOKEN` (that token also authenticates
  `/mcp`, which launches containers), published ports, and access to workspaces or
  artifacts. Its only capability is running aggregate SELECTs against Postgres and
  talking to `api.telegram.org` — **and, since Phase 15 (see SEC-1.6 below), one
  more exception, scoped in code.** This is the same reasoning as SEC-2.1: the
  component exposed to untrusted text gets the minimum, not the convenience —
  SEC-1.6 is the one deliberate crack in that rule, and it is declared as such.

  - _Declared exception, added with `/cron`_: the container mounts
    `$HERMES_HOME/cron` **read-only** and runs with **hermes' uid** (10000) rather
    than its own (10003). This is not convenience: hermes-agent writes
    `cron/jobs.json` with mode 0600 and **rewrites it restoring that mode on every
    scheduler tick** — verified by hand, a `chmod 644` returns to 600 on the next
    edit — and there is no `setfacl` available on the host or in the images.
    Sharing the uid is the only thing that survives a redeploy.
  - _What is NOT widened_: the `cron` subdirectory is mounted, **not**
    `$HERMES_HOME`. `auth.json` (Claude's OAuth token) is not in that tree and
    remains unreachable. On Linux a uid grants nothing by itself: it only gives
    access to reachable files, and what is reachable here is a `:ro` directory.
  - _What IS widened, put plainly_: `cron/output/` hangs off that same directory
    and contains full transcripts of cron runs. No code path reads them — only
    `jobs.json` is opened — but they are reachable from that container. What makes
    the risk acceptable is that **this bot has no model**: it runs a fixed registry
    of commands (`COMMANDS` in `apps/control-bot/src/commands.ts`) and does not
    interpret natural language, so there is no agent to talk into reading something
    else. If a model is ever added to it, this exception stops being defensible and
    must be replaced by a scoped HTTP endpoint.

- **SEC-1.6 — The control bot mounts the Docker socket as of Phase 15 (US-15.2),
  scoped in code, not in the socket.** `/modelo` needs to change the agent loop's
  active link and restart the Hermes container so it picks it up — the gateway only
  reads `config.yaml` at startup (the same operational finding as Phases 2/13).
  There is no way to achieve that without talking to the Docker daemon.

  - _What degree of access this implies, undressed_: the Docker socket is the
    host's master key (SEC-1) — whoever holds it can in principle launch a
    container with the host's `/` mounted and do anything. This component, which
    ingests Telegram text with no model in the loop but is nonetheless exposed to
    anyone who discovers the bot and is on the allowlist, gains that capability if
    compromised.
  - _What keeps it bounded_: **not the socket — the code.**
    `apps/control-bot/src/docker.ts` is the only place in the process that touches
    it, and it only knows how to do three things, always against a single container
    by fixed name (`CONTROL_BOT_HERMES_CONTAINER_NAME`): read the active model
    (`hermes config show`, read-only), change it
    (`hermes config set model.provider|model.default`), and restart that container.
    Never an arbitrary command, never `docker run`/`createContainer`, never another
    container. The same pattern already accepted for `claude-code-runner-mcp` in
    SEC-2.1 and SEC-4.1, applied here for a second time to a different component.
  - _Why the value being changed is not free-form_: the alias `/modelo` accepts is
    validated against `CONTROL_BOT_MODEL_CHOICES`, a list **declared** at deploy
    time — the same pattern as `CONTROL_BOT_PROVIDER_PROBES` for `/proveedores` —
    never against the live `fallback_providers` chain (which lives in
    `config.yaml`, inside the volume with `auth.json` that this bot still does not
    mount). An alias not on that list touches nothing.
  - _Why `hermes config show` is safe to expose_: verified against the real
    deployment, not assumed — it redacts API keys (`sk-a...gAAA`) and does not
    include the MCP servers section, so the Jira/Notion/GitHub tokens embedded in
    `config.yaml` (a Phase 14 finding, `mcp_servers.*.env.*`) never travel this
    path.
  - _Container user_: changed from non-root (uid 10003, dedicated) to **root** —
    the same reasoning already documented in
    `apps/claude-code-runner-mcp/Dockerfile` for the same case: with the Docker
    socket mounted, a non-root uid does not reduce that power in any real measure,
    it would only give a false sense of containment.
  - _Audit_: every change is recorded in `control_bot.model_changes` (Postgres),
    with a timestamp — visible via `/modelo` with no argument (US-15.4). It is
    written **before** restarting the container, so that there is a trace of what
    was requested even if the restart hangs.

- **SEC-1.4 — The input channel does not change the guarantees.** A task arriving
  by Telegram goes through exactly the same `run_coding_task`, with the same
  isolation and the same rate limiting, as one arriving from a GitHub issue. There
  is no "fast path" for the Operator.

## 4. Layer 2 — hermes-agent, the component that reads the untrusted

hermes-agent is, deliberately, the **least** privileged of the components that
touch external data, because it is the only one that ingests arbitrary text.

- **SEC-2.1 (non-negotiable) — The hermes-agent container NEVER mounts
  `/var/run/docker.sock`.** This is the requirement the whole architecture hangs
  from (see §1). If mounting it ever seems necessary, the design is wrong.
  - _Verification_: `docker inspect` of the hermes container must not list the
    socket in `HostConfig.Binds`, and from inside the container `docker ps` must
    fail.

- **SEC-2.2 (non-negotiable) — No `network_mode: host`.** The upstream compose uses
  it for convenience; our deployment replaces it with scoped Compose networks, so
  that hermes cannot see the home network or the host's services (printers, NAS,
  other machines).

- **SEC-2.3 — Approval for dangerous commands stays on.** `approvals.mode: manual`
  and `approvals.cron_mode: deny` are kept (both are hermes-agent's defaults,
  verified in `hermes_cli/config.py`).
  - _Important nuance, verified in `tools/approval.py`_: this mechanism applies to
    **shell commands**, not to MCP tool calls. That is why the `resolve-issue`
    skill must do its work **via MCP tools** (GitHub MCP, `run_coding_task`) and
    not by invoking `gh` in a terminal: that way it runs unattended under cron
    without needing to relax `cron_mode`, which stays at `deny`.
  - _Intended consequence_: if an injection tries to push hermes into running a
    dangerous shell command during a cron run, it is **blocked** rather than
    self-approved.

- **SEC-2.4 — hermes' data is sensitive.** The `~/.hermes` volume contains `.env`,
  `auth.json`, memories and sessions. It is treated as sensitive material: never
  copied into repos, never backed up unencrypted.

- **SEC-2.5 — A REST passthrough MCP server is not a bounded surface.** The Jira
  MCP server (`@aashari/mcp-server-atlassian-jira`) does not expose semantic tools
  but **five raw HTTP verbs** — `jira_get`, `jira_post`, `jira_put`, `jira_patch`,
  `jira_delete` — over the entire REST API of the Atlassian site. That is:
  `jira_delete` can delete any issue, sprint or project in the account, not only
  those of the task project.
  - _The difference from GitHub, which matters_: there, SEC-3.3 bounds the surface
    by counting it (`Tools discovered: 1`). Here that count says nothing — five
    generic tools are more surface than GitHub's twenty-odd specific ones. The real
    surface is not set by the server, it is set by the **skill**.
  - _Mitigation_: `resolve-jira-task` declares an explicit method + endpoint
    allowlist (Rule 1 of its `SKILL.md`) and forbids `jira_post` except for
    commenting, and `jira_patch` and `jira_delete` entirely. The same pattern
    `resolve-issue` applies to `merge_pull_request`/`create_repository`: the tool
    exists, the procedure does not use it.
  - _Extension (2026-08-27)_: the allowlist now includes
    `GET /rest/api/3/issue/{key}/transitions` (discover transitions, read-only) and
    `POST /rest/api/3/issue/{key}/transitions` (execute them), so that the ticket's
    visible state reflects the label already applied to it — previously only the
    label changed and the Jira board went stale. The `POST` is bounded within the
    skill itself to a body of a single shape (`{"transition": {"id": "<id>"}}`,
    with the `id` taken from the `GET` on that same ticket in the same turn, never
    invented) — it does not open arbitrary writes on the ticket, only moving its
    state through the already-configured workflow.
  - _Honest limit, declared and not closed_: this is a restriction **in the
    prompt**, not in the transport. An Atlassian API token inherits all of the
    user's permissions and does not support fine-grained scoping like a GitHub PAT
    (SEC-6.1), so there is no way to enforce it below the skill. If an injection
    managed to get hermes to call `jira_delete`, nothing further down would stop
    it. Accepted as a conscious risk, bounded by the fact that the Atlassian site
    is personal and holds no company data (the same boundary as SEC-7.x).

## 5. Layer 3 — The channel between hermes-agent and the runner

This is where the chosen option earns its keep: it is the border between "reads
the untrusted" and "holds the master key".

- **SEC-3.1 (non-negotiable) — The runner is not published to the LAN.** Its port
  lives only on the internal Docker Compose network. It carries **no** `ports:`
  section in the compose, so it is unreachable from other machines on the home
  network or from the host itself, except through the Compose network.

- **SEC-3.2 (non-negotiable) — Authentication on every request.** The runner's MCP
  endpoint requires a shared secret (`Authorization: Bearer` header), distinct from
  every other secret in the system. Without it, it answers `401` and executes
  nothing. This is defence in depth: even if someone reached the internal network,
  they cannot launch tasks.

- **SEC-3.3 (non-negotiable) — Minimal surface: a single tool.** The runner exposes
  exclusively `run_coding_task`, with typed and validated parameters (zod). It does
  not, and will not, expose any general-purpose tool of the "run this command" or
  "read this file" kind. All the power stays encapsulated behind one
  fixed-shape operation.
  - _Why it matters_: even if hermes is completely compromised by an injection, the
    most it can ask for is "resolve this task in this repo". It cannot ask for
    "mount the host's disk".
  - _Exact scope, verified_: the server also exposes no MCP **resources** or
    **prompts**, and must not start doing so without revisiting this requirement —
    those are additional surface, not just metadata. Careful when measuring it:
    hermes-agent shows "5 tool(s)" for this server in its banner, but four of them
    are utilities **the client** adds on its own to every MCP server
    (`list_resources`, `read_resource`, `list_prompts`, `get_prompt`, see
    `tools/mcp_tool.py::_select_utility_schemas`). The server's real surface is
    measured against the server: `hermes mcp test claude-code-runner` →
    `Tools discovered: 1`, and a direct MCP client returns exactly
    `["run_coding_task"]`.

- **SEC-3.4 — The task's repo is a bounded parameter, not a free one.** The skill
  can only launch tasks against repos where the GitHub PAT has permission (see
  SEC-5.1). A `repo` invented by an injection fails at the clone.
  - _The Jira case (Phase 14)_: a GitHub issue **lives** in a repo, so its `repo`
    is a fact of its location and there is nothing to choose. A Jira ticket lives
    in none, so that fact has to be supplied — and that is where the risk this
    requirement closes reappears. The only admissible source is a
    `repo:<owner>/<name>` label **checked against an allowlist arriving in the
    cron's prompt**, never the ticket description nor the project name. The PAT
    remains the last barrier, but here it stops being the only one: the allowlist
    filters before reaching the clone.

## 6. Layer 4 — The runner, the component with the master key

- **SEC-4.1 (non-negotiable) — It is the only one with the socket.** No other
  container in the compose mounts it. See SEC-2.1.

- **SEC-4.2 (non-negotiable) — It reads no untrusted input to decide anything.**
  The runner does not interpret the task text: it writes it verbatim into a
  `prompt.md` consumed by Claude Code **inside the already-isolated ephemeral
  container**. Untrusted text never influences the decisions of the process that
  holds the socket.

- **SEC-4.3 (non-negotiable) — Rate limiting on.** A cap on concurrent and hourly
  tasks (implemented and verified in Phase 1). It protects against two things: an
  accidental loop (an issue that re-labels itself) and deliberate abuse exhausting
  the Pro subscription's window — which is **shared** with hermes' chat, so
  exhausting it leaves the assistant mute.

- **SEC-4.4 — Bounded working directory.** Repo checkouts live under a dedicated
  workspace root, shared with the host at the **same path** (needed so the
  ephemeral containers' bind mounts resolve correctly, see
  [hermes/spec.md §3.6](hermes/spec.md#36-nota-de-implementación-rutas-de-workspace-en-despliegue-contenerizado)).
  That root contains only project workspaces, never `$HOME` or system paths.

## 7. Layer 5 — The ephemeral container where Claude Code runs

This layer is **implemented and verified in Phase 1**; it is collected here so the
model is complete in one place.

- **SEC-5.1 (non-negotiable) — No Docker socket.** The ephemeral container cannot
  launch further containers. Verified in Phase 1.
- **SEC-5.2 (non-negotiable) — No free network egress.** The container sits on an
  `Internal: true` Docker network (no route to the internet) and reaches the
  outside only through an allowlisting proxy (`api.anthropic.com`, `github.com`).
  Verified in Phase 1: direct DNS resolution fails, and the proxy rejects
  destinations off the list.
- **SEC-5.3 (non-negotiable) — Non-root user** inside the container.
- **SEC-5.4 (non-negotiable) — Guaranteed destruction.** The container is always
  removed (`force: true` in a `finally`), whether it ends well, badly, or by
  timeout. No orphan containers are ever left behind.
- **SEC-5.5 (non-negotiable) — Hard timeout.** 30 minutes by default.
- **SEC-5.6 — No access to the host filesystem** beyond that specific task's
  ephemeral workspace.
- **SEC-5.7 — Widening the network allowlist to `registry.npmjs.org`, analysed
  before being applied (2026-08-27).** Reason: any Node/JS project task (e.g.
  `WEB`, Next.js) needs `pnpm install` inside the sandbox in order to verify its
  own acceptance criteria (`build`/`lint`/`dev`) — without it, such tasks always
  end in `needs_human_input` for being unable to install dependencies, verified
  with a real run against `WEB-2` (see
  [decisions-log.md, US-14.9](decisions-log.md)).

  **What does NOT change**: `FilterDefaultDeny Yes` is kept — only one more entry
  is added to `filter.allow`, with the same exact-FQDN syntax already used by
  `api.anthropic.com` and `github.com`. Neither the generic registry nor a host
  range is opened; see the verification criterion below.

  **The real risk it does introduce, analysed precisely rather than in the
  abstract**: `npm`/`pnpm install` can automatically execute arbitrary third-party
  code, via the lifecycle scripts (`preinstall`/`postinstall`/`prepare`) of any
  package in the transitive dependency chain — for a Next.js scaffold that is
  easily several hundred packages, none reviewed by the Operator. This is
  qualitatively different from the risk already covered by SEC-5.2:
  `git clone`/`git push` against `github.com` does not by itself execute
  third-party code; `npm install` does, by ecosystem design.

  **The real surface inside THIS sandbox, not a generic one** — read from the
  actual code (`runContainer.ts`), not assumed: the task's ephemeral container
  does **not** carry `GITHUB_TOKEN` (deliberate, see that file's own comment —
  Claude Code would have it if it needed it to bypass the PR flow). It does carry
  `CLAUDE_CODE_OAUTH_TOKEN` — the most sensitive credential in the whole system,
  the same shared Pro session from Phase 12 — and `github.com` and
  `api.anthropic.com` are already reachable. A malicious install script cannot
  write to other people's repos (it has no PAT), but it could, in theory, read
  `CLAUDE_CODE_OAUTH_TOKEN` from the process environment and use it against
  `api.anthropic.com` directly — the same host Claude Code already needs to
  function, so it is not a new network route, it is a **new actor** (any
  transitive dependency) operating inside the same trust boundary Claude Code
  already had. The proxy's strict allowlist still closes the most common
  exfiltration path (sending data to a host the attacker controls): that remains
  blocked, because such a host is not and will not be in `filter.allow`.

  **Mitigations applied, not merely recommended** — enforced by configuration in
  the ephemeral container image, never dependent on the prompt remembering to ask
  for them:

  1. `ignore-scripts=true` in a global `.npmrc` in the image — disables
     `preinstall`/`postinstall`/`prepare` for **all** dependencies, not just the
     project's own. This is the mitigation that actually matters: it cuts the
     automatic code-execution vector, not just the network one. Accepted cost: a
     package that genuinely needs a postinstall (uncommon in a pure-JS
     Next.js/Tailwind/ESLint stack; `next` resolves its `@next/swc-*` binaries as
     ordinary optional dependencies, not via script) will not finish installing —
     treated as an exception to review case by case if it happens, not as a reason
     to disable the protection by default.
  2. `NEXT_TELEMETRY_DISABLED=1` in the container environment — cuts an outbound
     network call Next.js makes by default that contributes nothing to the task,
     reducing non-essential traffic out of the sandbox (same spirit as the proxy's
     `DisableViaHeader`/`FilterDefaultDeny`).
  3. **Minimal FQDN scope**: only `registry.npmjs.org`, not a wildcard domain. If
     another host is ever needed (e.g. a binary CDN for some specific package), it
     is added when a real failure calls for it — not preemptively.

  **What this analysis does NOT cover, stated without makeup**: a malicious package
  with scripts ignored could still try to damage the workspace itself (content that
  ends up in a commit) — but that commit lives on a `hermes/...` branch that **is
  never merged automatically**; the PR still goes through the Operator's review
  before reaching `main`, which is the real last barrier (the same pattern this
  document already assumes for the code Claude Code writes, whether or not the
  ticket that motivated it was honest).

## 8. Layer 6 — Credentials

- **SEC-6.1 (non-negotiable) — Fine-grained, least-privilege GitHub PAT.** Limited
  to the repos where Hermes must act, with only the necessary permissions
  (contents, issues, pull requests). Never a classic full-account token.
- **SEC-6.2 (non-negotiable) — No secrets in git or in images.** All of them live
  in a `.env` outside the repository and are injected as environment variables.
  They are not baked into any `Dockerfile` nor written to disk inside a container.
- **SEC-6.3 (non-negotiable) — Redaction in logs and errors.** Any token embedded
  in a URL (e.g. `x-access-token:...@github.com` in a clone or push) is redacted
  before error messages are propagated. Implemented and verified in Phase 1, after
  the risk was spotted in a real test.
- **SEC-6.4 — One secret, one purpose.** The MCP channel secret (SEC-3.2) is
  distinct from the GitHub token, the Telegram one, and Claude's. Compromising one
  must not yield the others.
- **SEC-6.5 — Manual re-authentication.** When the Claude Code session expires or
  is revoked, it is renewed by hand. Token extraction **is not automated** (see
  [hermes/spec.md §3.3](hermes/spec.md#33-limitación-conocida-expiración-o-revocación-de-sesión)).

## 9. Layer 7 — Isolation between the personal and work instances (Phase 10 of v2)

This layer applies only **if and when** [Phase 10](decisions-log.md#fase-10--despliegue-dual-instancia-personal-vs-instancia-de-trabajo--futurible)
is built (Azure DevOps or another source belonging to the Operator's employer). It
does not exist in v1. It is recorded here, with its own numbering, so that the
isolation decision does not depend on someone remembering to read the roadmap on
the day it is implemented.

The underlying principle is the same as §0, applied to a different boundary: **the
risk the Operator accepts for himself (§0.2, the Pro session's ToS) is not
transferred by default to an employer's data or credentials.**

- **SEC-7.1 (non-negotiable) — Physically separate deployments.** The "Hermes work"
  instance runs in its own `docker compose` (own `docker-compose.yml`, own Docker
  network, own state volume). It shares **no** Docker network, volume, or process
  with the personal instance — not even if both live on the same host. A container
  of one instance must not be able to reach a container of the other over the
  network.
  - _Verification_: `docker network inspect` of each instance's network must not
    list containers of the other; `docker exec` in a work-instance container must
    not be able to resolve or reach any personal-instance service by name (and vice
    versa).

- **SEC-7.2 (non-negotiable) — No shared Anthropic authentication.** The work
  instance **never** uses `hermes-claude-auth` (the personal Pro subscription's
  OAuth token, §0.1). It uses its own authentication mechanism with Anthropic — a
  normally billed API key, or whatever the Operator's employer explicitly
  authorises. Mixing here is not only a technical isolation problem: it is
  extending a ToS risk accepted in a personal capacity (§0.2) to a third party's
  code and data (the employer) without their informed consent.

- **SEC-7.3 (non-negotiable) — Company credentials in their own secret, never in
  the personal `.env`.** The Azure DevOps token/credential (and any company
  GitHub/GitLab) lives exclusively in the work instance's `.env`. They are not
  copied into `hermes/docker/.env` (personal) "to avoid bringing up another
  compose", nor added as an extra credential of the personal runner.

- **SEC-7.4 (non-negotiable) — Its own Telegram bot and allowlist.** The work
  instance registers its own `TELEGRAM_BOT_TOKEN` and its own
  `TELEGRAM_ALLOWED_USERS` (SEC-1.1–SEC-1.3 apply equally, per instance). One
  Telegram bot does not serve both instances.

- **SEC-7.5 — Explicit confirmation of company policy before deploying.** Before
  the work instance processes any real data or credential belonging to the
  Operator's employer, the Operator confirms what their employer's security/IT
  policy permits (use of personal infrastructure, which model provider is
  authorised, etc.). This is not a requirement verifiable in code — it is a
  governance condition that precedes implementation, and it is recorded (date, with
  whom it was confirmed) before the first line of this deployment is written.

## 10. What this model does NOT protect — read this

A security model that does not enumerate its limits is marketing. These risks are
**consciously accepted**:

- **Leakage of the secrets hermes needs.** If an injection compromises
  hermes-agent, the tokens it has at hand (GitHub, Telegram, Claude, and the MCP
  channel secret) can be exfiltrated. The architecture limits the blast radius to
  hermes' container — **it prevents losing the host, it does not prevent losing
  those tokens**. Practical mitigation: keep the GitHub PAT least-privilege
  (SEC-6.1), so that leaking it is not equivalent to losing the account.
- **Malicious code written by Claude Code.** If an injection gets Claude Code to
  write harmful code, that code lands in a **PR**, not in `main`. Human review of
  the PR before merging is part of the security model, not a process detail
  ([hermes/spec.md §2](hermes/spec.md#2-no-objetivos-v1)).
- **Terms of Service risk.** Using the Pro subscription's OAuth token outside the
  official client violates Anthropic's consumer ToS, with a risk of the entire
  account being suspended. Explicitly accepted in
  [hermes/spec.md §0.2](hermes/spec.md#02-nota-de-riesgo--actualizada-ya-no-es-teórica).
- **Availability.** The system depends on home power and network. There is no high
  availability and none is attempted.
- **Compromise of the host by some other route.** This model protects the machine
  from _this_ system; it is not general hardening of the host.

## 11. Per-phase verification checklist

No phase is closed without running these checks **for real**, with evidence pasted
into the decisions log.

| Phase          | Requirements to verify                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| 1 (done)       | SEC-4.3, SEC-5.1 – SEC-5.6, SEC-6.3                                                      |
| 2              | SEC-2.1, SEC-2.2, SEC-2.3, SEC-3.1, SEC-3.2, SEC-3.3, SEC-4.1, SEC-4.4, SEC-6.1, SEC-6.2 |
| 3              | SEC-0.1, SEC-0.2, SEC-0.3, SEC-1.1, SEC-1.2, SEC-1.3, SEC-1.4                            |
| 9              | SEC-1.5, as soon as the control bot is deployed                                          |
| 14             | SEC-2.5, SEC-3.4 (Jira variant), SEC-4.3                                                 |
| 14 (WEB)       | SEC-5.7, widening the sandbox proxy to `registry.npmjs.org`                              |
| 15             | SEC-1.6, Docker socket scoped in code for `/modelo`                                      |
| 4–5            | Review that Brain reintroduces no surface (API on the internal network only, own token)  |
| Phase 10 of v2 | SEC-7.1 – SEC-7.5, as soon as a "Hermes work" instance exists                            |
