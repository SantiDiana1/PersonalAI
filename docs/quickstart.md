# Quickstart — from a clean clone to a running system

> Written and mechanically rehearsed against a **fresh `git clone` in a directory that had
> never run this repo before** (2026-09-02) — `pnpm install`, `pnpm build`, and `docker compose
build` for the four images this repo owns (`claude-code-runner-mcp`, `brain`, `brain-mcp`,
> `control-bot`) all succeeded with no fixes needed. **What that rehearsal did not cover**: the
> parts that need real credentials — registering Telegram bots, generating a Claude Pro OAuth
> token, connecting Jira/Notion — and actually bringing the stack up end to end. Those steps are
> written from the real deployment's configuration, but **this quickstart itself is not yet
> verified by a person who is not the Operator** (`docs/roadmap.md` US-17.1) — that is the one
> thing this document cannot self-certify.

## 0. What you end up with

Two things running: `hermes` (the agent — reachable over Telegram, picks up labelled Jira
tickets and GitHub issues, delegates code changes to Claude Code in a disposable container) and
`control-bot` (a second, deterministic Telegram bot for `/metricas`, `/modelo`, `/cron`,
`/tarea`). See [architecture.md](architecture.md) for how the pieces fit together.

## 1. Prerequisites

- **Node.js 20+** and **pnpm 9** (the repo pins `packageManager` in `package.json` — pnpm will
  refuse to run under the wrong version).
- **Docker** and **Docker Compose v2**.
- A **Claude Pro or Max subscription**, logged into the Claude Code CLI on this machine
  (`npm install -g @anthropic-ai/claude-code`, then `claude` once to authenticate). The stack
  shares this session — see the ToS risk note in
  [hermes/spec.md §0.2](hermes/spec.md#02-risk-note--updated-no-longer-theoretical) before you
  proceed; it is a conscious, documented trade-off, not an oversight.
- Accounts you will need tokens from, all free: **GitHub**, a **Telegram** account (to talk to
  @BotFather), **Hugging Face** (for embeddings). **Optional**: **Atlassian/Jira** and
  **Notion**, only if you want those task sources — the system runs without either.

## 2. Clone and build this repo

```bash
git clone https://github.com/SantiDiana1/PersonalAI.git
cd PersonalAI
pnpm install
pnpm build
```

Verified clean from a truly fresh clone: `pnpm install` resolves the lockfile as-is (no drift),
`pnpm build` compiles all six workspace packages with no errors.

## 3. Install hermes-agent itself

This repo does **not** vendor [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
— it deploys and extends it (see the README's opening note on this). Install it separately, on
the same machine:

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc   # or ~/.zshrc
```

By default this clones the agent to `~/.hermes/hermes-agent` and uses `~/.hermes` as its data
directory (`$HERMES_HOME`) — these are the defaults the rest of this guide, and this repo's
`.env.example` files, assume. Confirm with `hermes --version`.

## 4. Manual credentials (cannot be automated)

Each of these is a real account action on someone else's site. "Done" for each is stated
explicitly so you know when to move on.

| Credential                                                                          | Where to get it                                                                                                                                                                  | "Done" looks like                                                                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE_CODE_OAUTH_TOKEN`                                                           | Run `claude setup-token` on this host (prints the token to stdout, does not save it anywhere)                                                                                    | You have a token string starting with the session prefix, copied somewhere temporary — it goes straight into `.env` files below, never committed |
| `GITHUB_TOKEN`                                                                      | github.com → Settings → Developer settings → **Fine-grained tokens**, scoped only to the repo(s) Hermes should act on, permissions: Contents, Issues, Pull requests (read/write) | A token string starting `github_pat_`                                                                                                            |
| `TELEGRAM_BOT_TOKEN` (Hermes's own bot)                                             | Message **@BotFather** on Telegram, `/newbot`, follow the prompts                                                                                                                | A token like `123456:ABC-...`; you can talk to the new bot by username                                                                           |
| `CONTROL_BOT_TELEGRAM_TOKEN` (the **second**, control bot)                          | Same as above, `/newbot` **again** — Telegram allows only one consumer per token, so this must be a genuinely different bot, not the same token reused                           | A second, different token — verify it differs from `TELEGRAM_BOT_TOKEN` before moving on                                                         |
| `TELEGRAM_ALLOWED_USERS` / `CONTROL_BOT_ALLOWED_USERS`                              | Message **@userinfobot** (or similar) to get your own numeric Telegram user ID                                                                                                   | A comma-separated list of numeric IDs — never leave empty, never set an "allow all" flag (SEC-1.1/SEC-1.2)                                       |
| `HUGGINGFACE_API_KEY`                                                               | huggingface.co/settings/tokens, a **read-only** token                                                                                                                            | A token starting `hf_`                                                                                                                           |
| `ATLASSIAN_TOKEN` / `ATLASSIAN_SITE_NAME` / `ATLASSIAN_USER_EMAIL` (optional, Jira) | id.atlassian.com/manage-profile/security/api-tokens                                                                                                                              | See [hermes/config/README.md §1](hermes/config/README.md) for the exact registration commands                                                    |
| `NOTION_TOKEN` (optional)                                                           | notion.so/my-integrations, an internal integration                                                                                                                               | Same reference as above                                                                                                                          |

Every secret above needs its own value — never reuse one across two of these (SEC-6.4).
Generate the internal ones (`CLAUDE_CODE_RUNNER_AUTH_TOKEN`, `BRAIN_API_TOKEN`,
`BRAIN_MCP_AUTH_TOKEN`) with `openssl rand -hex 32`, one call per secret.

## 5. Fill in the `.env` files

Two separate `.env` files, two separate purposes — do not confuse them:

- **`.env`** (repo root) — only used by `docker-compose.dev.yml`, a bare Postgres for local
  package development (`pnpm --filter @personalai/brain dev`, tests). Skip this unless you are
  developing against the packages directly rather than the full stack.
- **`hermes/docker/.env`** — the real stack. This is the one the rest of this guide uses.

```bash
cp hermes/docker/.env.example hermes/docker/.env
# edit hermes/docker/.env with the credentials from step 4 and generated secrets
```

Every variable in that file is commented **in place** with what it is, where the value comes
from, and which `SEC-x.y` requirement it satisfies — read those comments, they are the
authoritative reference, not a duplicate of this table.

`~/.hermes/.env` is a **third**, separate file — hermes-agent's own secrets (`GITHUB_TOKEN`
again, plus `NOTION_TOKEN`/`ATLASSIAN_*` if used, plus the two MCP auth keys that must match
`hermes/docker/.env` exactly). See
[hermes/config/README.md §1](hermes/config/README.md#1-secrets-in-hermesenv) for the exact
block to paste in.

## 6. Build and register

```bash
# The per-task runner image — a separate image from the compose services below,
# `docker compose build` never rebuilds it (see the comment in
# hermes/docker/docker-compose.yml). Build it by hand once, and again any time
# apps/claude-code-runner-mcp/docker/runner/{Dockerfile,entrypoint.sh} changes.
docker build -t claude-code-runner-image:local \
  -f apps/claude-code-runner-mcp/docker/runner/Dockerfile \
  apps/claude-code-runner-mcp/docker/runner

cd hermes/docker
HERMES_UID=$(id -u) HERMES_GID=$(id -g) docker compose build
```

Verified clean from a fresh clone: the four images this repo owns
(`claude-code-runner-mcp`, `brain`, `brain-mcp`, `control-bot`) build with no errors, and
`docker compose config` resolves the full file without missing-variable failures once every
`.env` value is filled in.

Then register the MCP servers hermes-agent needs — this is a `hermes` CLI step, not a Compose
one, and it is written up in full (including the two working options and the one documented
CLI quirk) in [hermes/config/README.md §2](hermes/config/README.md#2-register-the-mcp-servers).
Do this **before** the first `docker compose up`, or `hermes` starts with no tools registered.

## 7. Bring the stack up

```bash
HERMES_UID=$(id -u) HERMES_GID=$(id -g) docker compose up -d
docker compose ps   # everything should read "healthy" or "Up" within ~30s
```

`docker compose up -d` **never rebuilds images** — if you change code after this point, rerun
the `docker compose build` command from step 6 (and recreate the per-task image by hand if you
touched it) before `up -d` again, or the container keeps running stale code silently. This is
not a hypothetical: it is exactly what happened during Fase 20's own real verification, caught
only because the resulting behaviour (an unrecognized bot command) was visibly wrong.

## 8. Verify one real task end to end

This is the actual Definition of Done for this document — not "the containers are up," but a
real task completing:

1. Message Hermes's bot on Telegram with something concrete, e.g. "resuelve la issue #N de
   `owner/repo`" for a real, small GitHub issue in a repo the `GITHUB_TOKEN` can write to.
2. You should get an immediate acknowledgement, then — within a few minutes — a message with a
   link to a real, opened pull request.
3. Separately, message the control bot with `/metricas` — it should answer from the database
   with no model call involved.

If any of these doesn't happen, `docker compose logs -f hermes` and
`docker compose logs -f control-bot` are the first place to look; both log structured JSON.

## Restart behaviour

See [operations.md](operations.md) for what happens to this stack across a host or Docker
restart, and what to check afterward (Fase 17, US-17.3).
