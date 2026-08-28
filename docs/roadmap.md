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
| **v3**    | Phases 16–19             | 🚧 **Current** — a public, usable repo |
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
  - [ ] A quickstart verified **from a clean clone on a machine that has never run this** —
        not written from memory of an already-working deployment. This is the whole point of
        the story; a quickstart validated against an existing install proves nothing.
  - [ ] `.env.example` complete and honest about every credential actually required, which of
        them are optional, and what degrades without each.
  - [ ] Every step that cannot be automated (creating bot tokens, GitHub PATs, Atlassian
        credentials) called out explicitly as manual, with what "done" looks like.
- **US-17.2** _(absorbed from US-9.1)_ — As a visitor, I want to see the system working
  without installing it, so that I can judge it in thirty seconds.
  - [ ] A recorded demo embedded in the README: a real ticket going in, a real pull request
        coming out, and the Telegram notification arriving.
- **US-17.3** — As the Operator, I want the deployment to survive a host restart without
  manual repair, so that "it runs" is not conditional on me being present.
  - [ ] Restart policies reviewed across the compose stack. Real motivation: on 2026-08-28 a
        WSL restart left two containers dead with a stale Docker socket bind-mount and the
        system was silently down until noticed by hand.

#### Definition of Done

A person who is not the Operator, following only the written quickstart, gets the system
running and completes one real task end to end. Verified with an actual person, not asserted.

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
  - [ ] Taxonomy documented in `docs/agent-evals/spec.md`: instruction override, tool misuse,
        credential exfiltration, destination hijacking (making the agent write to a repo other
        than the labelled one), privilege escalation, and fabricated results.
  - [ ] The historical real attacks (`MYAI-11` and the Phase 2 GitHub test) included verbatim
        as cases, so their evidence stops being prose in a log.
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
protection is deliberately removed. `security.md` states truthfully which of its 39
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
