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

export async function setWebhook(env: Env, url: string): Promise<Response> {
  return fetch(apiUrl(env, "setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: env.WEBHOOK_SECRET }),
  });
}
