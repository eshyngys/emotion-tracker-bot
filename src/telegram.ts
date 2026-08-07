import type { Env } from "./types";

function apiUrl(env: Env, method: string): string {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

export async function sendMessage(env: Env, chatId: number | string, text: string): Promise<void> {
  const res = await fetch(apiUrl(env, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    console.error("sendMessage failed", res.status, await res.text());
  }
}

export async function sendDocument(
  env: Env,
  chatId: number | string,
  filename: string,
  content: string,
  caption?: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/markdown" }), filename);

  const res = await fetch(apiUrl(env, "sendDocument"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    console.error("sendDocument failed", res.status, await res.text());
  }
}

interface SendPhotoResult {
  result?: { photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }> };
}

/** Sends a photo by URL (Telegram fetches it server-side) and returns the file_id for caching. */
export async function sendPhotoByUrl(
  env: Env,
  chatId: number | string,
  photoUrl: string,
  caption?: string
): Promise<string | null> {
  const res = await fetch(apiUrl(env, "sendPhoto"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption }),
  });
  if (!res.ok) {
    console.error("sendPhotoByUrl failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as SendPhotoResult;
  const sizes = data.result?.photo;
  if (!sizes || sizes.length === 0) return null;
  // Telegram returns several resized copies; the last one is the largest (closest to original).
  return sizes[sizes.length - 1].file_id;
}

/** Sends a photo Telegram already has cached, by file_id — no re-upload/re-fetch involved. */
export async function sendPhotoByFileId(
  env: Env,
  chatId: number | string,
  fileId: string,
  caption?: string
): Promise<void> {
  const res = await fetch(apiUrl(env, "sendPhoto"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: fileId, caption }),
  });
  if (!res.ok) {
    console.error("sendPhotoByFileId failed", res.status, await res.text());
  }
}

export async function setWebhook(env: Env, url: string): Promise<Response> {
  return fetch(apiUrl(env, "setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: env.WEBHOOK_SECRET }),
  });
}
