const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  // 💳 Payment create action
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    // ✅ Callback query को तुरंत answer करें (await न करें)
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
        return ctx.reply('❌ Payment creation failed. Please try again.');
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

      const paymentText = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Amount: ₹${plan.price}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\n👇 <b>Scan QR to pay</b>`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.payment_url || famResponse.qr_text)],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      // ✅ QR image सीधे URL से भेजें
      if (famResponse.qr_image) {
  try {
    await ctx.replyWithPhoto(
      { url: famResponse.qr_image },   // ✅ Telegram खुद image fetch करेगा
      {
        caption: paymentText,
        parse_mode: 'HTML',
        ...buttons,
      }
    );
  } catch (photoError) {
    logger.error('QR photo send failed, fallback to UPI link:', photoError.message);
    await ctx.replyWithHTML(
      paymentText + `\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`,
      buttons
    );
  }
} else {
  await ctx.replyWithHTML(
    paymentText + `\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`,
    buttons
  );
}
  // ✅ I Have Paid – verification (with mock support)
  bot.action(/^paid_(.+)$/, async (ctx) => {
    // तुरंत answer करें
    ctx.answerCbQuery('⏳ Verifying...').catch(() => {});

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

      let verification;
      if (process.env.MOCK_PAYMENT === 'true') {
        logger.warn('MOCK_PAYMENT mode enabled - returning SUCCESS');
        verification = { status: 'SUCCESS' };
      } else {
        verification = await famgateway.verifyPayment(order.payment.famgatewayOrderId);
      }

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
      ctx.answerCbQuery('❌ Error. Try again.').catch(() => {});
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
