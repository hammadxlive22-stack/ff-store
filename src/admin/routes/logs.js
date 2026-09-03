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
    // Database se real logs fetch karega (Last 100 logs)
    let logs = [];
    if (prisma.log) {
      logs = await prisma.log.findMany({
        orderBy: {
          createdAt: 'desc'
        },
        take: 100
      });
    }
    res.render('logs', { logs });
  } catch (error) {
    console.error('Error fetching logs from database:', error);
    // Error aane par bhi page crash nahi hoga, empty logs dikha dega
    res.render('logs', { logs: [] });
  }
});

module.exports = router;
