/**
 * Sonda de los eslabones de la cadena de proveedores del agent loop de Hermes
 * (Fase 13, US-13.5).
 *
 * QUÉ RESPONDE Y QUÉ NO, porque la diferencia importa:
 *
 * Responde "¿está vivo cada eslabón que esperamos, y tiene el modelo
 * descargado?". NO responde "¿qué proveedor atendió el último turno?" — eso
 * vive dentro de hermes-agent, que solo lo deja caer en texto de log al hacer
 * fallback (`auxiliary_client.py`: "falling back to %s") sin ningún registro
 * estructurado. Afirmarlo aquí sería inventarse un dato que no tenemos.
 *
 * Tampoco lee la cadena real de hermes: esa vive en su `config.yaml`, dentro
 * de un volumen que contiene también `auth.json` con el token OAuth. Montarlo
 * en este bot —el proceso que ingiere texto de Telegram— contradiría SEC-1.5.
 * Así que se sondea una lista DECLARADA, y el comando lo dice en su salida en
 * vez de dejar que el Operador asuma que está viendo la configuración viva.
 */

export type ProbeKind = 'ollama' | 'http';

export interface ProviderProbe {
  name: string;
  kind: ProbeKind;
  url: string;
}

export interface ProbeResult {
  name: string;
  kind: ProbeKind;
  reachable: boolean;
  /** Detalle legible: modelos descargados, código HTTP, o el error. */
  detail: string;
}

export class ProbeConfigError extends Error {}

/**
 * Parsea `nombre|tipo|url,nombre|tipo|url`.
 *
 * Separador `|` entre campos y `,` entre entradas porque las URLs llevan `:`
 * y `/` — cualquier separador más "natural" chocaría con ellas.
 */
export function parseProbes(raw: string): ProviderProbe[] {
  const probes: ProviderProbe[] = [];
  for (const entry of raw.split(',').map((e) => e.trim())) {
    if (entry.length === 0) continue;
    const parts = entry.split('|').map((p) => p.trim());
    if (parts.length !== 3) {
      throw new ProbeConfigError(
        `Eslabón mal formado: "${entry}". Formato esperado: nombre|tipo|url`,
      );
    }
    const [name, kind, url] = parts as [string, string, string];
    if (kind !== 'ollama' && kind !== 'http') {
      throw new ProbeConfigError(`Tipo de sonda desconocido en "${entry}": "${kind}"`);
    }
    if (name.length === 0 || url.length === 0) {
      throw new ProbeConfigError(`Eslabón con nombre o url vacíos: "${entry}"`);
    }
    probes.push({ name, kind, url });
  }
  return probes;
}

/** Tope por sonda: un eslabón colgado no debe bloquear el informe entero. */
export const PROBE_TIMEOUT_MS = 5_000;

async function probeOllama(url: string, fetchImpl: typeof fetch): Promise<ProbeResult['detail']> {
  const res = await fetchImpl(`${url.replace(/\/$/, '')}/api/tags`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  const body = (await res.json()) as { models?: { name?: string }[] };
  const models = (body.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
  if (models.length === 0) {
    // Servidor vivo pero sin modelos = la cadena falla igual en el primer
    // turno. Distinguirlo de "caído" ahorra el diagnóstico equivocado.
    return 'vivo, pero SIN modelos descargados (ollama pull pendiente)';
  }
  return `modelos: ${models.join(', ')}`;
}

async function probeHttp(url: string, fetchImpl: typeof fetch): Promise<ProbeResult['detail']> {
  const res = await fetchImpl(url, {
    method: 'GET',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  // Un 401/403 CUENTA como alcanzable: se sondea sin credenciales a
  // propósito, así que un rechazo de autenticación demuestra justo lo que
  // queremos saber — que hay alguien al otro lado.
  if (res.status === 401 || res.status === 403) {
    return `alcanzable (HTTP ${String(res.status)}, sin credenciales en la sonda)`;
  }
  return `HTTP ${String(res.status)}`;
}

export async function probeProvider(
  probe: ProviderProbe,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  try {
    const detail =
      probe.kind === 'ollama'
        ? await probeOllama(probe.url, fetchImpl)
        : await probeHttp(probe.url, fetchImpl);
    return { name: probe.name, kind: probe.kind, reachable: true, detail };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { name: probe.name, kind: probe.kind, reachable: false, detail: message };
  }
}

export async function probeAll(
  probes: ProviderProbe[],
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult[]> {
  // En paralelo: son sondas independientes y con timeout propio, y en serie el
  // informe tardaría la suma de todos los eslabones caídos.
  return Promise.all(probes.map((p) => probeProvider(p, fetchImpl)));
}

export function formatProbes(probes: ProviderProbe[], results: ProbeResult[]): string {
  if (probes.length === 0) {
    return 'No hay ningún eslabón configurado (CONTROL_BOT_PROVIDER_PROBES vacía).';
  }

  const lines = ['Cadena de proveedores del agent loop de Hermes', ''];
  results.forEach((r, i) => {
    lines.push(`${String(i + 1)}. ${r.name} ${r.reachable ? '— OK' : '— CAÍDO'}`);
    lines.push(`   ${r.detail}`);
  });

  const vivos = results.filter((r) => r.reachable).length;
  lines.push('');
  lines.push(`${String(vivos)}/${String(results.length)} eslabones alcanzables.`);
  if (vivos === 0) {
    lines.push('Ninguno responde: Hermes no podrá contestar a nada por chat.');
  }
  lines.push('');
  lines.push('Esto sondea los eslabones DECLARADOS, no lee la cadena viva de');
  lines.push('hermes. Si la cambiaste con `hermes fallback`, actualiza también');
  lines.push('CONTROL_BOT_PROVIDER_PROBES.');
  return lines.join('\n');
}
