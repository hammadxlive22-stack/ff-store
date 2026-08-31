const PREMIUM_EMOJIS = {
  verified: { id: "6147565374289220368", fallback: "✅" },
  flex: { id: "6147464060305676048", fallback: "😎" },
  blue_verification: { id: "6147524086768604985", fallback: "💎" },
  frozen: { id: "5449449325434266744", fallback: "❄️" },
  crying: { id: "6273840152980755328", fallback: "😭" },
  smiling: { id: "6276057176444246654", fallback: "🙂" },
  seeing_up: { id: "6273997026661241933", fallback: "😋" },
  teeth: { id: "6273726078649372769", fallback: "😁" },
  done: { id: "6274007313107915274", fallback: "👍" },
  blue_badge: { id: "5978776771623914876", fallback: "🟫" },
  black_badge: { id: "5978686323907628843", fallback: "🔸" },
  busy_tag: { id: "5852873584912896283", fallback: "🟧" },
  instagram: { id: "5895297528106061174", fallback: "🌐" },
  telegram: { id: "5895735846698487922", fallback: "🌐" },
  whatsapp: { id: "5895343514320899727", fallback: "🌐" },
  india: { id: "5913754823643107921", fallback: "🇮🇳" },
  dollar: { id: "5197434882321567830", fallback: "💵" },
  top: { id: "5463071033256848094", fallback: "🔝" },
  bro: { id: "5463256910851546817", fallback: "🤝" },
  yes: { id: "5463423955014529788", fallback: "👌" },
  lock: { id: "5465443379917629504", fallback: "🔓" },
  good: { id: "5465465194056525619", fallback: "👍" },
  sigma: { id: "6235620067942341623", fallback: "🥃" },
  don: { id: "6235717714023814969", fallback: "🍂" },
  skills: { id: "6235593671073339928", fallback: "💀" },
  heart: { id: "6147617184479711380", fallback: "❤️‍🔥" },
  stars: { id: "6235403472741603087", fallback: "⭐" },
  github: { id: "5346181118884331907", fallback: "📱" },
  motion: { id: "5971944878815317190", fallback: "💠" }
};

function getEmoji(name, fallback = "⭐") {
  const emojiData = PREMIUM_EMOJIS[name];
  if (!emojiData) return fallback;
  return `<tg-emoji emoji-id="${emojiData.id}">${emojiData.fallback}</tg-emoji>`;
}

function formatText(text) {
  if (!text) return "";
  return text.replace(/'([^']+)'/g, (match, p1) => {
    if (PREMIUM_EMOJIS[p1]) {
      return getEmoji(p1);
    }
    return match;
  });
}

module.exports = { getEmoji, formatText, PREMIUM_EMOJIS };
