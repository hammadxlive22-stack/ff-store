const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action('buy_now', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const products = await prisma.product.findMany({
        where: { isActive: true },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      });

      if (products.length === 0) {
        return ctx.reply('❌ No products available.');
      }

      // 🔘 Product selection inline buttons mapped with custom emoji ID
      const inlineKeyboard = products.map((p) => [
        {
          text: p.name,
          callback_data: `product_${p.id}`,
          icon_custom_emoji_id: '5312361253610475399' // cart/product icon
        }
      ]);

      await ctx.reply('🛒 Select a product:', { reply_markup: { inline_keyboard } });
    } catch (error) {
      logger.error('Buy handler error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });

  bot.action(/^product_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const productId = parseInt(ctx.match[1]);
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      });

      if (!product) return ctx.reply('❌ Product not found.');

      // 🔘 Plan duration selection buttons mapped with clock icon & Back button
      const inlineKeyboard = product.plans.map((plan) => [
        {
          text: `${plan.durationLabel} — ₹${plan.price}`,
          callback_data: `plan_${plan.id}`,
          icon_custom_emoji_id: '5463071033256848094' // clock/duration icon
        }
      ]);
      
      inlineKeyboard.push([
        {
          text: 'Back',
          callback_data: 'buy_now',
          icon_custom_emoji_id: '5971867376130461576' // back arrow icon
        }
      ]);

      await ctx.reply(`📦 ${product.name}\n${product.description || ''}\n\nSelect duration:`, {
        reply_markup: { inline_keyboard }
      });
    } catch (error) {
      logger.error('Product handler error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });

  bot.action(/^plan_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Plan not found.');

      const text = `🛒 ORDER SUMMARY\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Price: ₹${plan.price}`;

      // 🔘 Order summary buttons configured with payment and back custom emoji IDs
      const inlineKeyboard = [
        [
          {
            text: `Pay ₹${plan.price} via UPI`,
            callback_data: `pay_${plan.id}`,
            icon_custom_emoji_id: '5895735846698487922' // payment / link icon
          }
        ],
        [
          {
            text: 'Back',
            callback_data: `product_${plan.product.id}`,
            icon_custom_emoji_id: '5971867376130461576' // back arrow icon
          }
        ]
      ];

      await ctx.replyWithHTML(text, { reply_markup: { inline_keyboard } });
    } catch (error) {
      logger.error('Plan handler error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });
};
