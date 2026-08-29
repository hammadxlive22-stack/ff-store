const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const { formatToHTML } = require('../../services/emojiService');
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

      const welcomeText = `👑 <b>FF STORE</b>\n✦━━━━━━━━━━━━━━━━✦\n\n⚡ Welcome to FF STORE\n🛒 Buy authorized digital products\n💳 Secure UPI payments\n⚡ Fast payment verification\n👨‍💼 Admin-approved delivery`;

      const menu = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buy Now', 'buy_now')],
        [Markup.button.callback('💰 Add Balance', 'add_balance'), Markup.button.callback('👤 My Profile', 'my_profile')],
        [Markup.button.callback('📦 My Orders', 'my_orders')],
        [Markup.button.callback('🧾 Payment History', 'payment_history'), Markup.button.callback('🆘 Support', 'support')],
      ]);

      // Step 1: Try with Custom Animated Emojis
      try {
        const customHtml = await formatToHTML(welcomeText, true);
        await ctx.replyWithHTML(customHtml, menu);
      } catch (telegramError) {
        // Step 2: Fallback if IDs are invalid on Telegram's side
        logger.warn('Custom Emoji failed, falling back to standard HTML:', telegramError.message);
        const plainHtml = await formatToHTML(welcomeText, false);
        await ctx.replyWithHTML(plainHtml, menu);
      }

    } catch (error) {
      logger.error('Start handler error:', error);
      await ctx.reply('❌ An error occurred.');
    }
  });
};
