# Notas de exploración de hermes-agent (US-0.3)

> Nota interna, no de portfolio. Generada explorando la instalación local real de
> hermes-agent (ya presente en este host antes de empezar la Fase 0, en
> `~/.hermes/hermes-agent`, checkout git de `NousResearch/hermes-agent`).
> Objetivo: documentar con datos reales el formato de skills, el mecanismo de
> registro de MCP servers, y — crítico — cómo hermes-agent maneja realmente la
> autenticación con Anthropic, para diseñar con precisión las Fases 2 y 3.

## 1. Instalación y versión

- Ya instalado en este host: `hermes --version` → `Hermes Agent v0.11.0 (2026.4.23)`.
- Instalador oficial (para un VPS nuevo, Fase 3): `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` (Linux/macOS/WSL2/Termux). Instala uv, Python 3.11, Node.js, ripgrep, ffmpeg.
- Proyecto real en disco: `~/.hermes/hermes-agent` (checkout de git, no un paquete pip aislado). Estado de runtime del usuario (config, auth, memorias, cron) vive en `~/.hermes/` (fuera del checkout del código).
- CLI expone muchos más subcomandos que los mencionados en el spec: `chat, model, fallback, gateway, setup, whatsapp, slack, login, logout, auth, status, cron, webhook, hooks, doctor, dump, debug, backup, import, config, pairing, skills, plugins, curator, memory, tools, mcp, sessions, insights, claw, version, update, uninstall, acp, profile, completion, dashboard, logs`.

## 2. Formato de skills — confirma la hipótesis del spec

Estructura real en el checkout:

```
skills/
  <categoría>/                  # p.ej. github, devops, mcp, research...
    DESCRIPTION.md               # descripción de la categoría
    <skill-name>/
      SKILL.md                   # skill individual, frontmatter + markdown
      templates/                 # opcional
      references/                # opcional
      scripts/                   # opcional
optional-skills/                 # mismo formato, no cargados por defecto
```

Ejemplo real (`skills/github/github-pr-workflow/SKILL.md`, y el más simple `skills/dogfood/SKILL.md`):

```yaml
---
name: dogfood
description: 'Exploratory QA of web apps: find bugs, evidence, reports.'
version: 1.0.0
metadata:
  hermes:
    tags: [qa, testing, browser, web, dogfood]
    related_skills: []
---
# Dogfood: Systematic Web Application QA Testing

## Overview
...
## Prerequisites
...
## Workflow
...
```

Confirma lo que el spec asumía: frontmatter YAML (`name`, `description`, `version`, `metadata.hermes.{tags,related_skills}`) + cuerpo markdown con secciones libres (Overview/Prerequisites/Workflow/...). Compatible con agentskills.io. **Conclusión para Fase 3**: `hermes/skills/resolve-issue/SKILL.md` debe seguir exactamente esta convención (carpeta propia, `SKILL.md` con este frontmatter, subcarpetas `templates/`/`references/` opcionales para plantillas de comentarios de PR/issue).

Comandos de gestión: `hermes skills {browse,search,install,inspect,list,check,update,audit,uninstall,reset,publish,snapshot,tap,config}` — instalación desde registries (skills.sh, GitHub, ClawHub), no solo skills locales del checkout.

## 3. Registro de servidores MCP

```
hermes mcp add <name> --url <endpoint>                          # servidor HTTP/SSE
hermes mcp add <name> --command <cmd> --args <args...> [--env K=V ...]  # servidor stdio
hermes mcp add <name> --preset <preset-name>                    # presets conocidos
hermes mcp {list|ls, remove|rm, test, configure|config, login}
```

`hermes mcp list` (probado en local, sin servidores configurados aún) confirma el mensaje de ayuda exacto:

```
Add one with:
  hermes mcp add <name> --url <endpoint>
  hermes mcp add <name> --command <cmd> --args <args...>
```

**Conclusión para Fase 3**: el GitHub MCP oficial (`github/github-mcp-server`) y nuestros `brain-mcp`/`claude-code-runner-mcp` se registran vía `hermes mcp add <name> --command ... --args ... --env ...` (stdio, ejecutando el binario/imagen del servidor MCP), no hace falta URL HTTP si los exponemos como proceso stdio. A confirmar el comando exacto por servidor cuando se implementen en Fase 2/3.

## 4. Hallazgo crítico — autenticación Anthropic (afecta §0.1/§0.2 de hermes/spec.md)

**El spec asume que hay que construir un wrapper para que hermes-agent invoque `claude -p` como subproceso.** Explorando el código real (`agent/anthropic_adapter.py`, `hermes_cli/{auth,config,main}.py`), esto **no es así**: hermes-agent ya trae de fábrica soporte nativo para autenticarse con la sesión OAuth de Claude Code, sin necesidad de ningún wrapper propio.

Evidencia concreta:

- `agent/anthropic_adapter.py::read_claude_code_credentials()` lee, en este orden: (1) macOS Keychain (entrada "Claude Code-credentials"), (2) `~/.claude/.credentials.json` — el mismo archivo que genera `claude setup-token`. Devuelve `{accessToken, refreshToken, expiresAt}`.
- `is_claude_code_token_valid()` comprueba expiración con margen de 60s.
- `refresh_anthropic_oauth_pure()` refresca el token OAuth por su cuenta (llamada HTTP directa al endpoint de refresh de Anthropic, `client_id` fijo), sin depender del binario `claude`.
- Al llamar a la API, `run_agent.py` inyecta headers/identidad de Claude Code (`"User-Agent": "claude-code/0.1.0"`) para que las llamadas se comporten como las del cliente oficial — cita textual del código: _"so injects Claude-Code identity headers and system prompts"_.
- El proveedor `"claude-code"` existe como alias de primera clase (`hermes_cli/models.py:843`, `hermes_cli/providers.py:265`): `"claude-code": "anthropic"`.
- `hermes_cli/main.py` tiene ya implementado un flujo de login que **literalmente ejecuta el flujo `claude setup-token`** (`_run_claude_setup_token_flow`, líneas ~4741-4816): detecta si ya existen credenciales válidas de Claude Code y las reutiliza (`_activate_claude_code_credentials_if_available`), o si no, invoca `claude setup-token` interactivamente y guarda el resultado.
- `use_anthropic_claude_code_credentials()` (config.py) limpia `ANTHROPIC_API_KEY`/`ANTHROPIC_TOKEN` del `.env` para forzar que se use el credential store de Claude Code directamente en vez de una key copiada.

**Lo que esto significa en la práctica**: hermes-agent, con el proveedor `anthropic` (o el alias `claude-code`) y sin `ANTHROPIC_API_KEY` seteada, detecta y usa automáticamente `~/.claude/.credentials.json` — la misma sesión que genera `claude setup-token` en el host — llamando a la API de Anthropic directamente por HTTP (no spawneando el binario `claude` como subproceso). Es un mecanismo _distinto_ al descrito en el spec (llamada HTTP directa con headers de identidad, en vez de invocar `claude -p`), pero **logra el mismo resultado**: una única sesión Pro compartida, sin API key, sin escribir código propio.

**No se necesita ningún wrapper propio para el chat de hermes-agent.** El único componente que sí necesita invocar el binario `claude` como subproceso real es `claude-code-runner-mcp` (Fase 2) — porque ahí queremos ejecutar la CLI de Claude Code de verdad dentro del contenedor efímero (con sus herramientas de edición de código, no solo llamadas de chat a la API). Ese diseño de `claude-code-runner-mcp` (§3.2 del spec) no cambia.

**Riesgo de ToS**: sigue aplicando igual — usar el token OAuth de la sesión Pro fuera del cliente oficial de Claude Code (aquí, vía hermes-agent llamando directamente a la API con headers simulados) es exactamente el patrón que motiva el aviso de §0.2. No cambia la decisión de riesgo, solo cómo se implementa técnicamente (más simple de lo previsto: cero código propio para esta parte).

→ **Reportado al Operador y confirmado** (ver también hallazgo #2, sección 7): no hace falta wrapper. `docs/hermes/spec.md` §0.1/§0.3/§8/§9 actualizados en consecuencia.

## 5. Configuración y estado en disco

- `hermes config {show,edit,set,path,env-path,check,migrate}` — `hermes config path` da la ruta real del `config.yaml` (aquí: `~/.hermes/config.yaml`).
- `~/.hermes/` contiene: `.env` (secretos), `config.yaml`, `auth.json` (credenciales de proveedores gestionadas por hermes), `cron/`, `memories/`, `logs/`, `hooks/`, `bin/`, `hermes-agent/` (el checkout del código en sí).
- `cli-config.yaml.example` (en el checkout) documenta ~20 proveedores soportados vía `provider:` (`auto`, `openrouter`, `nous`, `nous-api`, `anthropic`, `openai-codex`, `copilot`, `gemini`, `zai`, `kimi-coding`, `minimax`, `huggingface`, `nvidia`, `custom`/`ollama`/`vllm`/`llamacpp`, `lmstudio`, ...). `anthropic` está documentado explícitamente como "requires: ANTHROPIC_API_KEY" en el comentario, pero eso es la ruta con API key — la ruta OAuth/Claude Code es un camino alternativo dentro del mismo proveedor (ver sección 4).
- `hermes status` confirma que el CLI corre correctamente end-to-end en este host: proyecto detectado, `.env` existe, modelo/proveedor activo mostrado (en esta instalación: OpenRouter, configurado previamente por el Operador para su propio uso — no tocado en esta exploración), y una tabla de qué proveedores/auth están configurados o no.

## 6. Cron

- `hermes cron {list,create,add,edit,pause,resume,run,remove,rm,delete,status,tick}`.
- `hermes cron status` — comprueba si el scheduler está corriendo. `hermes cron tick` — ejecuta los jobs pendientes una vez y sale (útil para testing sin esperar al intervalo real). Confirma lo asumido en el spec: cron nativo, no hace falta construir uno propio (Fase 3 US-3.4).

## 7. Hallazgo #2 — `claude setup-token` no persiste archivos, imprime un token (US-0.4)

Al ejecutar US-0.4 en la práctica, un segundo hallazgo relacionado con el de la sección 4, esta vez sobre el mecanismo exacto de `claude setup-token`:

- `claude setup-token --help` → _"Set up a **long-lived authentication token**"_. No es un login interactivo que deja una sesión en `~/.claude/`.
- Probado montando un volumen Docker en el `$HOME` de un contenedor efímero (`-e HOME=/home/node-home -v hermes-claude-auth:/home/node-home`), completando el login OAuth real (navegador + código pegado), y verificando después el contenido del volumen: `~/.claude.json` solo contiene metadata de arranque (`firstStartTime`, `machineID`, `userID`, ...) y `~/.claude/.credentials.json` **no existe**. El token no se persiste en ningún archivo del `$HOME`.
- El comportamiento real: `claude setup-token` **imprime el token por stdout** (`sk-ant-oat01-...`) para que se capture y se use como variable de entorno `CLAUDE_CODE_OAUTH_TOKEN` — el mecanismo documentado por Anthropic para uso headless/CI, que coincide con lo ya encontrado en la sección 4 (`hermes_cli/auth.py: api_key_env_vars=(...,"CLAUDE_CODE_OAUTH_TOKEN")`).
- **Corrección aplicada** (confirmada con el Operador, ver conversación): `hermes-claude-auth` pasa de ser "un volumen Docker con `~/.claude/` montado read-only" a ser "un secreto (el valor del token), guardado en `.env` fuera de git, inyectado como `CLAUDE_CODE_OAUTH_TOKEN`". Aplicado a `docs/hermes/spec.md` §0.1/§0.3/§3.1/§3.2/§3.4/§6/§8 y a `docs/roadmap.md` US-0.4.
- Verificado extremo a extremo: `docker run --rm --env-file .env node:20-slim ... claude -p "Reply with exactly the single word: OK"` → `OK`, sin que el token apareciera en ningún momento en la salida de los comandos.
- El volumen Docker `hermes-claude-auth` creado inicialmente (vacío, sin credenciales reales) se elimina — ya no forma parte del diseño.

## 8. Resumen de conclusiones para las fases siguientes

- ✅ Formato de skill confirmado — Fase 3 puede implementarse siguiendo la convención real sin sorpresas.
- ✅ `hermes mcp add` confirmado — registro vía stdio (`--command`/`--args`/`--env`) es la vía natural para nuestros MCP servers propios.
- ✅ `hermes cron` confirmado — nativo, sin scheduler propio.
- ✅ **Auth (§0.1/§0.2/§0.3)**: confirmado y ya corregido en el spec. No hace falta wrapper — hermes-agent soporta `CLAUDE_CODE_OAUTH_TOKEN` nativamente. `hermes-claude-auth` es un secreto (token), no un volumen — verificado end-to-end en US-0.4. Mismo riesgo de ToS que antes, solo cambia el "cómo" técnico (más simple de lo previsto).
