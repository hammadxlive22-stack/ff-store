const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

// Helper: Sanitize customer name to prevent FamGateway SQL 500 crash
function sanitizeName(name) {
  if (!name) return 'Customer';
  const clean = String(name).replace(/[^\w\s]/gi, '').trim();
  return clean.length > 0 ? clean : 'Customer';
}

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    // 1. Instant Callback Answer
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Invalid plan.');

      // 2. Database Order Creation
      const order = await prisma.order.create({
        data: {
          userId: BigInt(ctx.from.id),
          productId: plan.productId,
          planId: plan.id,
          amount: plan.price,
        },
      });

      // Safe clean name for Gateway API
      const safeCustomerName = sanitizeName(ctx.from.first_name);

      // Unique short order ID string safe for FamGateway DB
      const gatewayOrderId = `ORD_${order.id.replace(/-/g, '').slice(0, 12)}_${Date.now().toString().slice(-4)}`;

      // 3. FamGateway Integration Call
      const famResponse = await famgateway.createPayment({
        amount: Number(plan.price),
        orderId: gatewayOrderId,
        customerName: safeCustomerName,
      });

      if (!famResponse.success) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED', paymentStatus: 'FAILED' },
        });
        return ctx.reply(`❌ Payment creation failed: ${famResponse.error || 'Gateway Error'}`);
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

      // 4. Send Payment Details Message
      const textMsg = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 <b>Product:</b> ${plan.product.name}\n⏱️ <b>Plan:</b> ${plan.durationLabel}\n💰 <b>Amount:</b> ₹${plan.price}\n🧾 <b>Order ID:</b> <code>${order.id.slice(0, 8)}</code>\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.payment_url || famResponse.qr_text)],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      await ctx.replyWithHTML(textMsg, buttons);

      // 5. Send QR Code Instantly
      const qrImageUrl = famResponse.qr_image || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(famResponse.qr_text)}`;
      
      await ctx.replyWithPhoto(qrImageUrl, { caption: '👇 Scan this QR to pay' }).catch(async (err) => {
        logger.warn('Direct QR URL failed, sending text link backup', err);
      });

    } catch (error) {
      logger.error('Payment creation error:', error);
      ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
    }
  });

  // ✅ Verification Flow
  bot.action(/^paid_(.+)$/, async (ctx) => {
    ctx.answerCbQuery('⏳ Verification checking...').catch(() => {});

    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order || order.user.telegramId !== BigInt(ctx.from.id)) {
        return ctx.reply('❌ Order not found or unauthorized.');
      }

      if (order.paymentStatus === 'SUCCESS') {
        return ctx.reply('✅ Payment already verified.');
      }

      if (['CANCELLED', 'EXPIRED'].includes(order.status)) {
        return ctx.reply('❌ Order is no longer active.');
      }

      if (!order.payment || !order.payment.famgatewayOrderId) {
        return ctx.reply('❌ Payment session info missing. Please recreate order.');
      }

      const verification = await famgateway.verifyPayment(order.payment.famgatewayOrderId);

      if (verification.status === 'SUCCESS') {
        await prisma.$transaction([
          prisma.payment.update({
            where: { orderId: orderId },
            data: { status: 'SUCCESS', verifiedAt: new Date() },
          }),
          prisma.order.update({
            where: { id: orderId },
            data: { paymentStatus: 'SUCCESS', status: 'PAYMENT_VERIFIED' },
          }),
        ]);

        // Notify Admins
        const admins = await prisma.admin.findMany({
          where: { isSuperadmin: true, isActive: true, telegramId: { not: null } },
        });

        const adminMsg = `🔔 <b>NEW PAID ORDER</b>\n\n👤 User: ${order.user.firstName}\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0, 8)}</code>`;
        const adminButtons = Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approve', `approve_${order.id}`), Markup.button.callback('❌ Reject', `reject_${order.id}`)],
        ]);

        for (const admin of admins) {
          await bot.telegram.sendMessage(admin.telegramId.toString(), adminMsg, {
            parse_mode: 'HTML',
            ...adminButtons,
          }).catch((err) => logger.error('Admin notify error:', err));
        }

        await ctx.reply('✅ Payment received successfully!\n👨‍💼 Sent to admin for approval.');
      } else if (verification.status === 'PENDING') {
        await ctx.reply('⏳ Payment is still pending. Please wait.');
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'EXPIRED', paymentStatus: 'FAILED' },
        });
        await ctx.reply('❌ Payment was not detected. Please try again.');
      }
    } catch (error) {
      logger.error('Payment verification error:', error);
      ctx.reply('❌ Verification error. Try again.').catch(() => {});
    }
  });

  // ❌ Order Cancellation
  bot.action(/^cancel_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== BigInt(ctx.from.id)) {
        return ctx.reply('❌ Order not found.');
      }
      if (order.paymentStatus === 'SUCCESS') {
        return ctx.reply('❌ Cannot cancel paid order.');
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
