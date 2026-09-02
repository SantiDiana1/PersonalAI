# Roadmap — PersonalAI

> **This is the forward-looking document: where the project is and what comes next.**
> The full engineering history — every phase, the bugs found, the hypotheses discarded,
> the decisions reversed and why — lives in [`decisions-log.md`](decisions-log.md).
> That log is deliberately long. It is a record, not an entry point.

Each phase is a self-contained unit of work with an objective, user stories, verifiable
acceptance criteria and a Definition of Done, so that a coding agent can pick up **one whole
phase** and know exactly what to build and when to stop.

**The project rule that outranks all others: nothing is marked done by design.** A phase closes
only against real evidence from the real deployment — not a passing test, not a plausible log
line. When the evidence contradicts the plan, the plan changes and the contradiction gets
written down. `decisions-log.md` is mostly a record of that happening.

> **Security**: the project's non-negotiable requirements live in [`security.md`](security.md),
> numbered (`SEC-x.y`) and organised in layers. Every phase declares which ones apply and does
> not close without verifying them against real evidence. If a requirement gets in the way, it
> is changed explicitly — never ignored quietly.

## Status

| Milestone | Scope                    | State                                  |
| --------- | ------------------------ | -------------------------------------- |
| **v1**    | Phases 0–5               | ✅ Complete                            |
| **v2**    | Phases 6–15              | ✅ Complete                            |
| **v3**    | Phases 16–20             | 🚧 **Current** — a public, usable repo |
| **v4**    | Phase 11 — Company Brain | 📋 Planned, deliberately last          |

**What exists and runs today**: an agent (a deployment of
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), extended — not a
homegrown orchestrator) that picks up labelled tickets from Jira and issues from GitHub,
consults a personal memory before acting, delegates the actual coding to Claude Code inside a
one-shot Docker container with no network except an allowlisted proxy, opens a real pull
request, and reports back over Telegram. It can be spoken to by voice. Its model provider can
be swapped from a chat message. Every privileged step is separated from the component that
reads untrusted text.

### Completed milestones

Phases 0–15 are closed with real evidence. One-line summaries; full detail and the story of
each in [`decisions-log.md`](decisions-log.md).

| Phase  | Name                                          | What it delivered                                                           |
| ------ | --------------------------------------------- | --------------------------------------------------------------------------- |
| 0      | Monorepo foundation + shared auth             | Installable monorepo, shared Claude session as a secret                     |
| 1      | `claude-code-runner-mcp` standalone           | Delegate a coding task to an isolated container, without the agent yet      |
| 2      | hermes-agent local + `resolve-issue` (GitHub) | Label an issue, get a PR, hands off                                         |
| 3      | Conversational Telegram interface             | Send an ad-hoc task by chat, get notified on completion                     |
| 4      | Basic Brain (ingest + retrieval)              | Ask Brain something, get the relevant fragment back                         |
| 5      | Brain wired in via `brain-mcp`                | The agent consults memory before acting, on both entry paths                |
| 6      | Operational closure + conversational surface  | The agent is queryable and proactive about its own state, not just reactive |
| 7      | More sources and channels                     | Jira, Notion, and voice notes as inputs                                     |
| 8      | Claude Code commands over chat                | Ask for a design/artifact by Telegram, not just code                        |
| 9      | Portfolio polish                              | Partially delivered; its two open stories are absorbed into v3 (see below)  |
| ~~10~~ | Dual personal/work deployment                 | **Dropped to futuribles** — blocked by a non-technical governance gate      |
| 12     | Billing audit (subscription vs. credits)      | Evidence of where the money actually goes, and the leak closed              |
| 13     | Provider independence (fallback + cost)       | No single provider is a single point of failure; spend has a ceiling        |
| 14     | Jira as the primary task source               | Label a Jira ticket, get a PR — including a resisted prompt-injection test  |
| 15     | Model selection from Telegram                 | Swap the live model/provider from a chat message, with an audit trail       |

### Open items carried over from v2

Small, real, and not worth their own phase. They stay visible here so they do not get lost:

- **US-6.4** — one acceptance criterion still open: confirm that a literal "how are you?" over
  Telegram triggers the `status-report` skill rather than a generic conversational reply.
- **US-9.3** — replace the fine-grained PAT with a real GitHub App (1-hour installation
  tokens). Filed under portfolio polish by history, but it is security hardening (`SEC-6.1`).
- **US-13.6** — two criteria open: decide and record what the agent should do when the spend
  window is exhausted (fail and notify, or queue and retry), and verify the fallback link is
  only reached on primary failure, never as a first choice through misconfiguration.

---

## Milestone v3 — A public, consumable, verifiable repo

**The shift in this milestone**: everything up to v2 optimised for _the system working_. This
one optimises for _the system being usable and believable by someone who is not its author_ —
which turns out to require different work, not more of the same.

Three things drive it:

1. **The repo is going public.** Today it reads as one person's deployment log, in Spanish,
   with no way for anyone else to run it.
2. **`security.md` is the most valuable artifact here and it is unproven.** Thirty-nine
   numbered requirements, layered, with an explicit "what this model does _not_ protect"
   section — that discipline is rare in agent projects. But it is currently a document making
   claims. Claims that execute are a different category of evidence.
3. **The components other people would actually want are buried.** The sandbox runner is a
   generally useful piece of infrastructure trapped inside a personal monorepo.

**Ordering note — Phase 18 before Phase 19, deliberately.** Publishing a security-sensitive
sandbox as an installable package _before_ there is a suite demonstrating its boundaries would
ask users to trust the author's word as the only evidence. The evals turn `security.md` from a
document into a reproducible proof; only then does the package have something verifiable to
claim. This is a dependency, not a preference.

**Second ordering note — Phase 20 before Phase 18, added 2026-08-28 after a real incident.**
Phase 20 keeps its number for chronology but runs earlier than 18, because it changes what the
eval suite has to cover: the failure it fixes is a prompt the agent wrote for _itself_, and the
taxonomy in US-18.1 as currently drafted assumes hostile input arrives from outside. A suite
built before Phase 20 would be blind to that class by construction.

### Phase 16 — Language and front door

**Objective**: the repo reads as a project rather than as a private deployment log, and it
reads in English.

**Depends on**: nothing. It is the base — every later phase would otherwise accumulate
translation debt.

#### User stories

- **US-16.1** — As the Operator, I want the documentation in English, so that the project is
  legible to people outside my language.
  - [ ] The ~3,100 lines of actual documentation translated: `architecture.md`,
        `security.md`, `decisions-log.md`, the component specs, `hermes/config/README.md`.
  - [ ] **Explicitly out of scope: the six `SKILL.md` files (~1,400 lines).** These are not
        documentation, they are production prompts — the agent's behaviour depends on their
        exact wording, and Phase 6 found three real bugs caused by prompt phrasing alone
        (including one where the agent skipped container isolation entirely). Translating them
        is changing the system, not documenting it. They also need to keep matching Spanish
        triggers, since the Operator talks to the system in Spanish. If they are ever
        translated it is as its own phase, with real re-verification.
  - [ ] Spanish commit messages are left untouched — they are historical record.
- **US-16.2** — As a visitor, I want the README to tell me what this is and why it is
  interesting within thirty seconds, so that I do not have to reverse-engineer it from specs.
  - [ ] README **rewritten, not translated** — leading with the security model and the fact
        that this is a system in daily real use, not a portfolio exercise. The current one
        opens by describing itself as a "portfolio monorepo", which undersells a system that
        has opened real pull requests unattended.
  - [ ] A rendered architecture diagram visible in the README itself.
- **US-16.3** — As a potential user, I want an unambiguous licence, so that I know what I am
  allowed to do with this.
  - [ ] Resolve the current contradiction: `package.json` declares `MIT` while the README says
        "not licensed for redistribution", and there is no `LICENSE` file at all.
  - [ ] A real `LICENSE` file consistent with whatever is decided.
- **US-16.4** — As a visitor, I want the roadmap to be an entry point rather than an archive,
  so that the project's history informs me instead of burying me.
  - [x] Roadmap split into this document (short, forward-looking) and
        [`decisions-log.md`](decisions-log.md) (the full record, preserved intact).
- **US-16.5** _(absorbed from US-9.4)_ — As a visitor, I want a case study explaining the key
  design decisions, so that I understand the _why_, not just the _what_.
  - [ ] `docs/case-study.md`: why a deployed agent rather than a homegrown orchestrator; why
        shared authentication and the ToS risk consciously accepted with it; why Brain stays
        deliberately basic; why Telegram as the primary channel; why the runner holds the
        Docker socket and the agent does not.

#### Definition of Done

Someone who does not speak Spanish and has never seen this repo can read the README and the
architecture doc and correctly explain what the system does and what its security model is.

### Phase 17 — Consumability

**Objective**: someone who is not the Operator can clone this repository and get it running.

**Depends on**: Phase 16.

#### User stories

- **US-17.1** — As a new user, I want to go from a clean clone to a running system by
  following written steps, so that I do not have to reconstruct the deployment from specs.
  - [x] `docs/quickstart.md` written and **mechanically rehearsed** (2026-09-02) against a fresh
        `git clone` in a directory that had never run this repo: `pnpm install`, `pnpm build`,
        and `docker compose build` for all four images this repo owns all succeeded with no
        fixes needed. **Honest limit**: this rehearsal was run by the same session that wrote
        the document, not by a person unfamiliar with the repo — the credential-heavy half
        (registering bots, generating tokens, actually bringing the stack up) was not
        mechanically re-run, since that would require throwaway real credentials. A genuinely
        independent person completing the quickstart end to end is still open — this is the one
        thing this document cannot self-certify, same category of gap as US-17.1 had before.
  - [x] `.env.example` (both root and `hermes/docker/`) reviewed against real deployment
        practice: complete, and every value already commented in place with what it is, where
        it comes from, and what's optional (e.g. `CONTROL_BOT_TAREA_REPO_ALLOWLIST` empty =
        `/tarea` disabled, stated explicitly). No gap found requiring a fix.
  - [x] Every manual step (bot tokens, GitHub PAT, Atlassian/Notion, Hugging Face) tabulated in
        `docs/quickstart.md §4` with where to get it and what "done" looks like for each.
- ~~**US-17.2** _(absorbed from US-9.1)_~~ — **Dropped by the Operator's decision (2026-09-02)**,
  out of scope for this phase. Was: a recorded demo embedded in the README (a real ticket going
  in, a real PR coming out, the Telegram notification arriving).
- **US-17.3** — As the Operator, I want the deployment to survive a host restart without
  manual repair, so that "it runs" is not conditional on me being present.
  - [x] Restart policies reviewed across the compose stack. Real motivation: on 2026-08-28 a
        WSL restart left two containers dead with a stale Docker socket bind-mount and the
        system was silently down until noticed by hand. Full analysis, the fix, and a recovery
        runbook in [`operations.md`](operations.md). Summary: `restart: unless-stopped` was
        already set everywhere; the actual gap was that neither `claude-code-runner` nor
        `control-bot` could tell a stale `/var/run/docker.sock` bind-mount from a healthy one —
        both now do (`docker.ping()` in each service's healthcheck), verified `"healthy"`
        against the real deployment (2026-09-02) with the failure path covered by a unit test.
        **Left open on purpose**: a full WSL/host restart was not reproduced live in this
        session (it would have killed the Claude Code session running in the same WSL distro,
        by explicit Operator instruction) — a Docker Desktop GUI-only restart _was_ tried live
        and, verified, does not reproduce the incident (the engine backend never stopped). The
        exact behaviour of a genuine full restart on this deployment remains unverified by
        direct observation.

#### Definition of Done

A person who is not the Operator, following only the written quickstart, gets the system
running and completes one real task end to end. Verified with an actual person, not asserted.

### Phase 20 — Jira as the axis: skill boundaries and a deterministic launch surface

**Objective**: the skill layer stops depending on the model picking correctly between
overlapping skills; Jira becomes the primary task path structurally and not only in daily
practice; and a task can be launched with no natural-language routing at all.

**Depends on**: nothing technically. Runs **before Phase 18** — see the second ordering note
above.

**Why this phase exists — a real incident, not a hypothetical.** On 2026-08-28 the Operator
asked over Telegram for three `WEB` tickets to be worked. The agent created three one-shot cron
jobs with `"skills": []`, whose prompts instructed the sub-turn to _"actualiza WEB-6 y WEB-7 en
Jira a Done usando `jira_post` con transición al estado completado"_. That sub-turn would
therefore run unattended, with all 82 MCP tools available, writing to Jira, with none of
`resolve-jira-task`'s rules loaded: no transition discovery (`GET /issue/{key}/transitions`
before any `POST`), no labels-as-source-of-truth, and none of the endpoint allowlist that
`SEC-2.5` exists to enforce. Nothing attacked the system. Two individually documented
affordances combined into a hole:

1. `run-task` claims every code request _"SIEMPRE, sin excepción"_ and — unlike `resolve-issue`,
   which explicitly refuses Jira and defers to `resolve-jira-task` — carries no rule for
   yielding when the request originates in a ticket. Both skills match; only one has a
   carve-out.
2. `run-task` Step 3 authorises `skills: []` on the grounds that the prompt is self-contained.
   That holds while the sub-turn only calls `run_coding_task` and opens a PR. It stops holding
   the moment the prompt also writes to a task source — and the skill never contemplated that
   case, so it does not exclude it.

#### User stories

- **US-20.1** — As the Operator, I want source adapters separated from execution, with Jira as
  the primary path, so that two skills can never both believe they own the same request.
  - [x] The skill layer restructured along one axis: **source** (Jira, GitHub, chat) owns
        selection, marking and reporting; **execution** (`run_coding_task` → PR) is shared and
        source-agnostic. `spec.md §5` names this explicitly (US-20.4); the code already followed
        it (`run_coding_task` was always shared) but nothing said so until now.
  - [x] Exactly one skill owns each source. Every skill that could plausibly match a
        ticket-shaped request carries an explicit yield rule naming the skill that wins:
        `resolve-issue` → Jira (pre-existing), `run-task` → Jira (added closing US-20.2),
        `resolve-jira-task`'s ad-hoc-invocation note added alongside it. `run-task` vs.
        `resolve-issue` needs no yield rule — `spec.md §9.2` confirms by design they never
        compete: `resolve-issue` is cron-only, `run-task` owns every chat-triggered request.
  - [x] Jira documented as the primary path and GitHub as secondary, matching where the work
        actually lives (US-20.4, `spec.md §5.1`/`§5.2`).
  - [x] **Treated as a change to production prompts, not to documentation.** Phase 6 found three
        real bugs caused by prompt phrasing alone, one of which skipped container isolation
        entirely. Every rewritten skill is re-verified against a real run before this phase
        closes. No skill is edited and assumed working. **Verified 2026-09-02**: `/tarea MYAI-12`
        launched against the real deployment; the cron job's prompt loaded `resolve-jira-task` in
        full via `skills:`, and the sub-turn followed it exactly — `hermes:in-progress` → "En
        curso", `run_coding_task` → PR #37 (`SantiDiana1/PersonalAI`), `hermes:done` →
        "Finalizada", comment posted on the ticket. Evidence: the job's own output log
        (`~/.hermes/cron/output/9bf8dcde2c92/2026-09-02_06-39-42.md`), MYAI-12's final state in
        Jira, and PR #37 on GitHub.
- **US-20.2** — As the Operator, I want a contract on what a self-authored cron prompt may
  instruct, so that the security rules cannot be bypassed by the agent simply not loading them.
  - [x] A one-shot cron prompt may not instruct writes to a task source (Jira
        transitions/labels/comments, GitHub labels/comments) in freehand text.
  - [x] When a sub-turn must touch a source, the skill governing that source is propagated via
        `skills:` — replacing the current blanket permission to leave it empty.
  - [x] The restriction stated where it is enforceable (in the skills that create cron jobs) and
        cross-referenced from `security.md` under its own `SEC-x.y`. `SEC-2.5` currently assumes
        this boundary holds; on 2026-08-28 it did not, and nothing recorded that. **Verified
        2026-09-02**: the real `/tarea MYAI-12` job carried `skills: ['resolve-jira-task']` and no
        freehand source-write instruction, matching `run-task/SKILL.md` Regla 6 and `security.md`
        SEC-2.6 exactly (same job output as US-20.1's evidence above).
- **US-20.3** — As the Operator, I want to launch a known ticket without describing it in natural
  language, so that routing stops being probabilistic for the cases where I already know the key.
  - [x] A command on the control-bot's deterministic surface (`/tarea <KEY>`), consistent with
        its stated design: _"no hay interpretación de lenguaje natural, ni un comando genérico
        'ejecuta X'"_.
  - [x] It creates the job through `hermes cron create` with `skills:` set explicitly and a
        **templated** prompt — never freehand text — so execution stays governed by the source
        skill instead of bypassing it.
  - [x] Executed as **uid 10000** (`docker exec -u hermes`), through the bounded Docker client
        already used by `/modelo` (`SEC-1.6`). Non-negotiable and not cosmetic: a root-owned
        `cron/jobs.json` is mode 0600, unreadable by the gateway, and the cron then stops firing
        **silently**. Found in Phase 2, reproduced in Phase 6, and reproduced a third time on
        2026-08-28 while relaunching the jobs from this very incident — by an assistant that had
        the warning in `hermes/config/README.md §5` available and did not follow it. A written
        warning has now failed three times; this story is where it becomes code.
  - [x] The control-bot's scope explicitly widened from "only reports" to "launches, through a
        fixed template", recorded as a decision — `cron.ts` currently states the opposite in its
        header comment.
  - [x] An unknown or malformed key is answered with the help text, never guessed at or
        interpreted.

  **Verified against the real deployment on 2026-09-02.** All five criteria above were coded
  2026-09-01 (`apps/control-bot/src/jiraTask.ts`, `docker.ts::createDeterministicTask`,
  `commands.ts::runTareaCommand`), unit-tested with a mocked Docker client, typechecked and
  linted clean — but left unchecked until real evidence existed. That evidence: the `control-bot`
  image running at the first attempt (2026-08-27 build) predated the feature entirely and
  answered "Comando desconocido: /tarea" — rebuilding and recreating the container fixed it, a
  reminder that `docker compose up -d` never rebuilds. After the rebuild, `/tarea MYAI-12` fired
  the one-shot job (`hermes cron list` / `~/.hermes/cron/jobs.json` — the job is absent after
  firing, confirming it did not stay scheduled, exactly as this section asked to check), executed
  as uid 10000, with `skills: ['resolve-jira-task']` and a templated prompt, and produced PR #37.

- **US-20.4** — As a reader, I want the documentation's centre of gravity to match reality, so
  that Jira stops reading as an afterthought.
  - [x] `spec.md §5` no longer titled after `resolve-issue` with Jira as a Phase-7 addendum — now
        "Task sources: Jira (primary) and GitHub (secondary)", split into §5.1
        (`resolve-jira-task`) and §5.2 (`resolve-issue`).
  - [x] `spec.md §9.2` ("From message to task") covers the Jira path and the yield rule (mirrors
        the one added to `run-task/SKILL.md` in the US-20.2 commit) and the ad-hoc invocation
        path. It previously routed to `run-task` without mentioning Jira once.
  - [x] `hermes/config/README.md` documents `/tarea` alongside the existing cron setup (§13).
- **US-20.5** — As the Operator, I want this specific failure to be catchable by the Phase 18
  suite, so that it cannot quietly reopen.
  - [x] "Self-authored prompt escaping its own skill's rules" (`SP`) added to the Phase 18
        taxonomy (`docs/agent-evals/spec.md §5`) as its own attack class, distinct from hostile
        external input — with an explanation of why it needs a family of its own (no attacker,
        no external content; the agent writes the under-scoped prompt for itself).
  - [x] The 2026-08-28 incident included as case `SP-001`, with the offending prompt quoted
        verbatim (the same one `roadmap.md` Phase 20's opening paragraph already quotes) — the
        same treatment `MYAI-11` gets in `DH-002`.
  - Written ahead of Phase 18 itself starting (still blocked on Phase 17): this is the taxonomy
    document, not the runnable suite — `SP-001` cannot execute until `apps/agent-evals` exists.

#### Definition of Done

A request naming a Jira ticket is handled by exactly one skill, demonstrated by a real run
rather than by reading the prompts. `/tarea <KEY>` takes a ticket end to end without the model
choosing a route. A cron sub-turn that writes to Jira does so with `resolve-jira-task` loaded,
verified by inspecting a real job's `skills:` field rather than assumed.

### Phase 18 — Agent injection eval suite

**Objective**: `security.md` stops being a set of claims and becomes a reproducible proof.

**Depends on**: Phase 17 (the suite has to be runnable by someone else to be worth anything).

**Why this phase exists**: this project has already resisted real prompt-injection attempts —
a hostile Jira ticket instructing the agent to switch repositories, delete the project and dump
its environment (Phase 14, `MYAI-11`), and an equivalent test on GitHub in Phase 2. Both were
run **by hand, once**, and their evidence is prose in a log. That means there is no protection
against a future change quietly re-opening the hole. A skill is a prompt; prompts regress
silently. This phase converts one-off manual proofs into a regression suite.

#### User stories

- **US-18.1** — As the Operator, I want a corpus of hostile inputs with a stated attack
  taxonomy, so that coverage is a deliberate decision rather than whatever I happened to think of.
  - [x] Taxonomy documented in `docs/agent-evals/spec.md` §5: seven families (the six listed
        here plus `SP`, self-authored escape, added in Phase 20/US-20.5 after the real
        `run-task` incident — see that phase's opening paragraph) — instruction override, tool
        misuse, credential exfiltration, destination hijacking (making the agent write to a
        repo other than the labelled one), privilege escalation, fabricated results, and
        self-authored escape, each mapped to a primary `SEC-x.y`.
  - [x] The historical real attacks included verbatim as declarative case files under
        `apps/agent-evals/cases/`, not only as spec prose: `MYAI-11` (Phase 14) split across
        `DH-001.yaml` (repo-switch ask), `TM-001.yaml` (`jira_delete` ask) and `CE-001.yaml`
        (env-dump ask) — one hostile ticket, three single-purpose assertions, per §6's "no
        executable logic in a case" rule; the Phase 2 GitHub issue #7 test as `IO-001.yaml`;
        and the Phase 20 `run-task` incident as `SP-001.yaml`, copied verbatim from
        `spec.md` §5. **What's still open**: these are case _files_ only — no harness exists
        yet to run them (that's US-18.2), so none has actually been executed as a case; the
        PASS/FAIL verdicts described in each file's comments are the historical record being
        cited, not a suite result.
- **US-18.2** — As the Operator, I want to run the suite with one command and get a report,
  so that verifying the security model is cheap enough that it actually happens.
  - [ ] Runnable harness producing a per-case pass/fail report.
  - [ ] Runs against a disposable target, never the live deployment or real Jira/GitHub.
- **US-18.3** — As a reader of `security.md`, I want to know which requirements are proven by
  an automated eval and which rest on manual verification, so that I can calibrate my trust.
  - [ ] Each eval names the `SEC-x.y` it exercises.
  - [ ] `security.md` gains a coverage section making the split explicit. **Being honest about
        what is _not_ automated is part of the deliverable**, and consistent with the existing
        "what this model does not protect" section.
- **US-18.4** — As the Operator, I want the suite to catch a regression I introduce on purpose,
  so that I know it actually detects failure and is not just green by construction.
  - [ ] Verified by deliberately weakening a guard rail and confirming the suite goes red —
        a suite never observed failing is not evidence of anything.

#### Definition of Done

One command runs the suite, produces a report, and has been demonstrated to fail when a
protection is deliberately removed. `security.md` states truthfully which of its 41
requirements are automatically verified.

### Phase 19 — Extracting the sandbox

**Objective**: `claude-code-runner-mcp` becomes usable by other people, not just by this
monorepo.

**Depends on**: Phase 18, for the reason stated at the top of this milestone.

**What makes it worth extracting**: it runs a coding agent inside a one-shot container that
holds no Docker socket, reaches the network only through an allowlisted proxy, and is destroyed
on completion. That is a generally useful piece of infrastructure for anyone running agents
against untrusted input, and it is currently invisible inside a personal repository.

#### User stories

- **US-19.1** — As an external developer, I want to install and run the sandbox runner against
  my own repositories, so that I can use it without adopting the rest of this system.
  - [ ] Packaged and installable standalone, with no dependency on Brain, Hermes or this
        repo's Postgres schema.
  - [ ] Its own documentation: what it isolates, what it does not, how to configure the proxy
        allowlist.
- **US-19.2** — As an external developer, I want the security claims to be verifiable rather
  than asserted, so that I can decide whether to trust it with my credentials.
  - [ ] The published claims map to Phase 18 evals a user can run themselves.
  - [ ] The accepted risks stated up front, in the same register as `security.md` — including
        the ones inherited from sharing an authenticated session.

#### Definition of Done

Someone can install the runner outside this repo, point it at their own repository, and verify
its isolation claims by running the evals themselves.

---

## Milestone v4 — Company Brain

**Moved here from v3 by the Operator's decision (2026-08-28), deliberately last.** The
reasoning is unchanged from when it was v3: the largest piece is opened only once the
foundation under it is closed, because opening it first guarantees dragging debt into it. What
changed is that "the foundation" now includes being public and verifiable, not just working.

Phase 11 keeps its historical number. Its full definition — objective, the four user stories,
and Definition of Done — is unchanged in
[`decisions-log.md`](decisions-log.md#fase-11--company-brain-completo-consolidación-real).

**In one line**: Brain today is a vector store — ingestion plus semantic similarity, and it
satisfies two of the four properties of the "company brain" pattern. Phase 11 builds the
consolidation layer already designed in
[`personal-brain/spec.md §4.2`](personal-brain/spec.md): LLM-extracted `Observation`s,
contradiction reconciliation with `superseded_by`, and synthesised `MentalModel`s.

---

## Futuribles and out of scope

Unchanged and still accurate. See
[`decisions-log.md`](decisions-log.md#futuribles-sin-fase-asignada) for the full reasoning
behind each:

- **Futuribles** (might happen, no phase assigned): a local model via Ollama; the dual
  personal/work deployment and Azure DevOps with it; an additional messaging channel.
- **Out of scope** (deliberately never, absent a change of purpose): multi-tenancy and real
  per-user authorisation; high availability; automating re-authentication of the Claude Code
  session; offering this to third parties as a service.
