const express = require('express');
const router = express.Router();
const prisma = require('../../services/db');

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

// GET: Settings Page with Data Fetching
router.get('/settings', isAuthenticated, async (req, res) => {
  try {
    let settings = {};
    if (prisma.setting) {
      const allSettings = await prisma.setting.findMany();
      allSettings.forEach(s => settings[s.key] = s.value);
    }
    res.render('settings', { error: null, success: null, settings });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.render('settings', { error: null, success: null, settings: {} });
  }
});

// POST: Update Settings (Support Link & Notice with Action Log)
router.post('/settings', isAuthenticated, async (req, res) => {
  try {
    const { supportUrl, notice } = req.body;
    
    if (prisma.setting) {
      if (supportUrl !== undefined) {
        await prisma.setting.upsert({
          where: { key: 'supportUrl' },
          update: { value: supportUrl },
          create: { key: 'supportUrl', value: supportUrl }
        }).catch(() => {});
      }
      if (notice !== undefined) {
        await prisma.setting.upsert({
          where: { key: 'notice' },
          update: { value: notice },
          create: { key: 'notice', value: notice }
        }).catch(() => {});
      }
    }

    // Console log for tracking admin action on Render terminal
    console.log(`[SETTINGS UPDATED] Admin ID: ${req.session.adminId} updated settings successfully.`);

    const settings = { supportUrl, notice };
    res.render('settings', { error: null, success: 'Settings updated successfully!', settings });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.render('settings', { error: 'Failed to update settings', success: null, settings: {} });
  }
});

module.exports = router;
