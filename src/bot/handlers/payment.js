const { Markup } = require('telegraf');
const QRCode = require('qrcode');
const axios = require('axios');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

// Helper: एक method को timeout के साथ run करो
async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Invalid plan.');

      const order = await prisma.order.create({
        data: {
          userId: BigInt(ctx.from.id),
          productId: plan.productId,
          planId: plan.id,
          amount: plan.price,
        },
      });

      const famResponse = await famgateway.createPayment({
        amount: Number(plan.price),
        orderId: order.id,
        customerName: ctx.from.first_name || 'Customer',
      });

      if (!famResponse.success) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED', paymentStatus: 'FAILED' },
        });
        return ctx.reply('❌ Payment creation failed.');
      }

      await prisma.payment.create({
        data: {
          orderId: order.id,
          famgatewayOrderId: famResponse.fam_order_id,
          amount: Number(plan.price),
          status: 'PENDING',
          paymentData: {
            qr_text: famResponse.qr_text,
            qr_url: famResponse.qr_image,
          },
        },
      });

      // ✅ Text message तुरंत भेजो (UPI link)
      const paymentText = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Amount: ₹${plan.price}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.payment_url || 'https://famgateway.in')],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      await ctx.replyWithHTML(paymentText, buttons);

      // ✅ अब 10 तरीकों से QR भेजने की कोशिश (हर तरीके को 1 सेकंड)
      const qrText = famResponse.qr_text;
      const qrUrl = famResponse.qr_image;

      const methods = [
        // Method 1: Local QR generate (250px)
        async () => {
          const buf = await QRCode.toBuffer(qrText, { width: 250, margin: 1 });
          await ctx.replyWithPhoto({ source: buf }, { caption: '👇 Scan to pay' });
        },
        // Method 2: Local QR generate (300px)
        async () => {
          const buf = await QRCode.toBuffer(qrText, { width: 300, margin: 2 });
          await ctx.replyWithPhoto({ source: buf }, { caption: '👇 Scan to pay' });
        },
        // Method 3: Send photo from FamGateway QR URL
        async () => {
          await ctx.replyWithPhoto({ url: qrUrl }, { caption: '👇 Scan to pay' });
        },
        // Method 4: Download QR URL and send buffer
        async () => {
          const response = await axios.get(qrUrl, { responseType: 'arraybuffer', timeout: 1000 });
          await ctx.replyWithPhoto({ source: Buffer.from(response.data) }, { caption: '👇 Scan to pay' });
        },
        // Method 5: QR via third-party API (qrserver)
        async () => {
          const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrText)}`;
          await ctx.replyWithPhoto({ url: apiUrl }, { caption: '👇 Scan to pay' });
        },
        // Method 6: QR via third-party API (goqr)
        async () => {
          const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrText)}`;
          const resp = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 1000 });
          await ctx.replyWithPhoto({ source: Buffer.from(resp.data) }, { caption: '👇 Scan to pay' });
        },
        // Method 7: Send as document (PNG file)
        async () => {
          const buf = await QRCode.toBuffer(qrText, { width: 250 });
          await ctx.replyWithDocument({ source: buf, filename: 'qr.png' }, { caption: 'Scan this QR' });
        },
        // Method 8: Send photo with Markdown caption
        async () => {
          const buf = await QRCode.toBuffer(qrText, { width: 250 });
          await ctx.replyWithPhoto({ source: buf }, { caption: '👇 Scan to pay', parse_mode: 'Markdown' });
        },
        // Method 9: Send QR as base64 data URL via photo
        async () => {
          const dataUrl = await QRCode.toDataURL(qrText, { width: 250 });
          const base64Data = dataUrl.split(',')[1];
          await ctx.replyWithPhoto({ source: Buffer.from(base64Data, 'base64') }, { caption: '👇 Scan to pay' });
        },
        // Method 10: Send photo with URL from FamGateway (retry)
        async () => {
          await ctx.replyWithPhoto({ url: qrUrl }, { caption: '👇 Scan to pay', parse_mode: 'HTML' });
        },
      ];

      let sent = false;
      for (const method of methods) {
        if (sent) break;
        try {
          await withTimeout(method(), 1000); // 1 second timeout
          sent = true;
          logger.info('QR sent successfully by a method');
        } catch (err) {
          logger.warn(`QR method failed: ${err.message}`);
          // continue to next method
        }
      }

      if (!sent) {
        logger.warn('All QR methods failed, UPI link already sent');
      }
    } catch (error) {
      logger.error('Payment creation error:', error);
      ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
    }
  });

  // ✅ I Have Paid – verification
  bot.action(/^paid_(.+)$/, async (ctx) => {
    ctx.answerCbQuery('⏳ Checking...').catch(() => {});

    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order || order.user.telegramId !== BigInt(ctx.from.id)) {
        return ctx.answerCbQuery('❌ Order not found.').catch(() => {});
      }

      if (order.paymentStatus === 'SUCCESS') {
        return ctx.answerCbQuery('✅ Payment already verified.').catch(() => {});
      }

      if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
        return ctx.answerCbQuery('❌ Order is no longer active.').catch(() => {});
      }

      const verification = await famgateway.verifyPayment(order.payment.famgatewayOrderId);

      if (verification.status === 'SUCCESS') {
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { orderId: orderId },
            data: { status: 'SUCCESS', verifiedAt: new Date() },
          });
          await tx.order.update({
            where: { id: orderId },
            data: { paymentStatus: 'SUCCESS', status: 'PAYMENT_VERIFIED' },
          });
        });

        const admins = await prisma.admin.findMany({
          where: { isSuperadmin: true, isActive: true, telegramId: { not: null } },
        });

        for (const admin of admins) {
          const adminMsg = `🔔 <b>NEW PAID ORDER</b>\n\n👤 User: ${order.user.firstName}\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\nApprove or reject:`;
          const adminButtons = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve_${order.id}`), Markup.button.callback('❌ Reject', `reject_${order.id}`)],
          ]);
          await bot.telegram.sendMessage(admin.telegramId.toString(), adminMsg, {
            parse_mode: 'HTML',
            ...adminButtons,
          }).catch((err) => logger.error('Admin notify error:', err));
        }

        await ctx.reply('✅ Payment received successfully!\n👨‍💼 Your order has been sent to admin for approval.');
      } else if (verification.status === 'PENDING') {
        await ctx.reply('⏳ Payment is still pending. Please wait.');
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'EXPIRED', paymentStatus: 'FAILED' },
        });
        await ctx.reply('❌ Payment was not detected. Please create a new order.');
      }
    } catch (error) {
      logger.error('Payment verification error:', error);
      ctx.reply('❌ Verification error. Try again.').catch(() => {});
    }
  });

  // ❌ Cancel order
  bot.action(/^cancel_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== BigInt(ctx.from.id)) {
        return ctx.answerCbQuery('❌ Order not found.').catch(() => {});
      }
      if (order.paymentStatus === 'SUCCESS') {
        return ctx.answerCbQuery('❌ Cannot cancel paid order.').catch(() => {});
      }

      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
      await ctx.reply('❌ Order cancelled.');
    } catch (error) {
      logger.error('Cancel error:', error);
      ctx.reply('❌ Error cancelling order.').catch(() => {});
    }
  });
};
