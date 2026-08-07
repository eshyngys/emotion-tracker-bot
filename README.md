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

Откройте бота в Telegram и отправьте `/start`. Бот многопользовательский — любой, кому вы
дали ссылку на бота, может так же написать `/start` и получит свой независимый ежедневный
вопрос и свою еженедельную сводку, не мешая другим. С этого момента для каждого подписчика:

- каждый день в случайное (своё, независимое от других) время в окне 7:00–22:00 (Almaty) бот
  пришлёт вопрос-карточку с эмоцией, дождётся ответа и пришлёт вторую карточку с "почему";
- по воскресеньям в ~20:00 бот сам пришлёт `.md`-сводку за неделю;
- `/report` — получить сводку за последние 7 дней в любой момент, не дожидаясь воскресенья;
- `/stop` — отписаться.

**Первый, кто отправит `/start` после первого деплоя, автоматически становится админом**
(это выясняется один раз через миграцию старого одно-пользовательского ключа) — только админу
доступна команда `/stats` (см. ниже); для остальных она молча игнорируется.

## Статистика (только для админа)

Отправьте боту `/stats` — придёт текстом: сколько всего подписано, сколько ответили сегодня,
сколько было активно (хотя бы 1 ответ) за последние 7 дней, когда подписался последний человек.

## Отладка без ожидания крона

Можно дёрнуть вручную (используя ваш `WEBHOOK_SECRET`):

```bash
curl "https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/debug/send-now?secret=<WEBHOOK_SECRET>"
curl "https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/debug/digest?secret=<WEBHOOK_SECRET>"
curl "https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/debug/preview-cards?secret=<WEBHOOK_SECRET>"
curl "https://emotion-tracker-bot.<ваш-субдомен>.workers.dev/debug/reset-today?secret=<WEBHOOK_SECRET>"
```

Все `/debug/*` роуты всегда шлют только админу (никогда — всей аудитории).

Логи в реальном времени:

```bash
npm run tail
```

## Как это устроено

- `src/index.ts` — HTTP-роутинг (вебхук Telegram + debug-эндпоинты) и `scheduled()` — обработчик крона.
- Cron `*/10 2-16 * * *` (UTC) = каждые 10 минут в окне 7:00–21:50 по Алматы: перебирает всех
  подписчиков (`listUsers`), и для каждого — если на сегодня ещё не выбрано время, выбирает
  случайное и сохраняет в KV; если уже выбрано и оно наступило — шлёт вопрос именно этому
  пользователю. Каждый подписчик получает вопрос в своё случайное время, независимо от других.
- Cron `0 15 * * 7` (UTC=7 это воскресенье в дне недели Cloudflare, у них 1–7 а не 0–7 как в
  обычном unix-cron) = воскресенье 20:00 по Алматы — сборка и отправка недельной сводки каждому
  подписчику по очереди.
- `src/storage.ts` — обёртка над Cloudflare KV: список подписчиков (`user:{chatId}`, метаданные
  вместо отдельного `get` на каждого — дёшево), кто админ, состояние дня и ответы **на пользователя**
  (`state:{chatId}:{date}`, `answer:{chatId}:{date}`), ожидание ответа (`awaiting:{chatId}`).
- `src/digest.ts` — генерация markdown-сводки по ответам одного пользователя.
- `src/telegram.ts` — минимальный клиент Telegram Bot API (sendMessage/sendDocument/sendPhoto/setWebhook).

## Смена часового пояса или окна времени

В [wrangler.toml](wrangler.toml) переменные `TZ_OFFSET_MINUTES`, `WINDOW_START_HOUR`,
`WINDOW_END_HOUR`. Если меняете окно — не забудьте синхронно поправить диапазон часов в
UTC у первого cron-выражения в `[triggers]` (сейчас `2-16` UTC = `7-21` Almaty).
