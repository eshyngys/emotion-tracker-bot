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
  answeredAt: string;
}

/** Tracks where the user is in today's two-step question flow. */
export interface AwaitingState {
  dateKey: string;
  step: 1 | 2;
  /** set once step 1 is answered, carried along until step 2 completes the answer */
  emotion?: string;
}

export interface UserRecord {
  chatId: number;
  joinedAt: string;
}

export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    date: number;
  };
}
