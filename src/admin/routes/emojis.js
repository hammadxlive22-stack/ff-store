const express = require('express');
const prisma = require('../../services/db');
const { clearEmojiCache } = require('../../services/emojiService');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect('/admin/login');
  next();
}

router.get('/emojis', requireAdmin, async (req, res) => {
  const categories = await prisma.emojiCategory.findMany({
    include: { customEmojis: true },
  });
  res.render('emojis', { categories });
});

router.post('/emojis', requireAdmin, async (req, res) => {
  const { emojiId, categoryId, fallbackEmoji, label } = req.body;
  await prisma.customEmoji.create({
    data: {
      emojiId,
      categoryId: parseInt(categoryId),
      fallbackEmoji,
      label,
    },
  });
  clearEmojiCache();
  res.redirect('/admin/emojis');
});

module.exports = router;
