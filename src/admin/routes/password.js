const express = require('express');
const router = express.Router();
const prisma = require('../../services/db'); // ✅ Centralized DB connection
const bcrypt = require('bcrypt'); // Password hash check karne ke liye

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

// GET: Password page (Supporting both /password and /change-password to prevent 404)
router.get(['/password', '/change-password'], isAuthenticated, (req, res) => {
  res.render('password', { error: null, success: null });
});

// POST: Update Password (Supporting both endpoints)
router.post(['/password', '/change-password'], isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.render('password', { error: 'All fields are required', success: null });
    }

    // Admin find karo session ID se
    const admin = await prisma.admin.findUnique({
      where: { id: req.session.adminId }
    });

    if (!admin) {
      return res.redirect('/admin/login');
    }

    // Current password verify karo (bcrypt ya plain text, agar bcrypt hai toh compare karo)
    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.render('password', { error: 'Current password is incorrect', success: null });
    }

    // Naya password hash karke save karo
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: hashedPassword }
    });

    console.log(`[PASSWORD CHANGED] Admin ID: ${admin.id} updated their password.`);
    res.render('password', { error: null, success: 'Password updated successfully!' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.render('password', { error: 'Server Error', success: null });
  }
});

module.exports = router;
