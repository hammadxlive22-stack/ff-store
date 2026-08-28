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

// Trust proxy for Render
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
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

// Rate limiting
app.use('/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin/views'));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'FF STORE' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ✅ /admin redirect
app.get('/admin', (req, res) => {
  if (req.session.adminId) {
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/admin/login');
  }
});

// Admin routes
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

    // TODO: Verify webhook signature/secret if FamGateway provides one
    // e.g., compare with process.env.FAMGATEWAY_WEBHOOK_SECRET

    // Extract necessary fields (adjust as per actual webhook payload)
    const { fam_order_id, status, order_id } = payload;

    if (!fam_order_id || !status) {
      logger.error('Invalid webhook payload');
      return res.status(400).send('Bad Request');
    }

    // Find payment by famgateway_order_id
    const payment = await prisma.payment.findUnique({
      where: { famgatewayOrderId: fam_order_id },
      include: { order: true },
    });

    if (!payment) {
      logger.error(`Payment not found for fam_order_id: ${fam_order_id}`);
      return res.status(404).send('Not Found');
    }

    // Map status to our internal status
    let paymentStatus, orderStatus;
    switch (status) {
      case 'SUCCESS':
      case 'COMPLETED':
        paymentStatus = 'SUCCESS';
        orderStatus = 'PAYMENT_VERIFIED';
        break;
      case 'PENDING':
        paymentStatus = 'PENDING';
        orderStatus = 'PENDING';
        break;
      case 'FAILED':
        paymentStatus = 'FAILED';
        orderStatus = 'EXPIRED'; // or FAILED
        break;
      case 'EXPIRED':
        paymentStatus = 'EXPIRED';
        orderStatus = 'EXPIRED';
        break;
      default:
        paymentStatus = 'PENDING';
        orderStatus = 'PENDING';
    }

    // Update payment & order (idempotent, only if not already processed)
    await prisma.$transaction(async (tx) => {
      // Only update if not already the same status
      if (payment.status !== paymentStatus || payment.order.status !== orderStatus) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: paymentStatus, verifiedAt: paymentStatus === 'SUCCESS' ? new Date() : null },
        });

        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus, status: orderStatus },
        });
      }
    });

    // If payment successful, notify admins (same as in bot handler)
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
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook processing error:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// Start bot (long polling for Render free)
bot.launch().catch((err) => {
  logger.error('Bot launch failed:', err);
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 FF STORE running on port ${PORT}`);
  logger.info(`📊 Admin: http://localhost:${PORT}/admin`);
});
