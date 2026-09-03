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

router.get('/logs', isAuthenticated, async (req, res) => {
  try {
    // Agar tere database mein logs table hai toh fetch kar le, nahi toh empty array bhej de
    const logs = []; 
    res.render('logs', { logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
