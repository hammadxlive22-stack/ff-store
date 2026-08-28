const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action(/^approve_(.+)$/, async (ctx) => {
    try {
      const admin = await prisma.admin.findUnique({ 
        where: { telegramId: BigInt(ctx.from.id) } 
      });

      if (!admin) return ctx.answerCbQuery('❌ Unauthorized.');

      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order) return ctx.answerCbQuery('Order not found.');
      if (order.paymentStatus !== 'SUCCESS') return ctx.answerCbQuery('❌ Not verified.');

      ctx.session = ctx.session || {};
      ctx.session.awaitingKeyForOrder = orderId;
      
      await ctx.reply(`🔐 Enter key to deliver:\n(Order: ${orderId.slice(0,8)})`);
    } catch (error) {
      logger.error('Approve error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });

  bot.action(/^reject_(.+)$/, async (ctx) => {
    try {
      const admin = await prisma.admin.findUnique({ 
        where: { telegramId: BigInt(ctx.from.id) } 
      });

      if (!admin) return ctx.answerCbQuery('❌ Unauthorized.');

      const orderId = ctx.match[1];
      await prisma.order.update({ 
        where: { id: orderId }, 
        data: { status: 'REJECTED', approvalStatus: 'REJECTED' } 
      });
      
      await ctx.reply('❌ Order rejected.');
      
      await prisma.auditLog.create({
        data: { adminId: admin.id, action: 'REJECT_ORDER', details: { orderId } },
      });
    } catch (error) {
      logger.error('Reject error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });

  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.session && ctx.session.awaitingKeyForOrder) {
        const admin = await prisma.admin.findUnique({ 
          where: { telegramId: BigInt(ctx.from.id) } 
        });

        if (!admin) return next();

        const orderId = ctx.session.awaitingKeyForOrder;
        delete ctx.session.awaitingKeyForOrder;

        const keyContent = ctx.message.text.trim();

        await prisma.$transaction(async (tx) => {
          await tx.delivery.create({
            data: { orderId: orderId, keyContent: keyContent },
          });
          await tx.order.update({
            where: { id: orderId },
            data: { 
              approvalStatus: 'APPROVED', 
              deliveryStatus: 'DELIVERED', 
              status: 'DELIVERED' 
            },
          });
        });

        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { user: true, product: true, plan: true },
        });

        await bot.telegram.sendMessage(
          order.user.telegramId.toString(),
          `🎉 ORDER APPROVED\n\n✅ Payment Verified\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n\n🔐 Your Key:\n<code>${keyContent}</code>\n\n⚠️ Keep your key private.\n\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>`,
          { parse_mode: 'HTML' }
        );

        await ctx.reply('✅ Key delivered.');
        
        await prisma.auditLog.create({
          data: { adminId: admin.id, action: 'APPROVE_AND_DELIVER', details: { orderId } },
        });
      } else {
        return next();
      }
    } catch (error) {
      logger.error('Key delivery error:', error);
      await ctx.reply('❌ Error delivering key.');
    }
  });
};