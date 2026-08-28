const express = require('express');
const prisma = require('../../services/db');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect('/admin/login');
  next();
}

router.get('/products', requireAdmin, async (req, res) => {
  const products = await prisma.product.findMany({ include: { plans: true } });
  res.render('products', { products });
});

router.post('/products', requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  await prisma.product.create({ data: { name, description } });
  res.redirect('/admin/products');
});

router.post('/products/:id/plans', requireAdmin, async (req, res) => {
  const { durationLabel, durationSeconds, price } = req.body;
  await prisma.plan.create({
    data: {
      productId: parseInt(req.params.id),
      durationLabel,
      durationSeconds: parseInt(durationSeconds),
      price: parseFloat(price),
    },
  });
  res.redirect('/admin/products');
});

module.exports = router;