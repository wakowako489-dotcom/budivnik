import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requestCounts = new Map();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));

function rateLimit(ip) {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now - entry.startedAt > 60_000) {
    requestCounts.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 5;
}

function clean(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

app.post('/api/lead', async (req, res) => {
  if (!rateLimit(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  const name = clean(req.body?.name, 60);
  const phone = clean(req.body?.phone, 30);
  const service = clean(req.body?.service, 100);
  const details = clean(req.body?.details, 1200);
  const language = ['ru', 'uk', 'en'].includes(req.body?.language) ? req.body.language : 'ru';
  const honeypot = clean(req.body?.website, 150);

  if (honeypot) return res.json({ ok: true });
  if (name.length < 2 || phone.replace(/\D/g, '').length < 7 || !service) {
    return res.status(400).json({ ok: false, error: 'Invalid form data' });
  }
  if (!botToken || !chatId) {
    console.error('Telegram credentials are not configured.');
    return res.status(503).json({ ok: false, error: 'Service is not configured' });
  }

  const date = new Intl.DateTimeFormat('uk-UA', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv'
  }).format(new Date());
  const languageName = { ru: 'Русский', uk: 'Українська', en: 'English' }[language];
  const message = [
    '🧱 НОВАЯ ЗАЯВКА С САЙТА',
    '',
    `👤 Имя: ${name}`,
    `📞 Телефон: ${phone}`,
    `🛠 Услуга: ${service}`,
    details ? `📝 Комментарий: ${details}` : '📝 Комментарий: не указан',
    `🌐 Язык сайта: ${languageName}`,
    `🕒 Дата: ${date}`
  ].join('\n');

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(12_000)
    });
    const telegramResult = await telegramResponse.json().catch(() => ({}));
    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error('Telegram rejected a lead:', telegramResult.description || telegramResponse.status);
      return res.status(502).json({ ok: false, error: 'Telegram delivery failed' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Telegram delivery error:', error.message);
    return res.status(502).json({ ok: false, error: 'Telegram is unavailable' });
  }
});

app.listen(port, () => {
  console.log(`Gadir website is running on port ${port}`);
});
