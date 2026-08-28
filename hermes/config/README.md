# How to apply the hermes-agent configuration

`hermes.config.yaml` in this directory does **not** replace `~/.hermes/config.yaml`.
It is the list of keys this project needs to set, with their value and their
reason. The real `config.yaml` is generated and maintained by hermes-agent itself.

## 1. Secrets in `~/.hermes/.env`

These values never go in the repository (SEC-6.2 of [../../docs/security.md](../../docs/security.md)):

```bash
# Must match EXACTLY the compose's CLAUDE_CODE_RUNNER_AUTH_TOKEN.
MCP_CLAUDE_CODE_RUNNER_API_KEY=<the same secret as the runner>

# Must match EXACTLY the compose's BRAIN_MCP_AUTH_TOKEN (Phase 5).
MCP_BRAIN_MCP_API_KEY=<the same secret as brain-mcp>

# Fine-grained PAT, scoped only to the repos where Hermes acts (SEC-6.1).
GITHUB_TOKEN=<pat>

# Phase 7 — Notion (internal integration, notion.so/my-integrations).
NOTION_TOKEN=<secret>

# Phase 7 — Jira. Token at id.atlassian.com/manage-profile/security/api-tokens.
# ATLASSIAN_SITE_NAME is only the subdomain (if your Jira is
# https://mycompany.atlassian.net, this is "mycompany"), not the full URL.
ATLASSIAN_TOKEN=<api-token>
ATLASSIAN_SITE_NAME=<subdomain>
ATLASSIAN_USER_EMAIL=<your-atlassian-email>
```

The names `MCP_CLAUDE_CODE_RUNNER_API_KEY`/`MCP_BRAIN_MCP_API_KEY` are not
arbitrary: hermes-agent derives the variable from the MCP server's name
(`claude-code-runner` → `MCP_CLAUDE_CODE_RUNNER_API_KEY`, `brain-mcp` →
`MCP_BRAIN_MCP_API_KEY`). If you rename a server, change its variable too.

## 2. Register the MCP servers

**Before anything else, if you have touched `apps/claude-code-runner-mcp/docker/runner/`
(Dockerfile or entrypoint.sh)**: rebuild the per-task one-shot container image
by hand — `docker compose build`/`up --build` **does not** rebuild it, it is a
separate image from the `claude-code-runner` service below (see the detailed
comment in `hermes/docker/docker-compose.yml`). A real finding, Phase 8:
forgetting this step leaves `run_claude_command` (and, in general, any task)
silently failing against a stale image.

```bash
docker build -t claude-code-runner-image:local \
  -f apps/claude-code-runner-mcp/docker/runner/Dockerfile \
  apps/claude-code-runner-mcp/docker/runner
```

Option A — with the CLI, which writes to `~/.hermes/config.yaml` for you:

```bash
hermes mcp add claude-code-runner \
  --url http://claude-code-runner:8080/mcp \
  --auth header

hermes mcp add github \
  --command npx \
  --args -y @modelcontextprotocol/server-github \
  --env GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_TOKEN

# Phase 5.
hermes mcp add brain-mcp \
  --url http://brain-mcp:8091/mcp \
  --auth header
```

Option B — editing `~/.hermes/config.yaml` by hand and copying the `mcp_servers`
block from `hermes.config.yaml`.

Check afterwards:

```bash
hermes mcp list          # all three should show as connected
hermes mcp test github   # connection test
```

**Phase 7 (Notion/Jira) — turned on with the Operator's own tokens**: the
`notion`/`jira` blocks of `hermes.config.yaml` are uncommented and genuinely
registered in `~/.hermes/config.yaml`:

```bash
# Notion: an internal integration created at notion.so/my-integrations.
hermes mcp add notion \
  --command npx \
  --args -y @notionhq/notion-mcp-server \
  --env NOTION_TOKEN=$NOTION_TOKEN

# Jira: API token at id.atlassian.com/manage-profile/security/api-tokens.
# The community server @aashari/mcp-server-atlassian-jira was chosen
# (stdio, classic API-token auth) over Atlassian's official remote one
# because the latter requires OAuth — infrastructure not worth adding here.
hermes mcp add jira \
  --command npx \
  --args -y @aashari/mcp-server-atlassian-jira \
  --env ATLASSIAN_SITE_NAME=<your-site-subdomain> \
  --env ATLASSIAN_USER_EMAIL=<your-atlassian-email> \
  --env ATLASSIAN_API_TOKEN=$ATLASSIAN_TOKEN
```

Note: `hermes mcp add --args` does not handle bare flags like `-y` well (it
fails with "unrecognized arguments"); if that happens, edit
`~/.hermes/config.yaml` by hand under `mcp_servers.<name>.args` with a YAML
list (`['-y', 'package']`) — that is Option B of this same README, and it is
what was used here.

Verified (`hermes mcp test notion` / `hermes mcp test jira`): both connect and
discover their tools, and both tokens genuinely authenticate against the real
APIs (test calls with a 200 OK).

**Jira is no longer handled by `resolve-issue`**: it has its own skill,
`resolve-jira-task` (Phase 14, see §11). The reason is that this MCP server
exposes five raw REST verbs (`jira_get/post/put/patch/delete`) rather than
named tools, so every call has to be built by hand and the procedure does not
look like GitHub's. For **Notion**, on the other hand, `resolve-issue`
(§ "Generalisation to Notion and Jira") still serves it unchanged.

## 3. Fix approvals and model

In `~/.hermes/config.yaml`, make sure these exist (they are hermes-agent's
defaults, but here they are a security requirement, not a preference — SEC-2.3):

```yaml
approvals:
  mode: manual
  cron_mode: deny
model:
  provider: anthropic
```

And that there is **no** `ANTHROPIC_API_KEY` in `~/.hermes/.env`: if there is,
hermes-agent will use it instead of the shared Pro session.

## 4. Load the skills

They live in [`../skills/`](../skills/): `resolve-issue` (automatic GitHub
issue flow, Phase 2), `run-task` (conversational Telegram requests, Phase 3,
see `docs/hermes/spec.md §9`), `status-report`/`ask-brain` (operational
closure and conversational surface, Phase 6), `run-design-task`
(chat-requested designs/Artifacts, Phase 8) and `resolve-jira-task`
(automatic Jira task flow, Phase 14, see §11). Two ways for hermes to see them:

- **Recommended** — mount the repo's directory into the container and point
  `skills.external_dirs` at it. The repo stays the source of truth, with no
  diverging copies. Add to the compose's `hermes` service:

  ```yaml
  volumes:
    - ../skills:/opt/skills-repo:ro
  ```

  Deliberately **outside** `/opt/data` (`$HERMES_HOME`), not below it — see
  the comment in `hermes/docker/docker-compose.yml` (US-6.2 of
  `docs/decisions-log.md`): mounting it under `$HERMES_HOME` made the
  entrypoint's recursive `chown -R` fail on it (it is `:ro`), producing the
  "chown failed (rootless container?)" warning on every startup — misleading,
  it has nothing to do with rootless Podman.

- **Alternative** — copy each skill from `hermes/skills/` to
  `~/.hermes/skills/` and leave `external_dirs` empty. Simpler, but every
  change then has to be reconciled by hand.

Check: `hermes skills list` should show `resolve-issue`, `run-task`,
`status-report`, `ask-brain`, `run-design-task` and `resolve-jira-task`.

## 5. Schedule the cron

```bash
hermes cron create '30m' --name resolve-issues --skill resolve-issue
# US-6.3: proactive summary, needs an explicit --deliver (a recurring
# cronjob has no originating chat of its own) — see hermes/skills/status-report/SKILL.md.
hermes cron create 'every 24h' --name status-report --skill status-report \
  --deliver telegram:<your_chat_id>
hermes cron list
hermes cron tick     # runs pending jobs once, without waiting
```

`hermes cron tick` is how you test the cycle without waiting for the real
interval. `run-task` and `ask-brain` need no cron — they trigger like any
other skill in a normal interactive turn (see step 6).

The Jira cron (Phase 14) is **separate** from GitHub's, and carries the repo
allowlist in its positional prompt — see §11.

> **Always `docker exec -u hermes`, never root.** The `gateway` runs as the
> non-root user `hermes`; a `hermes cron create` run as root leaves
> `cron/jobs.json` owned by root and unreadable by the gateway, and the cron
> stops firing **silently**. A real finding from Phase 2, reproduced again in
> Phase 6.

## 6. Telegram (Phase 3)

1. Create the bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and
   save the token it gives you in `TELEGRAM_BOT_TOKEN` (`~/.hermes/.env` or
   the compose's `.env` — see `hermes/docker/.env.example`).
2. Find your numeric Telegram user ID (e.g. by messaging
   [@userinfobot](https://t.me/userinfobot)) and put it in
   `TELEGRAM_ALLOWED_USERS` (SEC-1.1). **Never** turn on
   `GATEWAY_ALLOW_ALL_USERS` or `TELEGRAM_ALLOW_ALL_USERS` (SEC-1.2).
3. Restart the hermes container after changing either variable
   (`docker compose restart hermes`) — same as with `mcp_servers`, the gateway
   loads its config at startup (see the Phase 2 "operational gotcha" in
   `docs/decisions-log.md`).
4. Verify from your own Telegram account that the bot responds, and from a
   **second account** not listed in `TELEGRAM_ALLOWED_USERS` that the message
   is rejected (SEC-1.1, verified, not assumed).
5. The `run-task` and `ask-brain` skills (`../skills/run-task/`,
   `../skills/ask-brain/`) are already available as soon as step 4 of this
   guide passes — they need no cron registration, they trigger like any other
   skill in a normal interactive turn. `status-report` also answers on demand
   with no cron, in addition to its proactive half from step 5.
6. **Voice notes (Phase 7, US-7.5)**: needs no configuration change —
   verified in the real deployment that the hermes container ships with
   `faster-whisper` installed and `stt.enabled: true` with `provider: local`
   by default in `~/.hermes/config.yaml` (local transcription, no API key or
   external service). A voice note sent over Telegram should get transcribed
   and trigger `run-task`/`ask-brain`/etc. exactly like a text message —
   confirmed by the Operator with a real audio note (2026-08-28).
7. **Additional messaging channel (Phase 7, US-7.4)**: hermes-agent ships
   with Discord/Slack/WhatsApp/Signal out of the box in addition to Telegram,
   but turning any of them on needs a new account/bot token on that platform
   that only the Operator can create — blocked until the Operator picks a
   platform and generates the credentials. The activation mechanism is the
   same pattern as steps 1–4 of this section, substituting Telegram for the
   chosen platform's gateway (`hermes gateway setup`, see its `--help` for the
   per-platform flag).

## 7. The agent's identity (`SOUL.md`)

Without this, hermes-agent uses the default (empty) template and behaves like
a generic assistant — see `docs/hermes/spec.md §10`.

```bash
cp SOUL.md ~/.hermes/SOUL.md   # or whichever HERMES_HOME path you use
```

It is read live (no need to restart the hermes container). If you edit it
live from Hermes' own chat, bring the change back to this repo's `SOUL.md` so
it is not lost on the next deployment — this file is the versioned source of
truth, `~/.hermes/SOUL.md` is the operational copy.

## 8. Metrics webhook — the deterministic path (US-9.2)

Asking Hermes for metrics in natural language works, but it spends tokens
from the Pro window and depends on the model picking the right tool. This
webhook is the **model-free** alternative: zero tokens, zero agent decisions.

**Why a webhook and not a `/command`**: hermes-agent's slash commands are
hardcoded in its central registry (`hermes_cli/commands.py`); custom ones are
an open, unimplemented request
([#25335](https://github.com/NousResearch/hermes-agent/issues/25335),
duplicated in
[#31373](https://github.com/NousResearch/hermes-agent/issues/31373), with
[PR #4602](https://github.com/NousResearch/hermes-agent/pull/4602) unmerged).
Adding one would require patching hermes-agent's code, which this project
decided not to touch. The `--deliver-only` flag of `hermes webhook` is the
only documented way to deliver a message **with no agent loop**.

The price of that decision: the trigger is an HTTP POST, not a Telegram
message. From a phone it is fired with an iOS shortcut / Android home-screen
action; the reply does land in the usual Telegram chat.

```bash
# 1. Script and its config, under $HERMES_HOME/scripts (hermes-agent confines
#    webhook scripts to that directory; they are not run from the repo).
mkdir -p ~/.hermes/scripts
cp ../scripts/metrics-webhook.sh ~/.hermes/scripts/
cp ../scripts/metrics-webhook.env.example ~/.hermes/scripts/metrics-webhook.env
chmod +x ~/.hermes/scripts/metrics-webhook.sh
chmod 600 ~/.hermes/scripts/metrics-webhook.env   # holds the runner's token
$EDITOR ~/.hermes/scripts/metrics-webhook.env     # fill in RUNNER_TOKEN

# 2. Subscription. --deliver-only is what skips the model turn: the rendered
#    prompt ({script_output} = the script's output) is delivered verbatim.
hermes webhook subscribe metrics \
  --script metrics-webhook.sh \
  --prompt '{script_output}' \
  --deliver-only \
  --deliver telegram \
  --deliver-chat-id '<your_chat_id>'

hermes webhook list          # returns the URL and the HMAC secret
hermes webhook test metrics  # check it without firing it for real
```

`<your_chat_id>` is the same numeric ID as `TELEGRAM_ALLOWED_USERS` (SEC-1.1).

**How the script works** (`hermes/scripts/metrics-webhook.sh`): it makes an
authenticated `curl` call to the runner's `GET /v1/metrics` and writes the
report to stdout. Details of the hermes-agent contract it depends on,
verified before writing it:

- The script's environment is **sanitised**, so configuration is read from
  `metrics-webhook.env` next to the script, not from variables inherited from
  the compose.
- **Text** stdout is exposed as `{script_output}`; stdout that is a **JSON
  object** would replace the payload instead of being exposed as text. The
  report always starts with `PersonalAI` and never with `{`, which is why it
  is delivered as plain text and not JSON.
- Empty stdout, `[SILENT]`, or a **non-zero exit code** cause the webhook to
  be skipped and nothing delivered. This is the desired behaviour on error:
  verified that a wrong token (exit 22), missing configuration (exit 1) and a
  down runner (exit 7) all leave stdout empty, so a blank report that looks
  real is never delivered.

The `GET /v1/metrics` route requires the same Bearer auth as `/mcp` (SEC-3.2),
is read-only with no parameters, and returns fixed aggregates — never task
titles or repo content.

## 9. The control bot — the definitive deterministic path (US-9.2)

A SECOND Telegram bot, with its own token, that answers `/metricas` by
computing directly against the database: **no model, no Claude Pro quota
spent, and no dependence on an agent deciding to call the right tool**.

It is the alternative to the §8 webhook: same determinism, but the trigger is
still a message. The price is one more bot on your Telegram.

**Why a separate bot rather than a command on Hermes' own**: Telegram only
allows one update consumer per token. If both services called `getUpdates`
with the same token they would steal each other's messages (the Bot API's
409 error). And a `/command` inside Hermes is not possible: its slash
commands are hardcoded in its central registry (see §8).

```bash
# 1. Create the bot in BotFather (/newbot) and copy the token. Do NOT reuse
#    Hermes' own.
# 2. Add to the compose's .env:
#      CONTROL_BOT_TELEGRAM_TOKEN=<the new bot's token>
#      CONTROL_BOT_ALLOWED_USERS=<the same IDs as TELEGRAM_ALLOWED_USERS>
# 3. Bring it up:
docker compose up -d --build control-bot
docker compose logs -f control-bot   # should say "bot de control escuchando"
```

Then, in the new bot's chat: `/metricas`. `/metrics`, `/m` also work, and
accents and capitalisation are tolerated (`/Métricas`). `/ayuda` lists the
commands.

**Behaviour worth knowing**:

- **Mandatory allowlist**: without `CONTROL_BOT_ALLOWED_USERS` the process
  refuses to start (exits with code 2 and a clear message). An unauthorised
  user gets **no** reply at all — not even a "not authorised", which would
  confirm the bot exists. It is logged.
- **Discards the backlog on startup**: Telegram retains messages for up to
  24h, so a `/metricas` sent while the bot was down is not answered once it
  comes back. Delivering yesterday's report today with no warning would be
  worse than delivering nothing.
- **Does not do natural language, on purpose**: that is its determinism
  guarantee. A message that is not a known command gets the command list
  back, never an interpretation.
- **It is the least privileged service in the compose** (SEC-1.5): no Docker
  socket, no runner token, no published ports. Only SELECTs against Postgres.

Adding a new command means adding an entry to `COMMANDS` in
`apps/control-bot/src/commands.ts`: the surface is exactly that list, not a
generic interpreter.

## 10. Provider chain and local model (Phase 13)

Since 2026-08-26 Hermes' agent loop **cannot use the Pro subscription**:
Anthropic classifies it as a _third-party app_ and rejects it with `HTTP 400`
(see Phase 12 of the roadmap). The runner is unaffected — it runs the
official `claude -p` binary, which is accepted.

The answer is not switching provider, which would just repeat the same error
under another name, but a **chain** with ordered degradation:
`ollama` (local, free) → _a cheap link yet to be decided_ → `anthropic`
(credits, capped).

### Deployment on the (16 GB) Mac Mini

```bash
# 1. Bring up Ollama. It sits behind a PROFILE: a bare `docker compose up -d`
#    does NOT start it, so a machine without enough RAM does not die of OOM
#    and leave the impression the whole compose is broken.
docker compose --profile local-llm up -d ollama

# 2. Download the model. WITHOUT this the container starts, the healthcheck
#    passes, and the chain still fails on the first turn — the most
#    treacherous failure in this whole setup. `/proveedores` calls it out
#    explicitly.
docker compose exec ollama ollama pull qwen2.5:3b

# 3. Point hermes at the chain (this is NOT applied by copying
#    hermes.config.yaml — see that file's header).
hermes config set model.provider ollama
hermes config set model.base_url http://ollama:11434
hermes fallback add anthropic
hermes fallback list

# 4. Check from the control bot, without spending a single token:
#    /proveedores
```

Settings available in the compose's `.env`: `OLLAMA_MEMORY_LIMIT` (8g by
default) and `OLLAMA_KEEP_ALIVE` (5m — unloads the model from RAM after that
much idle time, so it does not take memory away from Postgres, Brain and the
runner all day).

### `/proveedores` in the control bot

Probes each link and reports whether it responds. For Ollama it additionally
**lists the downloaded models**, which is what tells "alive but useless" apart
from "alive and ready".

What it does **not** do, and the command's own output warns of it: it does
not read hermes' live chain. That lives in its `config.yaml`, inside a volume
that also holds `auth.json` with the OAuth token; mounting that into the
control bot — the process that ingests Telegram text — would contradict
SEC-1.5. So it probes the list **declared** in `CONTROL_BOT_PROVIDER_PROBES`,
and if you change the chain with `hermes fallback` you have to update that
variable too.

Nor does it answer "which provider served the last turn": hermes-agent only
drops that into log text when it falls back (`auxiliary_client.py`), with no
structured record. Claiming otherwise would be inventing a fact that does not
exist.

### Before trusting the chain

The real risk is not RAM, it is **tool-call reliability**: small models are
weak at calling tools, and Phase 8's bug 2 already showed a poorly-equipped
model fabricating plausible results instead of failing. That is why US-13.1
is a gate: a real Telegram request has to be seen genuinely triggering
`run_coding_task` (a new row in `runner.task_runs`), not just described in
text, before the local link is trusted.

## 11. Jira as a task source (Phase 14)

Jira uses **the same four labels** as GitHub (`hermes`, `hermes:in-progress`,
`hermes:done`, `hermes:needs-human`) plus a fifth, `repo:<owner>/<name>`,
that says which repository the task lands in.

None need to be created up front: unlike GitHub, where a label must exist in
the repo before it can be applied, Jira labels are free text and are born the
moment they are assigned. Colons and slashes are valid characters (verified
against `<your-domain>.atlassian.net`); the only thing Jira forbids is spaces.

### Create the cron

```bash
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes \
  cron create '30m' --name resolve-jira --skill resolve-jira-task \
  'Process Jira tasks. Allowed repos: SantiDiana1/PersonalAI.'
```

The positional prompt is **mandatory in practice**: that is where the repo
allowlist goes. Without it the skill deliberately refuses to run anything — a
Jira ticket does not live inside any repo, so the destination is not a fact
that can be deduced, and letting the ticket's text choose it would be exactly
the hole SEC-3.4 closes. See Rule 2 of
`hermes/skills/resolve-jira-task/SKILL.md`.

Add each new repo to that list **by editing the job**, not the ticket.

### Adjusting the frequency

```bash
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes cron list
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes cron tick   # fires now, without waiting
```

To change the interval, delete the job and create it again with a different
`schedule`. It is kept separate from `resolve-issue`'s job for exactly this:
you can pause or speed up the Jira source without touching GitHub's.

### Checking the filter by hand

The JQL the skill uses, in case you want to see it from the Jira UI:

```
labels = hermes AND statusCategory != Done ORDER BY created ASC
```

**Do not filter by `status`**: JQL resolves canonical English names, not the
ones the UI shows. On a Spanish-language site, `status = "Tareas por hacer"`
returns **zero results with no error** — the cron would keep running and
never pick anything up. `statusCategory` has three fixed values from Jira
itself and is immune to both language and renaming a state.

## 12. Governance: cron delivery and `/cron`

Two pieces answering the same question — _what is running unattended, and how
do I find out what it did?_

### Making cronjobs notify you

A job with `Deliver: local` leaves its result inside the container. It looks
healthy in `hermes cron list` and **nobody finds out about anything**, errors
included. This was a real failure: `resolve-issues` was failing every 30
minutes with no warning. Every job must deliver to Telegram:

```bash
docker exec -u hermes personalai-hermes-1 /opt/hermes/.venv/bin/hermes \
  cron edit <job_id> --deliver telegram:<your_chat_id>
```

`hermes cron edit` changes the job in place, without losing its run history
(`repeat.completed`), unlike deleting and recreating it.

### `/cron` in the control bot

Lists jobs, schedule, next run and the last run's result — deterministic, no
model, no quota spent, same as `/metricas` and `/proveedores`. It also
**flags** the two silent failure modes: a job with `local` delivery, and a
job that ran fine but whose delivery failed (`last_delivery_error`).

Requires two things in the compose, already set on the `control-bot` service:

```yaml
volumes:
  - ${HERMES_HOME:-~/.hermes}/cron:/hermes-cron:ro
user: '10000:10000'
environment:
  CONTROL_BOT_CRON_JOBS_PATH: /hermes-cron/jobs.json
```

The `user:` is neither optional nor laziness: hermes writes `jobs.json` with
mode `0600` **and restores that mode every time it rewrites the file**, so a
`chmod` undoes itself on the scheduler's very next tick. The `cron`
subdirectory is mounted, not the whole `$HERMES_HOME`, so that `auth.json`
stays out of reach. The full reasoning, including the part that does widen
scope, is in [`../../docs/security.md`](../../docs/security.md) SEC-1.5.

If the mount is missing, `/cron` says so and explains what to do, instead of
answering with a generic error: the Operator is reading Telegram, not looking
at the compose file.

> **Declared coupling**: `jobs.json` is hermes-agent's internal format, not a
> public contract. It can change on an upstream update. Every field is read
> optionally and degrades to "unknown", so a format change produces a poorer
> report, never a dead bot — there are tests pinning exactly that.
