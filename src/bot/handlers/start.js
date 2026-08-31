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

      const welcomeText = `'flex' <b>FF STORE</b> 'motion'\n✦━━━━━━━━━━━━━━━━✦\n\n'sigma' Welcome to FF STORE\n'top' Buy authorized digital products\n'dollar' Secure UPI payments\n'stars' Fast payment verification\n'verified' Admin-approved delivery`;

      // Safe inline keyboard mapping using Markup helper to avoid scope/naming reference errors
      const menu = Markup.inlineKeyboard([
        [
          { text: 'Buy Now', callback_data: 'buy_now', icon_custom_emoji_id: '5312361253610475399' }
        ],
        [
          { text: 'Add Balance', callback_data: 'add_balance', icon_custom_emoji_id: '6235459831302460476' },
          { text: 'My Profile', callback_data: 'my_profile', icon_custom_emoji_id: '5317006024517912643' }
        ],
        [
          { text: 'My Orders', callback_data: 'my_orders', icon_custom_emoji_id: '5463071033256848094' }
        ],
        [
          { text: 'Payment History', callback_data: 'payment_history', icon_custom_emoji_id: '5895735846698487922' },
          { text: 'Support', callback_data: 'support', icon_custom_emoji_id: '6235307467337635626' }
        ]
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
