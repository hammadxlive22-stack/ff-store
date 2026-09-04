const express = require('express');
const router = express.Router();
const prisma = require('../../services/db');
const bcrypt = require('bcrypt');

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

// GET: Password page
router.get(['/password', '/change-password'], isAuthenticated, (req, res) => {
  res.render('password', { error: null, success: null });
});

// POST: Update Password with safe fallback
router.post(['/password', '/change-password'], isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.render('password', { error: 'All fields are required', success: null });
    }

    const admin = await prisma.admin.findUnique({
      where: { id: req.session.adminId }
    });

    if (!admin) {
      return res.redirect('/admin/login');
    }

    // Check if password matches (handles both bcrypt hashes and plain text safely)
    let isMatch = false;
    if (admin.password && (admin.password.startsWith('$2b$') || admin.password.startsWith('$2a$'))) {
      isMatch = await bcrypt.compare(currentPassword, admin.password);
    } else {
      isMatch = (currentPassword === admin.password);
    }

    if (!isMatch) {
      return res.render('password', { error: 'Current password is incorrect', success: null });
    }

    // Hash new password securely
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: hashedPassword }
    });

    console.log(`[PASSWORD CHANGED] Admin ID: ${admin.id} updated password successfully.`);
    return res.render('password', { error: null, success: 'Password updated successfully!' });
  } catch (error) {
    console.error('CRITICAL PASSWORD ERROR:', error);
    return res.render('password', { error: `Server Error: ${error.message}`, success: null });
  }
});

module.exports = router;
