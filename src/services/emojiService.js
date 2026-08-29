const prisma = require('./db');
const logger = require('../utils/logger');

let emojiCache = new Map();
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// UTF-16 Length Helper (Telegram API Spec)
function getUtf16Length(str) {
  return Array.from(str).reduce((acc, char) => acc + (char.codePointAt(0) > 0xFFFF ? 2 : 1), 0);
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

    // DB Emojis ko override karo (No Data Loss)
    for (const emoji of emojis) {
      if (emoji.category && emoji.category.key) {
        emojiMap[emoji.category.key.toUpperCase()] = {
          customEmojiId: emoji.emojiId,
          fallbackEmoji: emoji.fallbackEmoji || emojiMap[emoji.category.key.toUpperCase()]?.fallbackEmoji || '✨',
          category: emoji.category.key,
          label: emoji.label,
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

/**
 * HTML Mode Helper (Fastest & Easiest Approach)
 */
async function formatToHTML(text, emojiMap = null) {
  if (!emojiMap) emojiMap = await getEmojiMap();

  let formattedText = text;

  for (const [_, config] of Object.entries(emojiMap)) {
    if (!config.customEmojiId || !config.fallbackEmoji) continue;

    const customTag = `<tg-emoji custom-emoji-id="${config.customEmojiId}">${config.fallbackEmoji}</tg-emoji>`;
    // Global replace for fallback emojis
    formattedText = formattedText.split(config.fallbackEmoji).join(customTag);
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
