const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
};

// GET: View Users with simple search support & Total Count
router.get('/users', isAuthenticated, async (req, res) => {
  try {
    const search = req.query.search || '';
    
    // Simple query filter if search term is provided
    const whereCondition = search 
      ? { 
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } }
          ] 
        } 
      : {};

    // Parallel execution: Fetch users and total count together for speed
    const [users, totalUsers] = await Promise.all([
      prisma.user.findMany({
        where: whereCondition,
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.user.count()
    ]);

    res.render('users', { users, search, totalUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send('Server Error');
  }
});

// POST: Unbind User Device / Reset HWID
router.post('/users/:id/unbind', isAuthenticated, async (req, res) => {
  try {
    const userId = req.params.id;

    await prisma.user.update({
      where: { id: userId },
      data: {
        hwid: null,
        deviceInfo: null
      }
    });

    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error unbinding user:', error);
    res.status(500).send('Server Error');
  }
});

// POST: Delete/Ban User
router.post('/users/:id/delete', isAuthenticated, async (req, res) => {
  try {
    const userId = req.params.id;

    await prisma.user.delete({
      where: { id: userId }
    });

    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
