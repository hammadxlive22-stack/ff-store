const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting FF STORE database seeding...');

  // Create default product
  const product = await prisma.product.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Premium Digital Key',
      description: 'Authorized premium digital key with instant delivery',
      isActive: true,
      sortOrder: 1,
    },
  });
  console.log('✅ Product created:', product.name);

  // Create plans
  const plans = [
    { durationLabel: '1 Hour', durationSeconds: 3600, price: 50, sortOrder: 1 },
    { durationLabel: '3 Hours', durationSeconds: 10800, price: 120, sortOrder: 2 },
    { durationLabel: '6 Hours', durationSeconds: 21600, price: 200, sortOrder: 3 },
    { durationLabel: '12 Hours', durationSeconds: 43200, price: 350, sortOrder: 4 },
    { durationLabel: '1 Day', durationSeconds: 86400, price: 470, sortOrder: 5 },
    { durationLabel: '7 Days', durationSeconds: 604800, price: 760, sortOrder: 6 },
    { durationLabel: '30 Days', durationSeconds: 2592000, price: 1980, sortOrder: 7 },
  ];

  for (const plan of plans) {
    await prisma.plan.create({
      data: {
        productId: product.id,
        ...plan,
      },
    });
  }
  console.log(`✅ Created ${plans.length} plans`);

  // Create admin
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.admin.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPassword,
      fullName: 'FF Store Admin',
      isSuperadmin: true,
      telegramId: BigInt(process.env.ADMIN_TELEGRAM_IDS?.split(',')[0] || '123456789'),
    },
  });
  console.log('✅ Admin created:', admin.username);

  // Create emoji categories
  const categories = [
    { key: 'PREMIUM', label: '👑 Premium / Branding' },
    { key: 'SECTION', label: '✦ Section Header' },
    { key: 'SHOP', label: '🛒 Shop / Buy Now' },
    { key: 'PAYMENT', label: '💳 Payment' },
    { key: 'ORDERS', label: '📦 Orders' },
    { key: 'PROFILE', label: '👤 Profile' },
    { key: 'HISTORY', label: '🧾 Payment History' },
    { key: 'BALANCE', label: '💰 Balance' },
    { key: 'SUCCESS', label: '✅ Success' },
    { key: 'FAILED', label: '❌ Failed' },
    { key: 'PENDING', label: '⏳ Pending' },
    { key: 'SECURE', label: '🔐 Secure Delivery' },
    { key: 'SECURITY', label: '🛡️ Security' },
    { key: 'FAST', label: '⚡ Fast Service' },
    { key: 'SUPPORT', label: '🆘 Support' },
    { key: 'ARROW', label: '➜ Navigation' },
  ];

  for (const cat of categories) {
    await prisma.emojiCategory.upsert({
      where: { key: cat.key },
      update: cat,
      create: cat,
    });
  }
  console.log(`✅ Created ${categories.length} emoji categories`);

  // Create custom emojis
  const emojis = [
    { emojiId: '5350452584119279096', categoryKey: 'PREMIUM', fallbackEmoji: '👑', label: 'Premium Crown' },
    { emojiId: '5382194935057372936', categoryKey: 'SECTION', fallbackEmoji: '✦', label: 'Section Divider' },
    { emojiId: '5312361253610475399', categoryKey: 'SHOP', fallbackEmoji: '🛒', label: 'Shopping Cart' },
    { emojiId: '6203752050556145334', categoryKey: 'PAYMENT', fallbackEmoji: '💳', label: 'Payment Card' },
    { emojiId: '5258336354642697821', categoryKey: 'ORDERS', fallbackEmoji: '📦', label: 'Package' },
  ];

  for (const emoji of emojis) {
    const category = await prisma.emojiCategory.findUnique({ where: { key: emoji.categoryKey } });
    if (category) {
      await prisma.customEmoji.upsert({
        where: { emojiId: emoji.emojiId },
        update: { categoryId: category.id, fallbackEmoji: emoji.fallbackEmoji, label: emoji.label },
        create: {
          emojiId: emoji.emojiId,
          categoryId: category.id,
          fallbackEmoji: emoji.fallbackEmoji,
          label: emoji.label,
        },
      });
    }
  }
  console.log(`✅ Created ${emojis.length} custom emojis`);

  console.log('✅ Database seeding completed!');
  console.log('📝 Default Admin:');
  console.log('   Username: admin');
  console.log('   Password: admin123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });