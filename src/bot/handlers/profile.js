const prisma = require('../../services/db');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action('my_profile', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
        include: { orders: true },
      });

      if (!user) return ctx.reply('❌ User not found.');

      const totalOrders = user.orders.length;
      const completedOrders = user.orders.filter(o => o.status === 'DELIVERED').length;
      const totalSpent = user.orders
        .filter(o => o.paymentStatus === 'SUCCESS')
        .reduce((sum, o) => sum + parseFloat(o.amount), 0);

      await ctx.replyWithHTML(
        `<tg-emoji emoji-id="5317006024517912643">👤</tg-emoji> <b>PROFILE</b>\n✦━━━━━━━━━━━━━━━━✦\n\n` +
        `Name: ${user.firstName || 'N/A'} ${user.lastName || ''}\n` +
        `Username: @${user.username || 'N/A'}\n` +
        `Telegram ID: ${user.telegramId}\n\n` +
        `<tg-emoji emoji-id="5463071033256848094">📦</tg-emoji> Total Orders: ${totalOrders}\n` +
        `<tg-emoji emoji-id="5312361253610475399">✅</tg-emoji> Completed: ${completedOrders}\n` +
        `<tg-emoji emoji-id="5895735846698487922">💰</tg-emoji> Total Spent: ₹${totalSpent}`
      );
    } catch (error) {
      logger.error('Profile error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });

  bot.action('my_orders', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
        include: { 
          orders: { 
            include: { product: true, plan: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
          } 
        },
      });

      if (!user || user.orders.length === 0) {
        return ctx.reply('📦 No orders yet.');
      }

      const orderList = user.orders.map(o => 
        `<tg-emoji emoji-id="5312361253610475399">🧾</tg-emoji> ${o.product.name} - ${o.plan.durationLabel}\n<tg-emoji emoji-id="5895735846698487922">💰</tg-emoji> ₹${o.amount} | ${o.status}\nID: <code>${o.id.slice(0,8)}</code>`
      ).join('\n\n');
      
      await ctx.replyWithHTML(`<tg-emoji emoji-id="5463071033256848094">📦</tg-emoji> <b>YOUR ORDERS</b>\n\n${orderList}`);
    } catch (error) {
      logger.error('Orders error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });

  bot.action('payment_history', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
        include: { 
          orders: { 
            include: { payment: true, product: true, plan: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
          } 
        },
      });

      if (!user || user.orders.length === 0) {
        return ctx.reply('🧾 No payment history.');
      }

      const payments = user.orders
        .filter(o => o.payment)
        .map(o => 
          `<tg-emoji emoji-id="5895735846698487922">💳</tg-emoji> ${o.product.name}\n₹${o.amount} | ${o.payment.status}\nDate: ${o.createdAt.toISOString().slice(0,10)}`
        ).join('\n\n');
      
      await ctx.replyWithHTML(`<tg-emoji emoji-id="5895735846698487922">🧾</tg-emoji> <b>PAYMENT HISTORY</b>\n\n${payments}`);
    } catch (error) {
      logger.error('History error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });
};
