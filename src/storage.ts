import type { Answer, AwaitingState, DayState, Env } from "./types";

const TTL_STATE = 60 * 60 * 24 * 3; // 3 days
const TTL_AWAITING = 60 * 60 * 24 * 3; // 3 days
const TTL_ANSWER = 60 * 60 * 24 * 60; // 60 days, plenty for a weekly digest

export async function getSubscriberChatId(env: Env): Promise<string | null> {
  return env.EMOTIONS_KV.get("subscriber");
}

export async function setSubscriberChatId(env: Env, chatId: number): Promise<void> {
  await env.EMOTIONS_KV.put("subscriber", String(chatId));
}

export async function clearSubscriberChatId(env: Env): Promise<void> {
  await env.EMOTIONS_KV.delete("subscriber");
}

export async function getDayState(env: Env, dateKeyStr: string): Promise<DayState | null> {
  return env.EMOTIONS_KV.get<DayState>(`state:${dateKeyStr}`, "json");
}

export async function setDayState(env: Env, dateKeyStr: string, state: DayState): Promise<void> {
  await env.EMOTIONS_KV.put(`state:${dateKeyStr}`, JSON.stringify(state), {
    expirationTtl: TTL_STATE,
  });
}

export async function clearDayState(env: Env, dateKeyStr: string): Promise<void> {
  await env.EMOTIONS_KV.delete(`state:${dateKeyStr}`);
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
  dateKeyStr: string,
  answer: Answer
): Promise<void> {
  await env.EMOTIONS_KV.put(`answer:${dateKeyStr}`, JSON.stringify(answer), {
    expirationTtl: TTL_ANSWER,
  });
}

export async function getAnswer(env: Env, dateKeyStr: string): Promise<Answer | null> {
  return env.EMOTIONS_KV.get<Answer>(`answer:${dateKeyStr}`, "json");
}

export async function clearAnswer(env: Env, dateKeyStr: string): Promise<void> {
  await env.EMOTIONS_KV.delete(`answer:${dateKeyStr}`);
}

// Telegram file_ids for a given bot+file are effectively permanent, so these are cached with no TTL.
export async function getCachedFileId(env: Env, assetKey: string): Promise<string | null> {
  return env.EMOTIONS_KV.get(`file_id:${assetKey}`);
}

export async function setCachedFileId(env: Env, assetKey: string, fileId: string): Promise<void> {
  await env.EMOTIONS_KV.put(`file_id:${assetKey}`, fileId);
}
