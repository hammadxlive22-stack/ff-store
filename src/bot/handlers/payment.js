const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

// Helper: Sanitize customer name to prevent FamGateway SQL crash
function sanitizeName(name) {
  if (!name) return 'Customer';
  const clean = String(name).replace(/[^\w\s]/gi, '').trim();
  return clean.length > 0 ? clean : 'Customer';
}

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const telegramId = BigInt(ctx.from.id);

      // 1. Fetch or Create User First
      let user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            telegramId,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
          },
        });
      }

      // 2. Fetch Plan
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Invalid plan.');

      const internalOrderId = `ORD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // 3. FIX: Prisma User Relation Connect Syntax
      const order = await prisma.order.create({
        data: {
          orderId: internalOrderId,
          amount: plan.price,
          status: 'PENDING',
          user: { connect: { id: user.id } },   // ✅ Connect relation fixed
          plan: { connect: { id: plan.id } },   // ✅ Connect relation fixed
          product: plan.productId ? { connect: { id: plan.productId } } : undefined,
        },
      });

      const safeCustomerName = sanitizeName(ctx.from.first_name);

      // 4. FamGateway Integration Call
      const famResponse = await famgateway.createPayment({
        amount: Number(plan.price),
        orderId: order.orderId || internalOrderId,
        customerName: safeCustomerName,
      });

      if (!famResponse.success) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });
        return ctx.reply(`❌ Payment creation failed: ${famResponse.error || 'Gateway Error'}`);
      }

      // Save Payment
      await prisma.payment.create({
        data: {
          order: { connect: { id: order.id } },
          famgatewayOrderId: famResponse.fam_order_id,
          amount: Number(plan.price),
          status: 'PENDING',
          paymentData: {
            qr_text: famResponse.qr_text,
            qr_url: famResponse.qr_image,
          },
        },
      });

      // 5. Send Payment Message
      const textMsg = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 <b>Product:</b> ${plan.product.name}\n⏱️ <b>Plan:</b> ${plan.durationLabel}\n💰 <b>Amount:</b> ₹${plan.price}\n🧾 <b>Order ID:</b> <code>${internalOrderId}</code>\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.payment_url || famResponse.qr_text)],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      await ctx.replyWithHTML(textMsg, buttons);

      const qrImageUrl = famResponse.qr_image || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(famResponse.qr_text)}`;
      
      await ctx.replyWithPhoto(qrImageUrl, { caption: '👇 Scan this QR to pay' }).catch(() => {});

    } catch (error) {
      logger.error('Payment creation error:', error);
      ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
    }
  });

  // Verification & Cancel Handlers...
  bot.action(/^paid_(.+)$/, async (ctx) => {
    ctx.answerCbQuery('⏳ Checking...').catch(() => {});
    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order) return ctx.reply('❌ Order not found.');

      if (order.status === 'SUCCESS' || order.paymentStatus === 'SUCCESS') {
        return ctx.reply('✅ Payment already verified.');
      }

      const verification = await famgateway.verifyPayment(order.payment?.famgatewayOrderId);

      if (verification.status === 'SUCCESS') {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'PAYMENT_VERIFIED' },
        });
        await ctx.reply('✅ Payment received successfully!\n👨‍💼 Sent to admin for approval.');
      } else {
        await ctx.reply('⏳ Payment pending or not found yet.');
      }
    } catch (err) {
      logger.error('Verify error:', err);
      ctx.reply('❌ Error verifying payment.').catch(() => {});
    }
  });

  bot.action(/^cancel_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    try {
      const orderId = ctx.match[1];
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
      await ctx.reply('❌ Order cancelled.');
    } catch (err) {
      ctx.reply('❌ Error cancelling.').catch(() => {});
    }
  });
};
