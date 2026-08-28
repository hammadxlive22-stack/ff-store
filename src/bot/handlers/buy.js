const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const { formatWithCustomEmoji } = require('../../services/emojiService');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action('buy_now', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const products = await prisma.product.findMany({
        where: { isActive: true },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      });

      if (products.length === 0) {
        return ctx.reply('❌ No products available.');
      }

      const buttons = products.map((p) => [Markup.button.callback(p.name, `product_${p.id}`)]);
      await ctx.reply('🛒 Select a product:', Markup.inlineKeyboard(buttons));
    } catch (error) {
      logger.error('Buy handler error:', error);
      await ctx.reply('❌ An error occurred.');
    }
  });

  bot.action(/^product_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const productId = parseInt(ctx.match[1]);
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      });

      if (!product) return ctx.reply('❌ Product not found.');

      const planButtons = product.plans.map((plan) =>
        [Markup.button.callback(`⏱️ ${plan.durationLabel} — ₹${plan.price}`, `plan_${plan.id}`)]
      );
      planButtons.push([Markup.button.callback('🔙 Back', 'buy_now')]);

      await ctx.reply(`📦 ${product.name}\n${product.description || ''}\n\nSelect duration:`, 
        Markup.inlineKeyboard(planButtons));
    } catch (error) {
      logger.error('Product handler error:', error);
      await ctx.reply('❌ An error occurred.');
    }
  });

  bot.action(/^plan_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Plan not found.');

      const text = `🛒 ORDER SUMMARY\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Price: ₹${plan.price}`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback(`💳 Pay ₹${plan.price} via UPI`, `pay_${plan.id}`)],
        [Markup.button.callback('🔙 Back', `product_${plan.product.id}`)],
      ]);

      await ctx.replyWithHTML(text, buttons);
    } catch (error) {
      logger.error('Plan handler error:', error);
      await ctx.reply('❌ An error occurred.');
    }
  });
};