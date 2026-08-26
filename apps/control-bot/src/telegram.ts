/**
 * Cliente mínimo de la Bot API de Telegram: exactamente los dos métodos que
 * este bot necesita (`getUpdates`, `sendMessage`) y nada más.
 *
 * Sin librería de terceros a propósito: un framework de bots traería dispatch
 * de comandos, middlewares y estado que aquí sobran — el objetivo entero de
 * este servicio es ser pequeño y predecible.
 */
import { logger } from './logger.js';

/** Tope de un mensaje de Telegram. Un informe largo se parte en varios. */
export const MAX_MESSAGE_CHARS = 4096;

export interface TelegramMessage {
  chatId: number;
  fromId: number;
  text: string;
}

export interface TelegramUpdate {
  updateId: number;
  message?: TelegramMessage;
}

/** Inyectable para poder testear sin red. */
export type FetchLike = typeof fetch;

interface RawUpdate {
  update_id: number;
  message?: {
    chat?: { id?: number };
    from?: { id?: number };
    text?: string;
  };
}

export class TelegramClient {
  private readonly base: string;

  constructor(
    token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // El cuerpo de error de Telegram no incluye el token, pero la URL sí:
      // se cita el método, nunca la URL completa.
      throw new Error(`Telegram ${method} respondió ${String(res.status)}`);
    }
    const payload = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!payload.ok) {
      throw new Error(
        `Telegram ${method} devolvió ok=false: ${payload.description ?? 'sin motivo'}`,
      );
    }
    return payload.result as T;
  }

  async getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const raw = await this.call<RawUpdate[]>('getUpdates', {
      ...(offset !== undefined ? { offset } : {}),
      timeout: timeoutSeconds,
      // Solo mensajes: este bot no reacciona a ediciones, callbacks ni
      // reacciones, y pedirlos solo traería trabajo que descartar.
      allowed_updates: ['message'],
    });

    return raw.map((update) => {
      const chatId = update.message?.chat?.id;
      const fromId = update.message?.from?.id;
      const text = update.message?.text;
      if (chatId === undefined || fromId === undefined || text === undefined) {
        return { updateId: update.update_id };
      }
      return { updateId: update.update_id, message: { chatId, fromId, text } };
    });
  }

  /**
   * Envía un texto, partiéndolo si excede el tope de Telegram. Se parte por
   * líneas y no por caracteres: cortar un informe a mitad de una cifra lo
   * haría ilegible justo donde importa.
   */
  async sendMessage(chatId: number, text: string): Promise<void> {
    for (const chunk of splitMessage(text)) {
      await this.call('sendMessage', { chat_id: chatId, text: chunk });
    }
  }

  /**
   * Descarta el backlog acumulado y devuelve el offset desde el que empezar.
   *
   * Sin esto, un bot que estuvo caído procesaría al arrancar todos los
   * comandos pendientes de golpe — Telegram los retiene hasta 24 h. Un
   * `/metricas` de ayer no debe contestarse hoy como si acabara de llegar.
   */
  async discardBacklog(): Promise<number | undefined> {
    const updates = await this.getUpdates(-1, 0);
    const last = updates.at(-1);
    if (last === undefined) return undefined;
    logger.info({ discardedThrough: last.updateId }, 'backlog previo descartado al arrancar');
    return last.updateId + 1;
  }
}

export function splitMessage(text: string, max: number = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    // Una línea suelta más larga que el tope no puede respetarse: se trocea en
    // duro, que es preferible a no enviar nada.
    if (line.length > max) {
      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += max) {
        chunks.push(line.slice(i, i + max));
      }
      continue;
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > max) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
