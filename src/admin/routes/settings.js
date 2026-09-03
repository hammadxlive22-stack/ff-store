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

// GET: Settings Page
router.get('/settings', isAuthenticated, async (req, res) => {
  try {
    // Fetch settings from database or pass default config
    res.render('settings', { error: null, success: null });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).send('Server Error');
  }
});

// POST: Update Settings
router.post('/settings', isAuthenticated, async (req, res) => {
  try {
    // Handle settings update logic here
    res.redirect('/admin/settings');
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
