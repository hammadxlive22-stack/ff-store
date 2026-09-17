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
  const { name, description, panelProductId } = req.body;
  await prisma.product.create({
    data: {
      name,
      description,
      panelProductId: panelProductId && panelProductId.trim() !== '' ? panelProductId.trim() : null,
    },
  });
  res.redirect('/admin/products');
});

// ✅ Update product name + Panel PID (form already exists in products.ejs)
router.post('/products/:id/update', requireAdmin, async (req, res) => {
  const { name, panelProductId } = req.body;
  try {
    await prisma.product.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        panelProductId: panelProductId && panelProductId.trim() !== '' ? panelProductId.trim() : null,
      },
    });
  } catch (err) {
    console.error('Product update error:', err);
  }
  res.redirect('/admin/products');
});

// ✅ Delete product (blocked if it still has orders, to protect order history)
router.post('/products/:id/delete', requireAdmin, async (req, res) => {
  const productId = parseInt(req.params.id);
  try {
    await prisma.plan.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
  } catch (err) {
    console.error('Product delete error (likely has existing orders):', err.message);
  }
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

// ✅ Delete a single plan (products.ejs already posts here)
router.post('/plans/:id/delete', requireAdmin, async (req, res) => {
  try {
    await prisma.plan.delete({ where: { id: parseInt(req.params.id) } });
  } catch (err) {
    console.error('Plan delete error (likely has existing orders):', err.message);
  }
  res.redirect('/admin/products');
});

module.exports = router;
