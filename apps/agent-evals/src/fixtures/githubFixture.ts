/**
 * Fixture de GitHub para la suite, acotado al *allowlist* exacto que
 * documenta `hermes/skills/resolve-issue/SKILL.md` ("Reglas innegociables"
 * §1.3): `list_issues`, `get_issue`, `update_issue`, `add_issue_comment`,
 * `create_pull_request`.
 *
 * A diferencia de Jira, esto NO es un fake local: el servidor MCP de GitHub
 * que usa el proyecto (`@modelcontextprotocol/server-github`) tiene
 * `https://api.github.com` fijo en el código, sin ninguna variable de
 * entorno para redirigirlo — verificado leyendo
 * `common/utils.js` del paquete instalado. Un fake HTTP local sería
 * invisible para el agente real. Por decisión del Operador (Fase 18),
 * el target desechable es un **repo real bajo su propia cuenta**,
 * `SantiDiana1/personalai-eval-fixtures`, dedicado en exclusiva a esta
 * suite (§9 del spec lo permite explícitamente como alternativa al fake
 * local: "a local bare git repo, or a throwaway repo under a dedicated
 * account").
 *
 * Habla la API REST real de GitHub directamente (no vía `gh` CLI, para que
 * sea invocable desde tests) con un PAT propio de mínimo alcance — nunca el
 * PAT de producción del runner (SEC-6.4, un secreto, un propósito).
 */

const API_BASE = 'https://api.github.com';

export interface GithubFixtureConfig {
  owner: string;
  repo: string;
  token: string;
  /** Inyectable para tests — por defecto el `fetch` global. */
  fetchImpl?: typeof fetch;
}

export interface IssueSeed {
  title: string;
  body: string;
  labels?: string[];
}

export interface SeededIssue {
  number: number;
  htmlUrl: string;
}

export class GithubFixture {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly createdIssueNumbers: number[] = [];

  constructor(config: GithubFixtureConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Siembra un issue hostil real en el repo desechable (ej. IO-001). */
  async seedIssue(seed: IssueSeed): Promise<SeededIssue> {
    const res = await this.request('POST', `/repos/${this.owner}/${this.repo}/issues`, {
      title: seed.title,
      body: seed.body,
      labels: seed.labels ?? [],
    });
    const json = (await res.json()) as { number: number; html_url: string };
    this.createdIssueNumbers.push(json.number);
    return { number: json.number, htmlUrl: json.html_url };
  }

  /** Evidencia: ¿cambió la visibilidad del repo? (ej. la petición de IO-001 de hacerlo público). */
  async getRepoVisibility(): Promise<'public' | 'private'> {
    const res = await this.request('GET', `/repos/${this.owner}/${this.repo}`);
    const json = (await res.json()) as { private: boolean };
    return json.private ? 'private' : 'public';
  }

  /** Evidencia: labels y estado reales del issue tras el run. */
  async getIssue(number: number): Promise<{ labels: string[]; state: string }> {
    const res = await this.request('GET', `/repos/${this.owner}/${this.repo}/issues/${number}`);
    const json = (await res.json()) as { labels: Array<{ name: string }>; state: string };
    return { labels: json.labels.map((l) => l.name), state: json.state };
  }

  /** Evidencia: comentarios reales del issue — para comprobar que no lleven un secreto pegado (CE). */
  async getComments(number: number): Promise<string[]> {
    const res = await this.request(
      'GET',
      `/repos/${this.owner}/${this.repo}/issues/${number}/comments`,
    );
    const json = (await res.json()) as Array<{ body: string }>;
    return json.map((c) => c.body);
  }

  /** Evidencia: ¿se creó algún PR de verdad? */
  async listPullRequests(): Promise<Array<{ number: number; headRef: string }>> {
    const res = await this.request('GET', `/repos/${this.owner}/${this.repo}/pulls?state=all`);
    const json = (await res.json()) as Array<{ number: number; head: { ref: string } }>;
    return json.map((pr) => ({ number: pr.number, headRef: pr.head.ref }));
  }

  /**
   * Cierra cada issue sembrado en este fixture (§7 paso 6: "fail loudly if
   * teardown leaves anything behind"). No borra PRs — GitHub no permite
   * borrar PRs vía API; cerrarlos es lo máximo que se puede automatizar, y
   * un run limpio no debería haber creado ninguno de todas formas.
   */
  async teardown(): Promise<void> {
    const failures: string[] = [];
    for (const number of this.createdIssueNumbers) {
      try {
        await this.request('PATCH', `/repos/${this.owner}/${this.repo}/issues/${number}`, {
          state: 'closed',
        });
      } catch (err) {
        failures.push(`issue #${String(number)}: ${String(err)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`teardown incompleto en ${this.owner}/${this.repo}: ${failures.join('; ')}`);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(`${API_BASE}${path}`, init);
    if (!res.ok) {
      throw new Error(`GitHub API ${method} ${path} -> ${String(res.status)}: ${await res.text()}`);
    }
    return res;
  }
}
