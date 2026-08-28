const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const { formatWithCustomEmoji } = require('../../services/emojiService');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.start(async (ctx) => {
    try {
      await prisma.user.upsert({
        where: { telegramId: BigInt(ctx.from.id) },
        update: {
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        },
        create: {
          telegramId: BigInt(ctx.from.id),
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        },
      });

      const welcomeText = `👑 FF STORE\n✦━━━━━━━━━━━━━━━━✦\n\n⚡ Welcome to FF STORE\n🛒 Buy authorized digital products\n💳 Secure UPI payments\n⚡ Fast payment verification\n👨‍💼 Admin-approved delivery`;

      const { text, entities } = await formatWithCustomEmoji(welcomeText);

      const menu = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buy Now', 'buy_now')],
        [Markup.button.callback('💰 Add Balance', 'add_balance'), Markup.button.callback('👤 My Profile', 'my_profile')],
        [Markup.button.callback('📦 My Orders', 'my_orders')],
        [Markup.button.callback('🧾 Payment History', 'payment_history'), Markup.button.callback('🆘 Support', 'support')],
      ]);

      await ctx.replyWithHTML(text, {
        ...menu,
        entities: entities.length > 0 ? entities : undefined,
      });
    } catch (error) {
      logger.error('Start handler error:', error);
      await ctx.reply('❌ An error occurred.');
    }
  });

  bot.action('add_balance', async (ctx) => {
    await ctx.answerCbQuery('💰 Coming soon!');
  });

  bot.action('support', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('🆘 Contact: @ff_store_support');
  });
};