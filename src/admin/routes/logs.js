const express = require('express');
const router = express.Router();
const prisma = require('../../services/db');

const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

router.get('/logs', isAuthenticated, async (req, res) => {
  try {
    // Real audit log model (AuditLog), last 100 entries, newest first
    const logs = await prisma.auditLog.findMany({
      include: { admin: { select: { username: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.render('logs', { logs });
  } catch (error) {
    console.error('Error fetching logs from database:', error);
    res.render('logs', { logs: [] });
  }
});

module.exports = router;
