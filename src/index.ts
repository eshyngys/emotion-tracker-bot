import { dateKey, lastNDateKeys, localNow, randomTargetForToday } from "./dates";
import { buildDigest, parseAnswer } from "./digest";
import {
  clearAwaiting,
  clearSubscriberChatId,
  getAnswer,
  getAwaiting,
  getDayState,
  getSubscriberChatId,
  saveAnswer,
  setAwaiting,
  setDayState,
  setSubscriberChatId,
} from "./storage";
import { sendDocument, sendMessage } from "./telegram";
import type { Answer, Env, TelegramUpdate } from "./types";

const QUESTION_TEXT =
  "👋 Как ты сейчас?\n\n" +
  "1️⃣ Какую эмоцию ты сейчас испытываешь? (коротко)\n" +
  "2️⃣ Почему ты сейчас испытываешь такую эмоцию? (коротко)\n\n" +
  "Ответь одним сообщением — эмоция на первой строке, причина на второй.";

const WELCOME_TEXT =
  "Привет! Раз в день, в случайное время примерно с 7:00 до 22:00, я буду спрашивать про твои эмоции. " +
  "Отвечай коротко в двух строках: эмоция и почему. По воскресеньям вечером пришлю markdown-файл со сводкой " +
  "за неделю — его можно скинуть Claude и обсудить закономерности.\n\n" +
  "Команды:\n/report — прислать сводку за последние 7 дней прямо сейчас\n/stop — отписаться";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    // Temporary diagnostic — reveals presence/length only, never the actual secret values.
    // Remove once the webhook/secret wiring is confirmed working.
    if (url.pathname === "/debug/env-check") {
      return new Response(
        JSON.stringify({
          hasToken: Boolean(env.TELEGRAM_BOT_TOKEN),
          tokenLength: env.TELEGRAM_BOT_TOKEN?.length ?? 0,
          hasWebhookSecret: Boolean(env.WEBHOOK_SECRET),
          webhookSecretLength: env.WEBHOOK_SECRET?.length ?? 0,
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const update = (await request.json()) as TelegramUpdate;
      ctx.waitUntil(handleUpdate(update, env));
      return new Response("ok");
    }

    // Manual triggers for testing without waiting for the cron window.
    if (url.pathname === "/debug/send-now" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      await maybeSendDailyQuestion(env, true);
      return new Response("triggered send check");
    }
    if (url.pathname === "/debug/digest" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      await sendWeeklyDigest(env);
      return new Response("triggered digest");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 15 * * 0") {
      ctx.waitUntil(sendWeeklyDigest(env));
    } else {
      ctx.waitUntil(maybeSendDailyQuestion(env, false));
    }
  },
};

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === "/start") {
    await setSubscriberChatId(env, chatId);
    await sendMessage(env, chatId, WELCOME_TEXT);
    return;
  }

  if (text === "/stop") {
    await clearSubscriberChatId(env);
    await sendMessage(env, chatId, "Окей, больше не буду спрашивать. /start — чтобы возобновить.");
    return;
  }

  if (text === "/report") {
    await sendMessage(env, chatId, "Собираю сводку за последние 7 дней…");
    await sendWeeklyDigest(env, chatId);
    return;
  }

  const awaitingDate = await getAwaiting(env, chatId);
  if (awaitingDate) {
    const { emotion, reason } = parseAnswer(text);
    const answer: Answer = { emotion, reason, raw: text, answeredAt: new Date().toISOString() };
    await saveAnswer(env, awaitingDate, answer);
    await clearAwaiting(env, chatId);
    await sendMessage(env, chatId, "Записал 📝 Спасибо!");
    return;
  }

  await sendMessage(
    env,
    chatId,
    "Сейчас нет активного вопроса. /report — сводка за неделю, /start — подписка на ежедневный вопрос."
  );
}

async function maybeSendDailyQuestion(env: Env, force: boolean): Promise<void> {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  const windowStart = Number(env.WINDOW_START_HOUR);
  const windowEnd = Number(env.WINDOW_END_HOUR);

  const today = dateKey(localNow(offset));
  let state = await getDayState(env, today);

  if (!state) {
    const target = randomTargetForToday(today, windowStart, windowEnd, offset);
    state = { target: target.toISOString(), sent: false };
    await setDayState(env, today, state);
  }

  if (state.sent) return;

  const due = force || new Date() >= new Date(state.target);
  if (!due) return;

  const subscriber = await getSubscriberChatId(env);
  if (!subscriber) return; // nobody has /start'ed the bot yet

  await sendMessage(env, subscriber, QUESTION_TEXT);
  await setAwaiting(env, Number(subscriber), today);
  await setDayState(env, today, { ...state, sent: true });
}

async function sendWeeklyDigest(env: Env, chatIdOverride?: number): Promise<void> {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  const subscriber = chatIdOverride ?? (await getSubscriberChatId(env));
  if (!subscriber) return;

  const dateKeys = lastNDateKeys(offset, 7);
  const answers = await Promise.all(dateKeys.map((k) => getAnswer(env, k)));
  const markdown = buildDigest(dateKeys, answers);
  const filename = `emotions-${dateKeys[0]}_${dateKeys[dateKeys.length - 1]}.md`;

  await sendDocument(env, subscriber, filename, markdown, "Сводка эмоций за неделю 📊");
}
