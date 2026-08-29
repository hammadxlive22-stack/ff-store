const prisma = require('./db');
const logger = require('../utils/logger');

let emojiCache = new Map();
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000;

function isValidCustomEmojiId(id) {
  if (!id) return false;
  const strId = String(id).trim();
  return /^\d{15,20}$/.test(strId);
}

async function getEmojiMap() {
  try {
    if (cacheTimestamp && Date.now() - cacheTimestamp < CACHE_DURATION && emojiCache.size > 0) {
      return Object.fromEntries(emojiCache);
    }

    const emojis = await prisma.customEmoji.findMany({
      where: { isActive: true, category: { isActive: true } },
      include: { category: true },
    });

    const emojiMap = getDefaultEmojiMap();

    for (const emoji of emojis) {
      if (emoji.category && emoji.category.key) {
        const key = emoji.category.key.toUpperCase();
        emojiMap[key] = {
          customEmojiId: isValidCustomEmojiId(emoji.emojiId) ? String(emoji.emojiId).trim() : null,
          fallbackEmoji: emoji.fallbackEmoji || emojiMap[key]?.fallbackEmoji || '✨',
        };
      }
    }

    emojiCache = new Map(Object.entries(emojiMap));
    cacheTimestamp = Date.now();
    return emojiMap;
  } catch (error) {
    logger.error('Error fetching emoji map:', error);
    return getDefaultEmojiMap();
  }
}

function getDefaultEmojiMap() {
  return {
    PREMIUM: { customEmojiId: '5350452584119279096', fallbackEmoji: '👑' },
    SECTION: { customEmojiId: '5382194935057372936', fallbackEmoji: '✦' },
    SHOP: { customEmojiId: '5312361253610475399', fallbackEmoji: '🛒' },
    PAYMENT: { customEmojiId: '6203752050556145334', fallbackEmoji: '💳' },
    ORDERS: { customEmojiId: '5258336354642697821', fallbackEmoji: '📦' },
  };
}

async function formatToHTML(text, useCustomEmoji = true) {
  const emojiMap = await getEmojiMap();
  let formattedText = text;

  for (const [_, config] of Object.entries(emojiMap)) {
    const rawId = config.customEmojiId;
    const fallback = config.fallbackEmoji;

    if (!fallback) continue;

    if (useCustomEmoji && isValidCustomEmojiId(rawId)) {
      const customTag = `<tg-emoji custom-emoji-id="${String(rawId).trim()}">${fallback}</tg-emoji>`;
      formattedText = formattedText.split(fallback).join(customTag);
    }
  }

  return formattedText;
}

function clearEmojiCache() {
  emojiCache.clear();
  cacheTimestamp = null;
  logger.info('Emoji cache cleared');
}

module.exports = {
  getEmojiMap,
  getDefaultEmojiMap,
  formatToHTML,
  clearEmojiCache,
};
