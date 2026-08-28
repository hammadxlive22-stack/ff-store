const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const { formatWithCustomEmoji } = require('../../services/emojiService');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Invalid plan.');

      const order = await prisma.order.create({
        data: {
          userId: ctx.from.id,
          productId: plan.productId,
          planId: plan.id,
          amount: plan.price,
        },
      });

      const famResponse = await famgateway.createPayment({
        amount: plan.price,
        orderId: order.id,
        customerName: ctx.from.first_name || 'Customer',
      });

      if (!famResponse.success) {
        await prisma.order.update({ 
          where: { id: order.id }, 
          data: { status: 'FAILED', paymentStatus: 'FAILED' } 
        });
        return ctx.reply('❌ Payment creation failed.');
      }

      await prisma.payment.create({
        data: {
          orderId: order.id,
          famgatewayOrderId: famResponse.fam_order_id,
          amount: plan.price,
          status: 'PENDING',
          paymentData: { qr_text: famResponse.qr_text },
        },
      });

      const paymentScreen = `💳 PAYMENT CREATED\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Amount: ₹${plan.price}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\n🔐 UPI Details:\n<code>${famResponse.qr_text}</code>\n\n⚡ Pay and click "I Have Paid"`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      await ctx.replyWithHTML(paymentScreen, buttons);
    } catch (error) {
      logger.error('Payment creation error:', error);
      await ctx.reply('❌ An error occurred.');
    }
  });

  bot.action(/^paid_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery('⏳ Verifying...');
      
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order || order.user.telegramId !== BigInt(ctx.from.id)) {
        return ctx.answerCbQuery('❌ Order not found.');
      }

      if (order.paymentStatus === 'SUCCESS') {
        return ctx.answerCbQuery('✅ Already verified.');
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
          where: { isSuperadmin: true, isActive: true, telegramId: { not: null } } 
        });

        for (const admin of admins) {
          const adminMsg = `🔔 NEW PAID ORDER\n\n👤 User: ${order.user.firstName}\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\nApprove or reject:`;
          
          const adminButtons = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve_${order.id}`), Markup.button.callback('❌ Reject', `reject_${order.id}`)],
          ]);
          
          await bot.telegram.sendMessage(admin.telegramId.toString(), adminMsg, { 
            parse_mode: 'HTML', 
            ...adminButtons,
          }).catch((err) => logger.error('Admin notify error:', err));
        }

        await ctx.reply('✅ Payment received!\n👨‍💼 Sent to admin for approval.');
      } else if (verification.status === 'PENDING') {
        await ctx.reply('⏳ Payment pending. Please wait.');
      } else {
        await prisma.order.update({ 
          where: { id: orderId }, 
          data: { status: 'EXPIRED', paymentStatus: 'FAILED' } 
        });
        await ctx.reply('❌ Payment not detected. Create new order.');
      }
    } catch (error) {
      logger.error('Payment verification error:', error);
      await ctx.answerCbQuery('❌ Error. Try again.');
    }
  });

  bot.action(/^cancel_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== ctx.from.id) return ctx.answerCbQuery('❌ Not found.');
      if (order.paymentStatus === 'SUCCESS') return ctx.answerCbQuery('❌ Cannot cancel.');

      await prisma.order.update({ 
        where: { id: orderId }, 
        data: { status: 'CANCELLED' } 
      });
      await ctx.reply('❌ Order cancelled.');
    } catch (error) {
      logger.error('Cancel error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });
};