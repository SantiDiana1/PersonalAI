# Proxy de egreso con allowlist — única puerta de salida a Internet para los
# contenedores de tarea de claude-code-runner-mcp. Ver docs/hermes/spec.md
# §3.4: la red del contenedor de tarea está restringida a
# api.anthropic.com y github.com, sin acceso libre.
FROM alpine:3.20

RUN apk add --no-cache tinyproxy

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY filter.allow /etc/tinyproxy/filter.allow

EXPOSE 8888

ENTRYPOINT ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
