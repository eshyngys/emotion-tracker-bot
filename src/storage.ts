import type { Answer, AwaitingState, DayState, Env, UserRecord } from "./types";

const TTL_STATE = 60 * 60 * 24 * 3; // 3 days
const TTL_AWAITING = 60 * 60 * 24 * 3; // 3 days
const TTL_ANSWER = 60 * 60 * 24 * 60; // 60 days, plenty for a weekly digest

// --- users (multi-subscriber) -------------------------------------------------------------
// Each subscriber is `user:{chatId}`, with a small UserRecord stored as KV *metadata* (not the
// value) so listUsers() can read everyone in one cheap `list()` call instead of one `get` per user.

export async function addUser(env: Env, chatId: number): Promise<void> {
  const key = `user:${chatId}`;
  const existing = await env.EMOTIONS_KV.getWithMetadata<UserRecord>(key);
  if (existing.metadata) return; // already subscribed, keep original joinedAt
  const record: UserRecord = { chatId, joinedAt: new Date().toISOString() };
  await env.EMOTIONS_KV.put(key, "1", { metadata: record });
}

export async function removeUser(env: Env, chatId: number): Promise<void> {
  await env.EMOTIONS_KV.delete(`user:${chatId}`);
}

export async function listUsers(env: Env): Promise<UserRecord[]> {
  const users: UserRecord[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.EMOTIONS_KV.list<UserRecord>({ prefix: "user:", cursor });
    for (const k of page.keys) {
      if (k.metadata) users.push(k.metadata);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return users;
}

// --- admin (the bot owner — receives /stats, and is the target of /debug/* test routes) -------

export async function getAdminChatId(env: Env): Promise<number | null> {
  const raw = await env.EMOTIONS_KV.get("admin_chat_id");
  return raw ? Number(raw) : null;
}

export async function setAdminChatId(env: Env, chatId: number): Promise<void> {
  await env.EMOTIONS_KV.put("admin_chat_id", String(chatId));
}

/**
 * One-time migration from the old single-subscriber model (a bare `subscriber` key) to the
 * multi-user model: whoever was the sole subscriber becomes both the admin and a regular user.
 * Safe to call on every request — it's a no-op once `admin_chat_id` exists.
 */
export async function ensureLegacySubscriberMigrated(env: Env): Promise<void> {
  const admin = await getAdminChatId(env);
  if (admin) return;
  const legacy = await env.EMOTIONS_KV.get("subscriber");
  if (!legacy) return;
  const chatId = Number(legacy);
  await setAdminChatId(env, chatId);
  await addUser(env, chatId);
  await env.EMOTIONS_KV.delete("subscriber");
}

// --- per-user daily state -------------------------------------------------------------------

export async function getDayState(env: Env, chatId: number, dateKeyStr: string): Promise<DayState | null> {
  return env.EMOTIONS_KV.get<DayState>(`state:${chatId}:${dateKeyStr}`, "json");
}

export async function setDayState(
  env: Env,
  chatId: number,
  dateKeyStr: string,
  state: DayState
): Promise<void> {
  await env.EMOTIONS_KV.put(`state:${chatId}:${dateKeyStr}`, JSON.stringify(state), {
    expirationTtl: TTL_STATE,
  });
}

export async function clearDayState(env: Env, chatId: number, dateKeyStr: string): Promise<void> {
  await env.EMOTIONS_KV.delete(`state:${chatId}:${dateKeyStr}`);
}

export async function setAwaiting(env: Env, chatId: number, state: AwaitingState): Promise<void> {
  await env.EMOTIONS_KV.put(`awaiting:${chatId}`, JSON.stringify(state), {
    expirationTtl: TTL_AWAITING,
  });
}

export async function getAwaiting(env: Env, chatId: number): Promise<AwaitingState | null> {
  return env.EMOTIONS_KV.get<AwaitingState>(`awaiting:${chatId}`, "json");
}

export async function clearAwaiting(env: Env, chatId: number): Promise<void> {
  await env.EMOTIONS_KV.delete(`awaiting:${chatId}`);
}

export async function saveAnswer(
  env: Env,
  chatId: number,
  dateKeyStr: string,
  answer: Answer
): Promise<void> {
  await env.EMOTIONS_KV.put(`answer:${chatId}:${dateKeyStr}`, JSON.stringify(answer), {
    expirationTtl: TTL_ANSWER,
  });
}

export async function getAnswer(env: Env, chatId: number, dateKeyStr: string): Promise<Answer | null> {
  return env.EMOTIONS_KV.get<Answer>(`answer:${chatId}:${dateKeyStr}`, "json");
}

export async function clearAnswer(env: Env, chatId: number, dateKeyStr: string): Promise<void> {
  await env.EMOTIONS_KV.delete(`answer:${chatId}:${dateKeyStr}`);
}

// --- shared Telegram file_id cache (same illustrative cards for every user) -------------------

export async function getCachedFileId(env: Env, assetKey: string): Promise<string | null> {
  return env.EMOTIONS_KV.get(`file_id:${assetKey}`);
}

export async function setCachedFileId(env: Env, assetKey: string, fileId: string): Promise<void> {
  await env.EMOTIONS_KV.put(`file_id:${assetKey}`, fileId);
}
