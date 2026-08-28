const { Telegraf } = require('telegraf');
const logger = require('../utils/logger');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Import handlers
const startHandler = require('./handlers/start');
const buyHandler = require('./handlers/buy');
const paymentHandler = require('./handlers/payment');
const adminHandler = require('./handlers/admin');
const profileHandler = require('./handlers/profile');

// Register handlers
startHandler(bot);
buyHandler(bot);
paymentHandler(bot);
adminHandler(bot);
profileHandler(bot);

// Error handling
bot.catch((err, ctx) => {
  logger.error(`Bot error:`, err);
  ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
});

module.exports = bot;
