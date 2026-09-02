#!/usr/bin/env node
/**
 * HEALTHCHECK del Dockerfile (Fase 17, US-17.3).
 *
 * Este proceso no escucha en ningún puerto — "el proceso vivo ES el
 * healthcheck", como decía el comentario original del Dockerfile. Eso basta
 * para saber que el bot no ha caído, pero no para saber que puede hacer lo
 * que `/modelo` y `/tarea` necesitan: hablar con el socket de Docker
 * (`docker.ts`). Un bind-mount de `/var/run/docker.sock` que quede obsoleto
 * tras un reinicio del host (Docker Desktop/WSL2 recrea el socket) deja el
 * proceso Node vivo — "process is alive" seguiría siendo cierto — mientras
 * cada `/modelo` o `/tarea` real falla en silencio. Ver docs/operations.md.
 *
 * Réplica deliberadamente mínima de la condición de `index.ts` ("solo
 * instancia Docker si /modelo o /tarea pueden usarlo") — sin importar
 * `config.ts` completo, para que este script siga siendo un binario aparte,
 * pequeño, ejecutado por el propio Docker vía `HEALTHCHECK CMD`.
 */
import Docker from 'dockerode';

const needsDocker =
  (process.env['CONTROL_BOT_MODEL_CHOICES'] ?? '').trim() !== '' &&
  (process.env['CONTROL_BOT_HERMES_CONTAINER_NAME'] ?? '').trim() !== '';

async function main(): Promise<void> {
  if (!needsDocker) {
    // Ni /modelo ni /tarea están configurados: este bot no necesita el
    // socket, y process.exit(0) desde aquí ya certifica que el proceso
    // arrancó (Node ejecutó este script hasta el final).
    process.exit(0);
  }

  const docker = new Docker();
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error('docker.ping() timeout'));
    }, 3000);
  });

  try {
    await Promise.race([docker.ping(), timeout]);
    process.exit(0);
  } catch (err) {
    // stderr, no logger estructurado: este script corre fuera del proceso
    // principal, `docker inspect` es donde se ve el resultado, no los logs.
    console.error('healthcheck: socket de Docker inalcanzable', err);
    process.exit(1);
  }
}

void main();
