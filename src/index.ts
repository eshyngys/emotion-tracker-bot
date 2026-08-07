import { dateKey, lastNDateKeys, localNow, randomTargetForToday } from "./dates";
import { buildDigest } from "./digest";
import {
  addUser,
  clearAnswer,
  clearAwaiting,
  clearDayState,
  ensureLegacySubscriberMigrated,
  getAdminChatId,
  getAnswer,
  getAwaiting,
  getCachedFileId,
  getDayState,
  listUsers,
  removeUser,
  saveAnswer,
  setAwaiting,
  setCachedFileId,
  setDayState,
} from "./storage";
import { sendDocument, sendMessage, sendPhotoByFileId, sendPhotoByUrl } from "./telegram";
import type { Answer, Env, TelegramUpdate } from "./types";

const QUESTION_1_TEXT = "👋 Как ты сейчас?\n\n1️⃣ Какую эмоцию ты сейчас испытываешь? (коротко)";
const QUESTION_2_TEXT = "2️⃣ А почему ты сейчас испытываешь такую эмоцию? (коротко)";

// Illustrative cards from the design handoff, hosted straight from the public repo — Telegram
// fetches the URL once and we cache the returned file_id, so it's only ever fetched once total
// (shared across all users, not per-user).
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/eshyngys/emotion-tracker-bot/main/assets/cards";
const CARD_URLS = {
  "card-1": `${GITHUB_RAW_BASE}/card-1-emotion.png`,
  "card-2": `${GITHUB_RAW_BASE}/card-2-reason.png`,
  "card-3": `${GITHUB_RAW_BASE}/card-3-report.png`,
} as const;
type CardKey = keyof typeof CARD_URLS;

async function sendCard(env: Env, chatId: number | string, card: CardKey, caption: string): Promise<void> {
  const cachedFileId = await getCachedFileId(env, card);
  if (cachedFileId) {
    await sendPhotoByFileId(env, chatId, cachedFileId, caption);
    return;
  }
  const fileId = await sendPhotoByUrl(env, chatId, CARD_URLS[card], caption);
  if (fileId) {
    await setCachedFileId(env, card, fileId);
  }
}

const WELCOME_TEXT =
  "Привет!\n\n" +
  "Раз в день, в случайное время примерно с 7:00 до 22:00, я буду спрашивать про твои эмоции.\n\n" +
  "Вопросы будут по очереди: сначала эмоция, после твоего ответа — почему. Отвечай коротко, своими словами.\n\n" +
  "По воскресеньям вечером пришлю markdown-файл со сводкой за неделю — его можно скинуть Claude и обсудить закономерности.\n\n" +
  "Команды:\n/report — прислать сводку за последние 7 дней прямо сейчас\n/stop — отписаться";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureLegacySubscriberMigrated(env);
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const update = (await request.json()) as TelegramUpdate;
      ctx.waitUntil(
        handleUpdate(update, env).catch(async (err) => {
          // handleUpdate runs after we already answered Telegram with 200, so a crash here is
          // otherwise completely invisible — surface it straight to the sender's chat instead.
          console.error("handleUpdate crashed", err);
          const chatId = update.message?.chat.id;
          if (chatId) {
            const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
            await sendMessage(env, chatId, `⚠️ Ошибка обработки: ${detail}`).catch(() => {});
          }
        })
      );
      return new Response("ok");
    }

    // Debug/dev routes always target the admin's own chat — never the whole user base.
    // All of them honestly report "no admin" instead of pretending to have done something.
    if (url.pathname === "/debug/send-now" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      const admin = await getAdminChatId(env);
      if (!admin) return new Response("no admin set yet", { status: 409 });
      await maybeSendDailyQuestionForUser(env, admin, true);
      return new Response("triggered send check");
    }
    if (url.pathname === "/debug/digest" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      const admin = await getAdminChatId(env);
      if (!admin) return new Response("no admin set yet", { status: 409 });
      await sendWeeklyDigestForUser(env, admin);
      return new Response("triggered digest");
    }
    if (url.pathname === "/debug/preview-cards" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      const admin = await getAdminChatId(env);
      if (!admin) return new Response("no admin set yet", { status: 409 });
      await previewAllCards(env, admin);
      return new Response("triggered cards preview");
    }
    if (url.pathname === "/debug/reset-today" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      const admin = await getAdminChatId(env);
      if (!admin) return new Response("no admin set yet", { status: 409 });
      await resetToday(env, admin);
      return new Response("today reset");
    }
    // Read-only inspector: current admin, subscriber count and their chat ids. No secrets exposed.
    if (url.pathname === "/debug/state" && url.searchParams.get("secret") === env.WEBHOOK_SECRET) {
      const admin = await getAdminChatId(env);
      const users = await listUsers(env);
      return new Response(
        JSON.stringify({
          adminChatId: admin,
          userCount: users.length,
          users: users.map((u) => ({ chatId: u.chatId, joinedAt: u.joinedAt })),
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureLegacySubscriberMigrated(env);
    if (event.cron === "0 15 * * 7") {
      ctx.waitUntil(sendWeeklyDigestAllUsers(env));
    } else {
      ctx.waitUntil(tickAllUsers(env));
    }
  },
};

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === "/start") {
    await addUser(env, chatId);
    await sendMessage(env, chatId, WELCOME_TEXT);
    return;
  }

  if (text === "/stop") {
    await removeUser(env, chatId);
    await sendMessage(env, chatId, "Окей, больше не буду спрашивать. /start — чтобы возобновить.");
    return;
  }

  if (text === "/report") {
    await sendMessage(env, chatId, "Собираю сводку за последние 7 дней…");
    await sendWeeklyDigestForUser(env, chatId);
    return;
  }

  if (text === "/stats") {
    const admin = await getAdminChatId(env);
    if (admin === chatId) {
      await sendMessage(env, chatId, await buildStatsText(env));
    }
    // Silently ignored for non-admins — no hint the command exists, no data leaked.
    return;
  }

  const awaiting = await getAwaiting(env, chatId);
  if (awaiting?.step === 1) {
    // Got the emotion — now ask why, and remember the emotion for step 2.
    await setAwaiting(env, chatId, { dateKey: awaiting.dateKey, step: 2, emotion: text });
    await sendCard(env, chatId, "card-2", QUESTION_2_TEXT);
    return;
  }

  if (awaiting?.step === 2) {
    const answer: Answer = {
      emotion: awaiting.emotion ?? "",
      reason: text,
      answeredAt: new Date().toISOString(),
    };
    await saveAnswer(env, chatId, awaiting.dateKey, answer);
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

async function maybeSendDailyQuestionForUser(env: Env, chatId: number, force: boolean): Promise<void> {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  const windowStart = Number(env.WINDOW_START_HOUR);
  const windowEnd = Number(env.WINDOW_END_HOUR);

  const today = dateKey(localNow(offset));
  let state = await getDayState(env, chatId, today);

  if (!state) {
    const target = randomTargetForToday(today, windowStart, windowEnd, offset);
    state = { target: target.toISOString(), sent: false };
    await setDayState(env, chatId, today, state);
  }

  if (state.sent) return;

  const due = force || new Date() >= new Date(state.target);
  if (!due) return;

  await sendCard(env, chatId, "card-1", QUESTION_1_TEXT);
  await setAwaiting(env, chatId, { dateKey: today, step: 1 });
  await setDayState(env, chatId, today, { ...state, sent: true });
}

/** Runs the daily-question check for every subscriber. Called every 10 min inside the window. */
async function tickAllUsers(env: Env): Promise<void> {
  const users = await listUsers(env);
  await Promise.all(users.map((u) => maybeSendDailyQuestionForUser(env, u.chatId, false)));
}

async function previewAllCards(env: Env, chatId: number): Promise<void> {
  await sendCard(env, chatId, "card-1", QUESTION_1_TEXT);
  await sendCard(env, chatId, "card-2", QUESTION_2_TEXT);
  await sendCard(env, chatId, "card-3", "Твой отчёт готов 📊");
}

async function resetToday(env: Env, chatId: number): Promise<void> {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  const today = dateKey(localNow(offset));
  await clearDayState(env, chatId, today);
  await clearAnswer(env, chatId, today);
  await clearAwaiting(env, chatId);
}

async function sendWeeklyDigestForUser(env: Env, chatId: number): Promise<void> {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  const dateKeys = lastNDateKeys(offset, 7);
  const answers = await Promise.all(dateKeys.map((k) => getAnswer(env, chatId, k)));
  const markdown = buildDigest(dateKeys, answers);
  const filename = `emotions-${dateKeys[0]}_${dateKeys[dateKeys.length - 1]}.md`;

  await sendCard(env, chatId, "card-3", "Твой отчёт готов 📊");
  await sendDocument(env, chatId, filename, markdown, "Сводка эмоций за неделю");
}

/** Sunday cron: sends every subscriber their own digest. Sequential — gentle on Telegram rate limits. */
async function sendWeeklyDigestAllUsers(env: Env): Promise<void> {
  const users = await listUsers(env);
  for (const u of users) {
    await sendWeeklyDigestForUser(env, u.chatId);
  }
}

async function buildStatsText(env: Env): Promise<string> {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  const users = await listUsers(env);
  const today = dateKey(localNow(offset));
  const last7 = lastNDateKeys(offset, 7);

  const answeredToday = (
    await Promise.all(users.map((u) => getAnswer(env, u.chatId, today)))
  ).filter((a) => a !== null).length;

  const active7dFlags = await Promise.all(
    users.map(async (u) => {
      const answers = await Promise.all(last7.map((d) => getAnswer(env, u.chatId, d)));
      return answers.some((a) => a !== null);
    })
  );
  const active7d = active7dFlags.filter(Boolean).length;

  const oldestFirst = [...users].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const lastJoined = oldestFirst[oldestFirst.length - 1];

  const lines = [
    "📊 Статистика бота",
    "",
    `Всего подписано: ${users.length}`,
    `Ответили сегодня: ${answeredToday} из ${users.length}`,
    `Активны за 7 дней (≥1 ответ): ${active7d} из ${users.length}`,
  ];
  if (lastJoined) {
    lines.push(`Последний подписался: ${lastJoined.joinedAt.slice(0, 16).replace("T", " ")} UTC`);
  }
  return lines.join("\n");
}
