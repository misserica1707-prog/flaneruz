import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Enable CORS and mobile headers so requests from any phone or domain succeed
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Telegram Bot Token - flaner_cosmetics bot
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8580114168:AAEQuUmq5pVHd0B50syGwJ1pS5BGh4XXgVc';
let configuredAdminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

// In-memory log of telegram notifications
interface TelegramLogEntry {
  id: string;
  timestamp: string;
  type: 'order' | 'status' | 'test';
  recipient: string;
  status: 'sent' | 'failed';
  error?: string;
  textSnippet: string;
}
const telegramLogs: TelegramLogEntry[] = [];

// Helper function to send message via Telegram Bot API
async function sendTelegramMessage(chatId: string | number, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML') {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('Telegram Bot Token is not configured');
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    })
  });

  const data = await response.json() as { ok: boolean; description?: string; result?: unknown };
  if (!data.ok) {
    throw new Error(data.description || 'Failed to send Telegram message');
  }

  return data.result;
}

// ======================== API ROUTES ========================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'flaner_cosmetics' });
});

// Check Telegram Bot connection status and get bot profile
app.get('/api/telegram/status', async (req, res) => {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
    const response = await fetch(url);
    const data = await response.json() as { ok: boolean; result?: { id: number; username: string; first_name: string } };

    if (data.ok && data.result) {
      res.json({
        connected: true,
        bot: {
          id: data.result.id,
          username: data.result.username,
          firstName: data.result.first_name,
          link: `https://t.me/${data.result.username}`
        },
        adminChatConfigured: !!configuredAdminChatId,
        adminChatId: configuredAdminChatId
      });
    } else {
      res.status(502).json({
        connected: false,
        error: 'Telegram API returned unsuccessful status'
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ connected: false, error: message });
  }
});

// Get recent updates (helps admin discover their Chat ID after messaging the bot)
app.get('/api/telegram/updates', async (req, res) => {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=10`;
    const response = await fetch(url);
    const data = await response.json() as { ok: boolean; result?: Array<{ message?: { from?: { id: number; first_name?: string; username?: string }; text?: string; chat?: { id: number; title?: string; type?: string } } }> };

    if (data.ok && Array.isArray(data.result)) {
      const recentUsers = data.result
        .filter(u => u.message && u.message.chat)
        .map(u => ({
          chatId: u.message!.chat!.id,
          type: u.message!.chat!.type,
          name: u.message!.from?.first_name || u.message!.chat?.title || 'Unknown',
          username: u.message!.from?.username ? `@${u.message!.from.username}` : undefined,
          lastText: u.message!.text
        }));

      res.json({ ok: true, success: true, users: recentUsers, recentUsers });
    } else {
      res.json({ ok: true, success: true, users: [], recentUsers: [] });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, success: false, error: message });
  }
});

// Get / Set Admin Chat ID
app.get('/api/telegram/admin-chat', (req, res) => {
  res.json({ success: true, adminChatId: configuredAdminChatId });
});

app.post('/api/telegram/admin-chat', (req, res) => {
  const targetId = req.body.adminChatId !== undefined ? req.body.adminChatId : req.body.chatId;
  if (typeof targetId === 'string' || typeof targetId === 'number') {
    configuredAdminChatId = String(targetId).trim();
    res.json({ success: true, adminChatId: configuredAdminChatId });
  } else {
    res.status(400).json({ success: false, error: 'Invalid chat ID' });
  }
});

// Send new order alert to Telegram
app.post('/api/telegram/send-order', async (req, res) => {
  try {
    const { order, customerChatId } = req.body;
    if (!order || !order.orderNumber) {
      return res.status(400).json({ error: 'Order data is required' });
    }

    const deliveryMap: Record<string, string> = {
      courier: 'Курьерская доставка (Узбекистан, г. Ташкент)',
      express: 'Срочный экспресс (за 2 часа)',
      pickup: 'Самовывоз из бутика flaner_cosmetics (Узбекистан, г. Ташкент)'
    };

    const paymentMap: Record<string, string> = {
      card_online: '💳 Онлайн-перевод на карту 9860 1701 2205 1080 (Humo)',
      telegram_payments: 'Telegram Payments (Stars/Карты)',
      telegram: 'Telegram Payments (Stars/Карты)',
      payme: 'Payme (Uzcard / Humo)',
      click: 'Click Evolution',
      stripe: 'Stripe (Visa/Mastercard)',
      cash_on_delivery: 'Оплата при получении курьеру',
      cash: 'Оплата при получении'
    };

    const itemsList = (order.items || [])
      .map((item: { brand: string; productName: string; volume?: string; quantity: number; price: number }) =>
        `• <b>${item.brand}</b> — ${item.productName} (${item.volume || ''})\n  <i>${item.quantity} шт. × ${item.price.toLocaleString()} UZS</i>`
      )
      .join('\n');

    const messageHtml = `✨ <b>НОВЫЙ ЗАКАЗ В FLANER COSMETICS</b> ✨\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📦 <b>Номер заказа:</b> <code>${order.orderNumber}</code>\n` +
      `📅 <b>Дата:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
      `👤 <b>Покупатель:</b> ${order.customer.fullName}\n` +
      `📞 <b>Телефон:</b> ${order.customer.phone}\n` +
      `💬 <b>Telegram:</b> ${order.customer.telegramUsername || 'Не указан'}\n` +
      `📍 <b>Адрес:</b> ${order.customer.city || ''}, ${order.customer.address || ''}\n` +
      `🚚 <b>Доставка:</b> ${deliveryMap[order.customer.deliveryType] || order.customer.deliveryType} ${order.deliveryFee === 0 ? '(Бесплатно, заказ от 2 млн сум)' : `(${Number(order.deliveryFee || 0).toLocaleString()} UZS)`}\n` +
      (order.customer.comment ? `📝 <b>Комментарий:</b> ${order.customer.comment}\n` : '') +
      `💳 <b>Оплата:</b> ${paymentMap[order.paymentMethod] || order.paymentMethod} (Статус: <b>${order.paymentStatus === 'paid' ? '✅ Оплачено' : '⏳ Ожидает оплаты'}</b>)\n` +
      (order.promoCode ? `🏷 <b>Промокод:</b> ${order.promoCode}\n` : '') +
      `\n🛍 <b>Содержимое заказа:</b>\n${itemsList}\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `💰 <b>ИТОГО К ОПЛАТЕ:</b> <b>${order.total.toLocaleString()} UZS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>Отправлено через бота @flaneruz_bot</i>`;

    const recipientsSent: string[] = [];
    let lastError: string | undefined;

    // Send to Admin Chat if set
    if (configuredAdminChatId) {
      try {
        await sendTelegramMessage(configuredAdminChatId, messageHtml);
        recipientsSent.push(`admin (${configuredAdminChatId})`);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : 'Failed to send to admin';
        console.error('Failed to send order to admin chat:', err);
      }
    }

    // Send confirmation to customer if customerChatId is provided (e.g. from Telegram Web App)
    if (customerChatId && String(customerChatId) !== String(configuredAdminChatId)) {
      try {
        const customerMsg = `🌸 <b>Спасибо за заказ в flaner_cosmetics!</b> 🌸\n\n` +
          `Ваш заказ <b>#${order.orderNumber}</b> успешно принят в обработку.\n` +
          `Сумма заказа: <b>${order.total.toLocaleString()} UZS</b>\n` +
          `Способ получения: <b>${deliveryMap[order.customer.deliveryType] || 'Доставка'}</b>\n\n` +
          `Наш менеджер свяжется с вами для подтверждения доставки.\n` +
          `Если у вас возникнут вопросы, напишите в этот чат!`;

        await sendTelegramMessage(customerChatId, customerMsg);
        recipientsSent.push(`customer (${customerChatId})`);
      } catch (err) {
        console.error('Failed to send order to customer chat:', err);
      }
    }

    // Log the notification
    telegramLogs.unshift({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'order',
      recipient: recipientsSent.join(', ') || (configuredAdminChatId ? configuredAdminChatId : 'None (No chat ID)'),
      status: recipientsSent.length > 0 ? 'sent' : 'failed',
      error: recipientsSent.length === 0 ? (lastError || 'No admin chat ID configured') : undefined,
      textSnippet: `Заказ #${order.orderNumber} (${order.total} UZS)`
    });

    res.json({
      success: true,
      recipientsSent,
      adminConfigured: !!configuredAdminChatId,
      error: recipientsSent.length === 0 ? (lastError || 'Admin chat ID is not configured yet. Set it in the Bot tab of Admin Panel.') : undefined
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Send order status update notification to customer / admin
app.post('/api/telegram/send-status-update', async (req, res) => {
  try {
    const { orderNumber, customerName, newStatus, chatId, phone } = req.body;
    const targetChat = chatId || configuredAdminChatId;

    if (!targetChat) {
      return res.status(400).json({
        success: false,
        error: 'No target Chat ID provided or configured. Please enter a Chat ID.'
      });
    }

    const message = `🔔 <b>flaner_cosmetics | Обновление статуса заказа #${orderNumber}</b>\n\n` +
      `Здравствуйте, <b>${customerName || 'Покупатель'}</b>!\n` +
      `Статус вашего заказа изменился на: <b>«${newStatus}»</b>.\n\n` +
      (phone ? `📞 Контактный номер: ${phone}\n` : '') +
      `Благодарим за выбор бутика flaner_cosmetics!\n` +
      `🤖 @flaneruz_bot`;

    await sendTelegramMessage(targetChat, message);

    telegramLogs.unshift({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'status',
      recipient: String(targetChat),
      status: 'sent',
      textSnippet: `Статус заказа #${orderNumber}: ${newStatus}`
    });

    res.json({ success: true, targetChat });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Test message sender
app.post('/api/telegram/test-message', async (req, res) => {
  try {
    const { chatId, message } = req.body;
    const target = chatId || configuredAdminChatId;

    if (!target) {
      return res.status(400).json({
        success: false,
        error: 'Пожалуйста, укажите Chat ID (или ID пользователя Telegram) для отправки теста.'
      });
    }

    const textToSend = message || `✨ <b>Тестовое сообщение от бота @flaneruz_bot</b>\n\n` +
      `Интеграция сайта <b>flaner_cosmetics</b> с Telegram Bot API работает исправно!\n` +
      `Время отправки: ${new Date().toLocaleTimeString('ru-RU')}`;

    await sendTelegramMessage(target, textToSend);

    telegramLogs.unshift({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'test',
      recipient: String(target),
      status: 'sent',
      textSnippet: 'Тестовое сообщение'
    });

    res.json({ success: true, recipient: target });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Get telegram notification logs
app.get('/api/telegram/logs', (req, res) => {
  res.json({ logs: telegramLogs.slice(0, 20) });
});

// ======================== SERVER & VITE SETUP ========================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`flaner_cosmetics server running on http://localhost:${PORT}`);
    console.log(`Telegram Bot @flaneruz_bot active (Token: ${TELEGRAM_BOT_TOKEN.slice(0, 10)}...)`);
  });
}

startServer();
