const express = require('express');
const router = express.Router();
const prisma = require('../../services/db');

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

// GET: View Users with search (by username / first name / last name / telegram id)
router.get('/users', isAuthenticated, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();

    const whereCondition = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            ...(/^\d+$/.test(search) ? [{ telegramId: BigInt(search) }] : []),
          ],
        }
      : {};

    const [users, totalUsers] = await Promise.all([
      prisma.user.findMany({
        where: whereCondition,
        include: { _count: { select: { orders: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count(),
    ]);

    res.render('users', { users, search, totalUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send('Server Error');
  }
});

// POST: Delete user (blocked if they still have orders, to protect order history)
router.post('/users/:id/delete', isAuthenticated, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    await prisma.user.delete({ where: { id: userId } });
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error deleting user (likely has existing orders):', error.message);
    res.redirect('/admin/users');
  }
});

module.exports = router;
