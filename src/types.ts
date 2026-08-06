export interface Env {
  EMOTIONS_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  TZ_OFFSET_MINUTES: string;
  WINDOW_START_HOUR: string;
  WINDOW_END_HOUR: string;
}

export interface DayState {
  /** ISO timestamp (UTC) of the randomly chosen moment to send today's question */
  target: string;
  sent: boolean;
}

export interface Answer {
  emotion: string;
  reason: string;
  /** raw text the user sent, kept as a fallback in case parsing was imperfect */
  raw: string;
  answeredAt: string;
}

export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    date: number;
  };
}
