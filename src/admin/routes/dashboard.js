const express = require('express');
const prisma = require('../../services/db');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect('/admin/login');
  next();
}

router.get('/dashboard', requireAdmin, async (req, res) => {
  const totalOrders = await prisma.order.count();
  const totalSales = await prisma.order.aggregate({ 
    _sum: { amount: true }, 
    where: { status: 'DELIVERED' } 
  });
  const totalUsers = await prisma.user.count();
  const pendingOrders = await prisma.order.count({ where: { status: 'PAYMENT_VERIFIED' } });
  const completedOrders = await prisma.order.count({ where: { status: 'DELIVERED' } });

  res.render('dashboard', {
    totalOrders,
    totalSales: totalSales._sum.amount || 0,
    totalUsers,
    pendingOrders,
    completedOrders,
  });
});

module.exports = router;