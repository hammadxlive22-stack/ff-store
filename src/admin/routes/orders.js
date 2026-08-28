const express = require('express');
const prisma = require('../../services/db');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect('/admin/login');
  next();
}

router.get('/orders', requireAdmin, async (req, res) => {
  const filter = req.query.filter || 'ALL';
  const where = filter === 'ALL' ? {} : { status: filter };
  
  const orders = await prisma.order.findMany({
    where,
    include: { user: true, product: true, plan: true },
    orderBy: { createdAt: 'desc' },
  });
  
  res.render('orders', { orders, filter });
});

module.exports = router;