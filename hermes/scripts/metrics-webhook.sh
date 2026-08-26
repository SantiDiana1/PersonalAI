#!/bin/sh
# Script de transformación del webhook `metrics` de hermes-agent (US-9.2).
#
# Camino DETERMINISTA para pedir las métricas por Telegram: no interviene el
# modelo en ningún punto, así que no consume tokens de la ventana Pro y no
# depende de que el agente decida llamar a la tool correcta. La suscripción se
# crea con `--deliver-only`, lo que hace que el prompt renderizado
# (`{script_output}`, es decir, la salida de este script) se entregue tal cual
# como cuerpo del mensaje, sin agent loop.
#
# Contrato del `--script` de hermes-agent, del que dependen las decisiones de
# abajo:
#   - Debe vivir bajo $HERMES_HOME/scripts (confinado con resolve() +
#     relative_to(), a prueba de symlinks). NO se ejecuta desde este repo:
#     cópialo allí — ver hermes/config/README.md §8.
#   - Se ejecuta con el entorno SANEADO. Por eso la configuración se lee de un
#     fichero al lado del script y no de variables de entorno heredadas.
#   - stdout de texto -> expuesto a la plantilla como {script_output}.
#     stdout que sea un objeto JSON -> REEMPLAZA el payload en vez de exponerse.
#     Por eso este script emite el informe en texto plano, que empieza por
#     "PersonalAI" y nunca por "{".
#   - stdout vacío, "[SILENT]", o salida distinta de cero -> el webhook se
#     ignora y no se entrega nada. Es el comportamiento que queremos ante un
#     error: mejor silencio que un informe vacío que parezca real.
set -eu

CONFIG="$(dirname "$0")/metrics-webhook.env"
if [ ! -f "$CONFIG" ]; then
  # A stderr, no a stdout: cualquier cosa en stdout se convertiría en el
  # mensaje entregado al Operador.
  echo "metrics-webhook: falta $CONFIG" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$CONFIG"

: "${RUNNER_URL:?metrics-webhook: RUNNER_URL no definida en metrics-webhook.env}"
: "${RUNNER_TOKEN:?metrics-webhook: RUNNER_TOKEN no definida en metrics-webhook.env}"

# --fail: un 401/503 debe ser salida distinta de cero (webhook ignorado), no un
# cuerpo de error entregado como si fuera el informe.
# --max-time: el runner tiene su propio timeout para el webhook; agotarlo aquí
# antes da un error legible en vez de un corte opaco.
curl --fail --silent --show-error --max-time 20 \
  --header "Authorization: Bearer ${RUNNER_TOKEN}" \
  "${RUNNER_URL}/v1/metrics"
