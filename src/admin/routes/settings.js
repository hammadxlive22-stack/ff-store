const express = require('express');
const router = express.Router();
const prisma = require('../../services/db');

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

// These are the exact keys already read elsewhere in the bot
// (src/bot/handlers/payment.js, src/bot/handlers/admin.js /setsetting command)
const SUPPORT_KEY = 'SUPPORT_CHANNEL_LINK';
const APK_KEY = 'APK_DOWNLOAD_LINK';

// GET: Settings page with real data from SystemSetting table
router.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: [SUPPORT_KEY, APK_KEY] } },
    });
    const settings = {};
    rows.forEach((r) => { settings[r.key] = r.value; });

    res.render('settings', { error: null, success: null, settings });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.render('settings', { error: 'Failed to load settings', success: null, settings: {} });
  }
});

// POST: Update settings (actually persists now, using the correct model/keys)
router.post('/settings', isAuthenticated, async (req, res) => {
  try {
    const { supportUrl, apkUrl } = req.body;

    if (supportUrl !== undefined) {
      await prisma.systemSetting.upsert({
        where: { key: SUPPORT_KEY },
        update: { value: supportUrl },
        create: { key: SUPPORT_KEY, value: supportUrl },
      });
    }

    if (apkUrl !== undefined) {
      await prisma.systemSetting.upsert({
        where: { key: APK_KEY },
        update: { value: apkUrl },
        create: { key: APK_KEY, value: apkUrl },
      });
    }

    console.log(`[SETTINGS UPDATED] Admin ID: ${req.session.adminId} updated settings successfully.`);

    res.render('settings', {
      error: null,
      success: 'Settings updated successfully!',
      settings: { [SUPPORT_KEY]: supportUrl, [APK_KEY]: apkUrl },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.render('settings', { error: 'Failed to update settings', success: null, settings: {} });
  }
});

module.exports = router;
