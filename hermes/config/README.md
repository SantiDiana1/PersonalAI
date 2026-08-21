# Cómo aplicar la configuración de hermes-agent

`hermes.config.yaml` de este directorio **no** sustituye a `~/.hermes/config.yaml`.
Es la lista de claves que este proyecto necesita fijar, con su valor y su
motivo. El `config.yaml` real lo genera y mantiene hermes-agent.

## 1. Secretos en `~/.hermes/.env`

Estos valores nunca van en el repositorio (SEC-6.2 de [../../docs/security.md](../../docs/security.md)):

```bash
# Debe coincidir EXACTAMENTE con CLAUDE_CODE_RUNNER_AUTH_TOKEN del compose.
MCP_CLAUDE_CODE_RUNNER_API_KEY=<el mismo secreto que el runner>

# PAT fine-grained, scoped solo a los repos donde Hermes actúa (SEC-6.1).
GITHUB_TOKEN=<pat>
```

El nombre `MCP_CLAUDE_CODE_RUNNER_API_KEY` no es arbitrario: hermes-agent
deriva la variable del nombre del servidor MCP (`claude-code-runner` →
`MCP_CLAUDE_CODE_RUNNER_API_KEY`). Si renombras el servidor, cambia también la
variable.

## 2. Registrar los servidores MCP

Opción A — con la CLI, que escribe en `~/.hermes/config.yaml` por ti:

```bash
hermes mcp add claude-code-runner \
  --url http://claude-code-runner:8080/mcp \
  --auth header

hermes mcp add github \
  --command npx \
  --args -y @modelcontextprotocol/server-github \
  --env GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_TOKEN
```

Opción B — editando `~/.hermes/config.yaml` a mano y copiando el bloque
`mcp_servers` de `hermes.config.yaml`.

Comprobar después:

```bash
hermes mcp list          # ambos deben aparecer conectados
hermes mcp test github   # prueba de conexión
```

## 3. Fijar aprobaciones y modelo

En `~/.hermes/config.yaml`, asegurar que existen (son los valores por defecto,
pero aquí son requisito de seguridad, no preferencia — SEC-2.3):

```yaml
approvals:
  mode: manual
  cron_mode: deny
model:
  provider: anthropic
```

Y que **no** hay `ANTHROPIC_API_KEY` en `~/.hermes/.env`: si la hay,
hermes-agent la usará en lugar de la sesión Pro compartida.

## 4. Cargar el skill `resolve-issue`

El skill vive en [`../skills/resolve-issue/`](../skills/resolve-issue/). Dos
formas de que hermes lo vea:

- **Recomendada** — montar el directorio del repo en el contenedor y apuntar
  `skills.external_dirs` ahí. La fuente de verdad sigue siendo el repo, sin
  copias divergentes. Añade al servicio `hermes` del compose:

  ```yaml
  volumes:
    - ../skills:/opt/data/skills-repo:ro
  ```

- **Alternativa** — copiar `hermes/skills/resolve-issue` a `~/.hermes/skills/`
  y dejar `external_dirs` vacío. Más simple, pero hay que reconciliar a mano
  cada cambio.

Comprobar: `hermes skills list` debe mostrar `resolve-issue`.

## 5. Programar el cron

```bash
hermes cron create '30m' --name resolve-issues --skill resolve-issue
hermes cron list
hermes cron tick     # ejecuta los jobs pendientes una vez, sin esperar
```

`hermes cron tick` es la forma de probar el ciclo sin esperar al intervalo real.
