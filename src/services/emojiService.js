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

function getDefaultEmojiMap() {
  return {
    // Latest Custom Emoji IDs:
    help: { customEmojiId: '5436113877181941026', fallbackEmoji: '❓' },
    balance: { customEmojiId: '5278467510604160626', fallbackEmoji: '💰' },
    profile: { customEmojiId: '5317006024517912643', fallbackEmoji: '👤' },
    cart: { customEmojiId: '5312361253610475399', fallbackEmoji: '🛒' },
    down: { customEmojiId: '5971867376130461576', fallbackEmoji: '🔻' },
    up: { customEmojiId: '5971972727383264364', fallbackEmoji: '🔺' },
    bullet: { customEmojiId: '5971816626796892111', fallbackEmoji: '🔹' },
    announcement: { customEmojiId: '6242353099193718277', fallbackEmoji: '📣' },
    
    // Fresh Working IDs:
    verified: { customEmojiId: '6147524086768604985', fallbackEmoji: '💎' },
    dollar: { customEmojiId: '6235445786759402354', fallbackEmoji: '💸' },
    money: { customEmojiId: '6235459831302460476', fallbackEmoji: '💰' },
    crown: { customEmojiId: '6235252066554484059', fallbackEmoji: '👑' },
    motion: { customEmojiId: '6235259956409408282', fallbackEmoji: '☄️' },
    top: { customEmojiId: '6235307467337635626', fallbackEmoji: '⏩' },
    done: { customEmojiId: '6147460667281511517', fallbackEmoji: '✔️' },
    party: { customEmojiId: '6242319667168287353', fallbackEmoji: '🎉' },

    // Core Styles & Extra IDs:
    flex: { customEmojiId: '6147464060305676048', fallbackEmoji: '😎' },
    sigma: { customEmojiId: '6235620067942341623', fallbackEmoji: '🥃' },
    stars: { customEmojiId: '6235403472741603087', fallbackEmoji: '⭐' },
    frozen: { customEmojiId: '5449449325434266744', fallbackEmoji: '❄️' },
    crying: { customEmojiId: '6273840152980755328', fallbackEmoji: '😭' },
    smiling: { customEmojiId: '6276057176444246654', fallbackEmoji: '🙂' },
    seeing_up: { customEmojiId: '6273997026661241933', fallbackEmoji: '😋' },
    teeth: { customEmojiId: '6273726078649372769', fallbackEmoji: '😁' },
    blue_badge: { customEmojiId: '5978776771623914876', fallbackEmoji: '🟫' },
    black_badge: { customEmojiId: '5978686323907628843', fallbackEmoji: '🔸' },
    busy_tag: { customEmojiId: '5852873584912896283', fallbackEmoji: '🟧' },
    instagram: { customEmojiId: '5895297528106061174', fallbackEmoji: '🌐' },
    telegram: { customEmojiId: '5895735846698487922', fallbackEmoji: '🌐' },
    whatsapp: { customEmojiId: '5895343514320899727', fallbackEmoji: '🌐' },
    india: { customEmojiId: '5913754823643107921', fallbackEmoji: '🇮🇳' },
    bro: { customEmojiId: '5463256910851546817', fallbackEmoji: '🤝' },
    yes: { customEmojiId: '5463423955014529788', fallbackEmoji: '👌' },
    lock: { customEmojiId: '5465443379917629504', fallbackEmoji: '🔓' },
    good: { customEmojiId: '5465465194056525619', fallbackEmoji: '👍' },
    don: { customEmojiId: '6235717714023814969', fallbackEmoji: '🍂' },
    skills: { customEmojiId: '6235593671073339928', fallbackEmoji: '💀' },
    heart: { customEmojiId: '6147617184479711380', fallbackEmoji: '❤️‍🔥' },
    github: { customEmojiId: '5346181118884331907', fallbackEmoji: '📱' }
  };
}

async function getEmojiMap() {
  try {
    if (cacheTimestamp && Date.now() - cacheTimestamp < CACHE_DURATION && emojiCache.size > 0) {
      return Object.fromEntries(emojiCache);
    }

    const emojiMap = getDefaultEmojiMap();

    try {
      const emojis = await prisma.customEmoji.findMany({
        where: { isActive: true, category: { isActive: true } },
        include: { category: true },
      });

      for (const emoji of emojis) {
        if (emoji.category && emoji.category.key) {
          const key = emoji.category.key.toLowerCase();
          emojiMap[key] = {
            customEmojiId: isValidCustomEmojiId(emoji.emojiId) ? String(emoji.emojiId).trim() : null,
            fallbackEmoji: emoji.fallbackEmoji || emojiMap[key]?.fallbackEmoji || '✨',
          };
        }
      }
    } catch (dbErr) {
      // Ignore DB error, use hardcoded map
    }

    emojiCache = new Map(Object.entries(emojiMap));
    cacheTimestamp = Date.now();
    return emojiMap;
  } catch (error) {
    logger.error('Error fetching emoji map:', error);
    return getDefaultEmojiMap();
  }
}

async function formatToHTML(text, useCustomEmoji = true) {
  const emojiMap = await getEmojiMap();
  let formattedText = text;

  formattedText = formattedText.replace(/'([^']+)'/g, (match, p1) => {
    const key = p1.toLowerCase();
    const config = emojiMap[key];

    if (config && useCustomEmoji && isValidCustomEmojiId(config.customEmojiId)) {
      return `<tg-emoji emoji-id="${config.customEmojiId}">${config.fallbackEmoji}</tg-emoji>`;
    } else if (config) {
      return config.fallbackEmoji;
    }
    return match;
  });

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
