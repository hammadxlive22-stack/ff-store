const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

router.get('/password', isAuthenticated, (req, res) => {
  res.render('password', { error: null, success: null });
});

router.post('/password', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    // Yahan apna password update logic daal sakta hai
    res.render('password', { error: null, success: 'Password updated successfully!' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).render('password', { error: 'Server Error', success: null });
  }
});

module.exports = router;
