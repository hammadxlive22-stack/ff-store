const express = require('express');
const prisma = require('../../services/db');
const { clearEmojiCache } = require('../../services/emojiService');
const router = express.Router();

// Admin Authentication Middleware
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.redirect('/admin/login');
  }
  next();
}

// 📌 GET: Render Emoji Management Page
router.get('/emojis', requireAdmin, async (req, res) => {
  try {
    const categories = await prisma.emojiCategory.findMany({
      include: {
        customEmojis: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { key: 'asc' },
    });

    res.render('emojis', { categories, error: null, success: null });
  } catch (error) {
    console.error('Error fetching emojis:', error);
    res.status(500).send('Internal Server Error');
  }
});

// 📌 POST: Add / Update Custom Emoji
router.post('/emojis', requireAdmin, async (req, res) => {
  try {
    const { emojiId, categoryId, fallbackEmoji, label } = req.body;

    if (!emojiId || !categoryId || !label) {
      return res.redirect('/admin/emojis?error=Missing+required+fields');
    }

    const parsedCategoryId = parseInt(categoryId, 10);
    if (isNaN(parsedCategoryId)) {
      return res.redirect('/admin/emojis?error=Invalid+Category');
    }

    // Save to Database
    await prisma.customEmoji.create({
      data: {
        emojiId: emojiId.trim(),
        categoryId: parsedCategoryId,
        fallbackEmoji: fallbackEmoji ? fallbackEmoji.trim() : '✨',
        label: label.trim().toUpperCase(),
        isActive: true,
      },
    });

    // Clear Cache immediately so Bot picks updated emojis instantly
    clearEmojiCache();

    res.redirect('/admin/emojis?success=Emoji+Added');
  } catch (error) {
    console.error('Error adding emoji:', error);
    res.redirect('/admin/emojis?error=Failed+to+add+emoji');
  }
});

// 📌 POST: Delete Emoji Route
router.post('/emojis/delete/:id', requireAdmin, async (req, res) => {
  try {
    const emojiId = parseInt(req.params.id, 10);
    if (!isNaN(emojiId)) {
      await prisma.customEmoji.delete({ where: { id: emojiId } });
      clearEmojiCache();
    }
    res.redirect('/admin/emojis?success=Emoji+Deleted');
  } catch (error) {
    console.error('Error deleting emoji:', error);
    res.redirect('/admin/emojis?error=Delete+failed');
  }
});

module.exports = router;
