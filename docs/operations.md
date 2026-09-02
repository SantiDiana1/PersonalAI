# Operations — surviving a host restart

Fase 17 (`docs/roadmap.md`), US-17.3. Real motivation: on 2026-08-28 a WSL restart left two
containers dead with a stale Docker socket bind-mount, and the system was down until the
Operator noticed by hand.

## The mechanism, as far as it is verified today

Every service in `hermes/docker/docker-compose.yml` already carries `restart: unless-stopped`
— that was true before this document existed. That alone is **not** what US-17.3 is about: the
real risk is specific to the two services that bind-mount `/var/run/docker.sock`
(`claude-code-runner`, `control-bot`).

On this deployment (WSL2 + Docker Desktop), that socket is not served directly by a daemon
running in the same distro as this repo's containers. It is forwarded from Docker Desktop's own
internal `docker-desktop` distro by a bridging process
(`/mnt/wsl/docker-desktop/docker-desktop-user-distro proxy`, confirmed running on this host).
Two different things can restart independently:

- **The Docker Desktop GUI/app on Windows.** Verified live on 2026-09-02: quitting and
  reopening the app left `/var/run/docker.sock` at the exact same inode and mtime as before —
  the bridging process never stopped, `docker info`/`docker ps` kept answering the whole time.
  A GUI-only restart does **not** reproduce the incident.
- **A full WSL shutdown / host restart.** This tears down the `docker-desktop` distro itself,
  which is what the 2026-08-28 incident actually was. **This was not reproduced live in this
  session** — doing so would have terminated the Claude Code session running inside the same
  WSL distro. What follows is therefore the documented mitigation for the known failure mode,
  not a directly-observed repro of this exact sequence.

The known failure mode (well-documented for Docker Desktop + WSL2, and consistent with the
incident's symptom): a container that bind-mounted `/var/run/docker.sock` before the restart
can come back with a mount pointing at a socket that no longer resolves to the running daemon.
`docker start` (which is what the engine's own `unless-stopped` policy does — restart the
**existing** container) does not re-resolve that bind; only recreating the container
(`docker compose up -d --force-recreate`, or `up -d` when Compose detects the config changed)
sets up the mount fresh.

## What this phase fixed: the failure stopped being silent

Before Fase 17, both `claude-code-runner` and `control-bot` could be in exactly this broken
state and still show `Up` / "the process is alive" — `claude-code-runner`'s `/health` only
checked that its own Node process answered HTTP, and `control-bot` had no healthcheck at all
("the process is alive is the healthcheck"). Neither actually asked the one question that
mattered: _can this process reach the Docker socket it depends on?_

Both now do (`apps/claude-code-runner-mcp/src/httpServer.ts`'s `/health`,
`apps/control-bot/src/healthcheck.ts` run via the Dockerfile's new `HEALTHCHECK`), each calling
`docker.ping()` with a 3s timeout. **Verified against the real deployment (2026-09-02)**: both
containers report `"Status": "healthy"` in `docker inspect` with the real socket reachable;
the failure path (`docker.ping()` rejecting) is covered by a unit test
(`httpServer.test.ts`, mocked dockerode) rather than by breaking the real socket on purpose.
The result either way: `docker compose ps` now shows `unhealthy` the moment the socket goes
stale, instead of two green-looking containers quietly failing every real task.

## Recovery runbook — after any host or Docker Desktop restart

```bash
cd hermes/docker
docker compose ps                              # look for "unhealthy"
HERMES_UID=$(id -u) HERMES_GID=$(id -g) \
  docker compose up -d --force-recreate         # only if anything is unhealthy
```

`--force-recreate` is the important part — plain `docker compose up -d` on an already-running,
healthy-looking-but-stale container does nothing, because Compose only recreates a container
whose config actually changed.

**Not yet automated, and not pretended to be**: nothing in this repo runs that command for you
on boot. Docker Desktop's own "Start Docker Desktop when you sign in" setting (Settings →
General) at least gets the engine itself back without the Operator opening the app by hand —
that is a host-level setting, outside this repo's compose file, and still needs to be turned on
manually once per machine.

## Open, honestly

The exact behaviour of a **full** WSL/host restart on this deployment — does the container
crash-loop, does it come back silently stale, does the healthcheck alone catch it in practice —
remains **unverified by direct observation** in this repo. `docs/roadmap.md` US-17.3 tracks this
explicitly rather than marking it closed on the strength of the healthcheck fix alone.
