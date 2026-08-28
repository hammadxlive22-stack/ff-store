require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bot = require('./bot');
const prisma = require('./services/db');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ff-store-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use('/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin/views'));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'FF STORE' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/admin', (req, res) => {
  if (req.session.adminId) {
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/admin/login');
  }
});

app.use('/admin', require('./admin/routes/auth'));
app.use('/admin', require('./admin/routes/dashboard'));
app.use('/admin', require('./admin/routes/products'));
app.use('/admin', require('./admin/routes/orders'));
app.use('/admin', require('./admin/routes/emojis'));

// ✅ FamGateway Payment Webhook
app.post('/payment/webhook', async (req, res) => {
  try {
    const payload = req.body;
    logger.info('FamGateway webhook received:', payload);

    const gatewayOrderId = payload.order_id || payload.gateway_order_id || payload.fam_order_id;
    const status = (payload.status || '').toLowerCase();

    if (!gatewayOrderId || !status) {
      logger.error('Invalid webhook payload');
      return res.status(200).send('OK');
    }

    const payment = await prisma.payment.findUnique({
      where: { famgatewayOrderId: gatewayOrderId },
      include: { order: true },
    });

    if (!payment) {
      logger.error(`Payment not found for gateway order_id: ${gatewayOrderId}`);
      return res.status(200).send('OK');
    }

    let paymentStatus, orderStatus;
    switch (status) {
      case 'success':
      case 'completed':
      case 'paid':
        paymentStatus = 'SUCCESS';
        orderStatus = 'PAYMENT_VERIFIED';
        break;
      case 'pending':
        paymentStatus = 'PENDING';
        orderStatus = 'PENDING';
        break;
      case 'failed':
        paymentStatus = 'FAILED';
        orderStatus = 'EXPIRED';
        break;
      case 'expired':
        paymentStatus = 'EXPIRED';
        orderStatus = 'EXPIRED';
        break;
      default:
        paymentStatus = 'PENDING';
        orderStatus = 'PENDING';
    }

    if (payment.status !== paymentStatus || payment.order.status !== orderStatus) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: paymentStatus, verifiedAt: paymentStatus === 'SUCCESS' ? new Date() : null },
        });
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus, status: orderStatus },
        });
      });

      if (paymentStatus === 'SUCCESS') {
        const order = await prisma.order.findUnique({
          where: { id: payment.orderId },
          include: { user: true, product: true, plan: true },
        });

        if (order && order.status === 'PAYMENT_VERIFIED') {
          const admins = await prisma.admin.findMany({
            where: { isSuperadmin: true, isActive: true, telegramId: { not: null } },
          });

          for (const admin of admins) {
            const adminMsg = `🔔 NEW PAID ORDER (Webhook)\n\n👤 User: ${order.user.firstName}\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\nApprove or reject:`;
            const adminButtons = {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Approve', callback_data: `approve_${order.id}` },
                    { text: '❌ Reject', callback_data: `reject_${order.id}` },
                  ],
                ],
              },
            };
            await bot.telegram.sendMessage(admin.telegramId.toString(), adminMsg, {
              parse_mode: 'HTML',
              ...adminButtons,
            }).catch((err) => logger.error('Webhook admin notify error:', err));
          }

          // ✅ User को भी notify करो
          await bot.telegram.sendMessage(
            order.user.telegramId.toString(),
            `✅ <b>Payment Confirmed!</b>\n\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\n👨‍💼 Sent to admin for approval.`,
            { parse_mode: 'HTML' }
          ).catch((err) => logger.error('Webhook user notify error:', err));
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook processing error:', error);
    return res.status(200).send('OK');
  }
});

// Start bot
bot.launch().catch((err) => {
  logger.error('Bot launch failed:', err);
});

app.listen(PORT, () => {
  logger.info(`🚀 FF STORE running on port ${PORT}`);
  logger.info(`📊 Admin: http://localhost:${PORT}/admin`);
});
