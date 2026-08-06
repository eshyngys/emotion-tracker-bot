# emotion-tracker-bot

Телеграм-бот на Cloudflare Workers: раз в день, в случайное время между 7:00 и 22:00
(Asia/Almaty), спрашивает "какую эмоцию ты испытываешь и почему", а по воскресеньям
вечером присылает markdown-файл со сводкой за неделю — удобно скинуть Claude и обсудить
закономерности.

Работает полностью бесплатно на Cloudflare (Workers Free tier + KV), ничего не должно
быть постоянно включено — ни ваш ноутбук, ни сервер.

## 1. Создать бота в Telegram

1. Напишите [@BotFather](https://t.me/BotFather) → `/newbot` → задайте имя и юзернейм.
2. Сохраните токен вида `123456:ABC-DEF...` — он понадобится ниже.

## 2. Установить зависимости и авторизоваться в Cloudflare

```bash
cd emotion-tracker-bot
npm install
npx wrangler login
```

Откроется браузер для входа в (бесплатный) аккаунт Cloudflare.

## 3. Создать KV-хранилище

```bash
npx wrangler kv namespace create EMOTIONS_KV
```

Команда выведет что-то вроде:

```
[[kv_namespaces]]
binding = "EMOTIONS_KV"
id = "abcd1234..."
```

Скопируйте `id` в [wrangler.toml](wrangler.toml), заменив `REPLACE_WITH_KV_NAMESPACE_ID`.

## 4. Задать секреты

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# вставьте токен от BotFather

npx wrangler secret put WEBHOOK_SECRET
# придумайте любую случайную строку, например: openssl rand -hex 20
```

## 5. Задеплоить

```bash
npm run deploy
```

Wrangler выведет URL воркера, например `https://emotion-tracker-bot.<ваш-субдомен>.workers.dev`.

## 6. Подключить вебхук Telegram к воркеру

```bash
curl "https://api.telegram.org/bot<ВАШ_ТОКЕН>/setWebhook" \
  -d "url=https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/webhook" \
  -d "secret_token=<ТА_ЖЕ_СТРОКА_ЧТО_В_WEBHOOK_SECRET>"
```

Проверить, что вебхук встал:

```bash
curl "https://api.telegram.org/bot<ВАШ_ТОКЕН>/getWebhookInfo"
```

## 7. Подписаться

Откройте бота в Telegram и отправьте `/start`. С этого момента:

- каждый день в случайное время в окне 7:00–22:00 (Almaty) бот пришлёт два вопроса;
- ответьте одним сообщением, эмоция на первой строке, причина — на второй;
- по воскресеньям в ~20:00 бот сам пришлёт `.md`-сводку за неделю;
- `/report` — получить сводку за последние 7 дней в любой момент, не дожидаясь воскресенья;
- `/stop` — отписаться.

## Отладка без ожидания крона

Можно дёрнуть вручную (используя ваш `WEBHOOK_SECRET`):

```bash
curl "https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/debug/send-now?secret=<WEBHOOK_SECRET>"
curl "https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/debug/digest?secret=<WEBHOOK_SECRET>"
```

Логи в реальном времени:

```bash
npm run tail
```

## Как это устроено

- `src/index.ts` — HTTP-роутинг (вебхук Telegram + debug-эндпоинты) и `scheduled()` — обработчик крона.
- Cron `*/10 2-16 * * *` (UTC) = каждые 10 минут в окне 7:00–21:50 по Алматы: при первом
  срабатывании в сутках выбирается случайный момент отправки и сохраняется в KV; при каждом
  следующем срабатывании проверяется, не пора ли уже слать.
- Cron `0 15 * * 0` (UTC) = воскресенье 20:00 по Алматы — сборка и отправка недельной сводки.
- `src/storage.ts` — обёртка над Cloudflare KV (кто подписан, состояние дня, ожидание ответа, сами ответы).
- `src/digest.ts` — парсинг ответа пользователя и генерация markdown-сводки.
- `src/telegram.ts` — минимальный клиент Telegram Bot API (sendMessage/sendDocument/setWebhook).

## Смена часового пояса или окна времени

В [wrangler.toml](wrangler.toml) переменные `TZ_OFFSET_MINUTES`, `WINDOW_START_HOUR`,
`WINDOW_END_HOUR`. Если меняете окно — не забудьте синхронно поправить диапазон часов в
UTC у первого cron-выражения в `[triggers]` (сейчас `2-16` UTC = `7-21` Almaty).
