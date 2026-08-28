const prisma = require('./db');
const logger = require('../utils/logger');

let emojiCache = new Map();
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getEmojiMap() {
  try {
    if (cacheTimestamp && Date.now() - cacheTimestamp < CACHE_DURATION) {
      return Object.fromEntries(emojiCache);
    }

    const emojis = await prisma.customEmoji.findMany({
      where: { isActive: true, category: { isActive: true } },
      include: { category: true },
    });

    const emojiMap = {};
    for (const emoji of emojis) {
      emojiMap[emoji.category.key] = {
        customEmojiId: emoji.emojiId,
        fallbackEmoji: emoji.fallbackEmoji,
        category: emoji.category.key,
        label: emoji.label,
      };
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
    PROFILE: { customEmojiId: null, fallbackEmoji: '👤' },
    HISTORY: { customEmojiId: null, fallbackEmoji: '🧾' },
    BALANCE: { customEmojiId: null, fallbackEmoji: '💰' },
    SUCCESS: { customEmojiId: null, fallbackEmoji: '✅' },
    FAILED: { customEmojiId: null, fallbackEmoji: '❌' },
    PENDING: { customEmojiId: null, fallbackEmoji: '⏳' },
    SECURE: { customEmojiId: null, fallbackEmoji: '🔐' },
    SECURITY: { customEmojiId: null, fallbackEmoji: '🛡️' },
    FAST: { customEmojiId: null, fallbackEmoji: '⚡' },
    SUPPORT: { customEmojiId: null, fallbackEmoji: '🆘' },
    ARROW: { customEmojiId: null, fallbackEmoji: '➜' },
  };
}

async function formatWithCustomEmoji(text, emojiMap = null) {
  if (!emojiMap) {
    emojiMap = await getEmojiMap();
  }

  const entities = [];

  for (const [category, config] of Object.entries(emojiMap)) {
    if (!config.customEmojiId) continue;

    const fallbackEmoji = config.fallbackEmoji;
    let searchIndex = 0;

    while (true) {
      const index = text.indexOf(fallbackEmoji, searchIndex);
      if (index === -1) break;

      entities.push({
        type: 'custom_emoji',
        offset: index,
        length: fallbackEmoji.length,
        custom_emoji_id: config.customEmojiId,
      });

      searchIndex = index + fallbackEmoji.length;
    }
  }

  return { text, entities };
}

function clearEmojiCache() {
  emojiCache.clear();
  cacheTimestamp = null;
  logger.info('Emoji cache cleared');
}

module.exports = {
  getEmojiMap,
  getDefaultEmojiMap,
  formatWithCustomEmoji,
  clearEmojiCache,
};