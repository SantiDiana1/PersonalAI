/**
 * Filtro de secretos antes de persistir un `RawEvent` — docs/personal-brain/spec.md §7:
 * "Ningún secreto (tokens, credenciales) se ingesta nunca como texto plano".
 *
 * Dos capas, ambas heurísticas (esto no es un DLP completo, es una red de
 * seguridad básica para el caso más obvio: alguien pega una descripción de PR
 * o un log que arrastra un token sin darse cuenta):
 *
 * 1. Patrones conocidos de tokens de proveedores concretos (GitHub, OpenAI,
 *    Anthropic, AWS, Slack, claves privadas PEM).
 * 2. Un detector genérico de "string de alta entropía" para lo que no
 *    encaja en ningún patrón conocido pero tiene toda la pinta de ser un
 *    secreto (blob alfanumérico largo, sin espacios, con mezcla de
 *    mayúsculas/minúsculas/dígitos).
 */

interface KnownPattern {
  name: string;
  pattern: RegExp;
}

/** Prefijos/formatos de token bien documentados. Se amplía según haga falta. */
const KNOWN_PATTERNS: KnownPattern[] = [
  { name: 'github-pat-fine-grained', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'github-token-classic', pattern: /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/ },
  { name: 'openai-api-key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'anthropic-api-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'huggingface-token', pattern: /\bhf_[A-Za-z0-9]{20,}\b/ },
];

/** Umbral de longitud mínima para evaluar entropía — strings cortos no merecen la pena. */
const ENTROPY_MIN_LENGTH = 24;
/**
 * Umbral de entropía de Shannon (bits/carácter). Un texto en lenguaje natural
 * ronda 3.5-4.5; un secreto base64/hex aleatorio ronda 4.5-6. Se pone
 * relativamente alto para minimizar falsos positivos sobre texto real
 * (nombres de commit hashes largos, URLs con slugs, etc. se dejan pasar).
 */
const ENTROPY_THRESHOLD = 4.7;

/** Candidatos a "blob sospechoso": tokens sin espacios, solo alfanuméricos (+`-`/`_`/`.`/`/`+`=`). */
const CANDIDATE_TOKEN = /[A-Za-z0-9_\-./+=]{24,}/g;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export interface SecretDetection {
  found: boolean;
  /** Nombre del patrón conocido, o `'high-entropy-string'` para el detector genérico. */
  reason?: string;
}

/** Analiza un texto y devuelve si (probablemente) contiene un secreto. No modifica el texto. */
export function detectSecret(text: string): SecretDetection {
  for (const { name, pattern } of KNOWN_PATTERNS) {
    if (pattern.test(text)) {
      return { found: true, reason: name };
    }
  }

  for (const match of text.matchAll(CANDIDATE_TOKEN)) {
    const candidate = match[0];
    if (candidate.length < ENTROPY_MIN_LENGTH) continue;
    if (shannonEntropy(candidate) >= ENTROPY_THRESHOLD) {
      return { found: true, reason: 'high-entropy-string' };
    }
  }

  return { found: false };
}
