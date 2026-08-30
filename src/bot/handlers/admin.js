const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs'); // Make sure bcryptjs is installed in your package.json

// Helper to check if user is admin
async function checkAdmin(telegramId) {
  return await prisma.admin.findUnique({ 
    where: { telegramId: BigInt(telegramId) } 
  });
}

module.exports = (bot) => {

  // 🛠️ /admin - Main Control Center
  bot.command('admin', async (ctx) => {
    try {
      const admin = await checkAdmin(ctx.from.id);
      if (!admin || !admin.isActive) return ctx.reply('❌ Unauthorized access.');

      // Clear any previous stuck sessions when opening admin panel fresh
      ctx.session = {};

      const adminPanelText = `🛠️ <b>HACKER ADMIN CONTROL PANEL</b>\n✦━━━━━━━━━━━━━━━━━━━━✦\nSelect an option below to manage products, maintenance, settings, or search user orders:`;

      const adminButtons = Markup.inlineKeyboard([
        [Markup.button.callback('📦 Manage Products & PIDs', 'adm_products')],
        [Markup.button.callback('🔍 Search User by Telegram ID', 'adm_search_prompt')],
        [Markup.button.callback('📊 Live Key Delivery Logs', 'adm_logs')],
        [Markup.button.callback('⚙️ Setup APK & Channel Links', 'adm_settings')],
        [Markup.button.callback('🔑 Change Admin Password', 'adm_change_pass')]
      ]);

      await ctx.replyWithHTML(adminPanelText, adminButtons);
    } catch (error) {
      logger.error('Admin panel error:', error);
      ctx.reply('❌ Error loading admin panel.');
    }
  });

  // 🛑 /cancel - Clear any active session to prevent freezing
  bot.command('cancel', async (ctx) => {
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    ctx.session = {};
    await ctx.reply('✅ Active action cancelled and session cleared. Type /admin to go back.');
  });

  // 📦 Product List & PID Management Menu
  bot.action('adm_products', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return ctx.reply('❌ Unauthorized.');

    const products = await prisma.product.findMany({ include: { plans: true } });
    
    let text = `📦 <b>PRODUCT & PID MANAGEMENT</b>\n✦━━━━━━━━━━━━━━━━━━━━✦\n`;
    const rows = [];

    products.forEach((p, idx) => {
      text += `\n<b>${idx + 1}. ${p.name}</b>\n🆔 Panel PID: <code>${p.panelProductId || 'Not Set'}</code>\n🔧 Status: ${p.isMaintenance ? '⚠️ Under Maintenance' : '🟢 Active'}\n`;
      rows.push([
        Markup.button.callback(`✏️ PID: ${p.name}`, `edit_pid_${p.id}`),
        Markup.button.callback(`${p.isMaintenance ? '🟢 Resume' : '⚠️ Maint'}`, `toggle_maint_${p.id}`)
      ]);
    });

    rows.push([Markup.button.callback('« Back to Admin Menu', 'adm_home')]);

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  // 🛠️ Maintenance Mode Toggle Handler
  bot.action(/^toggle_maint_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    const productId = parseInt(ctx.match[1]);
    const product = await prisma.product.findUnique({ where: { id: productId } });

    if (product) {
      await prisma.product.update({
        where: { id: productId },
        data: { isMaintenance: !product.isMaintenance }
      });
      await ctx.reply(`✅ Product "${product.name}" maintenance status flipped!`);
    }

    // Refresh products view
    const products = await prisma.product.findMany({ include: { plans: true } });
    let text = `📦 <b>PRODUCT & PID MANAGEMENT</b>\n✦━━━━━━━━━━━━━━━━━━━━✦\n`;
    const rows = [];

    products.forEach((p, idx) => {
      text += `\n<b>${idx + 1}. ${p.name}</b>\n🆔 Panel PID: <code>${p.panelProductId || 'Not Set'}</code>\n🔧 Status: ${p.isMaintenance ? '⚠️ Under Maintenance' : '🟢 Active'}\n`;
      rows.push([
        Markup.button.callback(`✏️ PID: ${p.name}`, `edit_pid_${p.id}`),
        Markup.button.callback(`${p.isMaintenance ? '🟢 Resume' : '⚠️ Maint'}`, `toggle_maint_${p.id}`)
      ]);
    });
    rows.push([Markup.button.callback('« Back to Admin Menu', 'adm_home')]);

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });

  // ✏️ Edit PID Prompt handler
  bot.action(/^edit_pid_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    const productId = parseInt(ctx.match[1]);
    ctx.session = ctx.session || {};
    ctx.session.awaitingPidForProduct = productId;
    ctx.session.sessionTime = Date.now(); // Track time to prevent stale session bugs

    await ctx.reply('💬 Send the new Panel PID value for this product:\n(Or type /cancel to abort)');
  });

  // 🔍 User Search Prompt Action
  bot.action('adm_search_prompt', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    await ctx.reply('💬 Send the Telegram User ID to search their purchase history and delivered keys using command:\n<code>/searchuser &lt;telegram_id&gt;</code>', { parse_mode: 'HTML' });
  });

  // Command for searching user orders & keys by Telegram ID
  bot.command('searchuser', async (ctx) => {
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return ctx.reply('❌ Unauthorized.');

    const args = ctx.message.text.split(' ');
    const targetTelegramId = args[1];

    if (!targetTelegramId) {
      return ctx.reply('❌ Please provide a Telegram ID. Usage: `/searchuser <telegram_id>`', { parse_mode: 'Markdown' });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(targetTelegramId) },
        include: { orders: { include: { product: true, plan: true, delivery: true, payment: true } } }
      });

      if (!user || user.orders.length === 0) {
        return ctx.reply(`❌ No orders or user found for Telegram ID: ${targetTelegramId}`);
      }

      let report = `👤 <b>USER REPORT: ${targetTelegramId}</b>\nUsername: @${user.username || 'None'}\nName: ${user.firstName || 'User'}\n\n📦 <b>Orders & Key History:</b>\n`;
      
      user.orders.forEach((ord, i) => {
        report += `\n<b>${i + 1}. Order ID:</b> <code>${ord.id.slice(0, 8)}</code>\n` +
                  `📦 Product: ${ord.product.name} (${ord.plan.durationLabel})\n` +
                  `💰 Amount: ₹${ord.amount} | Status: <b>${ord.status}</b>\n` +
                  `🔑 Key: <code>${ord.delivery?.keyContent || 'Not Delivered'}</code>\n` +
                  `📅 Date: ${ord.createdAt.toLocaleString()}\n-----------------------------------`;
      });

      await ctx.replyWithHTML(report);
    } catch (err) {
      logger.error('Search user error:', err);
      ctx.reply('❌ Error fetching user data.');
    }
  });

  // 📊 Live Key Delivery Logs
  bot.action('adm_logs', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    const recentDeliveries = await prisma.delivery.findMany({
      take: 10,
      orderBy: { deliveredAt: 'desc' },
      include: { order: { include: { user: true, product: true, plan: true } } }
    });

    let logText = `📊 <b>LIVE KEY DELIVERY LOGS (Last 10)</b>\n✦━━━━━━━━━━━━━━━━━━━━✦\n`;

    if (recentDeliveries.length === 0) {
      logText += `\nNo key deliveries recorded yet.`;
    } else {
      recentDeliveries.forEach((d, idx) => {
        logText += `\n<b>${idx + 1}. User:</b> @${d.order.user.username || d.order.user.telegramId}\n` +
                   `📦 Product: ${d.order.product.name} (${d.order.plan.durationLabel})\n` +
                   `🔑 Key: <code>${d.keyContent}</code>\n` +
                   `🕒 Time: ${d.deliveredAt.toLocaleString()}\n`;
      });
    }

    await ctx.editMessageText(logText, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'adm_home')]])
    });
  });

  // ⚙️ System Settings (APK Link & Channel Link management)
  bot.action('adm_settings', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    const settings = await prisma.systemSetting.findMany();
    let text = `⚙️ <b>SYSTEM CONFIG & SETTINGS</b>\n✦━━━━━━━━━━━━━━━━━━━━✦\n`;
    
    if (settings.length === 0) {
      text += `\nNo settings found. Add one using command:\n<code>/setsetting KEY_NAME VALUE</code>`;
    } else {
      settings.forEach(s => {
        text += `🔹 <b>${s.key}:</b> <code>${s.value}</code>\n`;
      });
      text += `\nTo update use:\n<code>/setsetting KEY_NAME VALUE</code>`;
    }

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'adm_home')]])
    });
  });

  // 🔑 Change Admin Password Trigger Action
  bot.action('adm_change_pass', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    ctx.session = ctx.session || {};
    ctx.session.awaitingNewAdminPassword = true;
    ctx.session.sessionTime = Date.now();

    await ctx.reply('💬 Send the new password you want to set for your Admin account:\n(Or type /cancel to abort)');
  });

  // Command to update dynamic settings like APK link or Support Channel
  bot.command('setsetting', async (ctx) => {
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return ctx.reply('❌ Unauthorized.');

    const parts = ctx.message.text.split(' ');
    const key = parts[1];
    const value = parts.slice(2).join(' ');

    if (!key || !value) {
      return ctx.reply('❌ Usage: `/setsetting APK_DOWNLOAD_LINK https://...`', { parse_mode: 'Markdown' });
    }

    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });

    await ctx.reply(`✅ Setting <b>${key}</b> updated successfully to:\n<code>${value}</code>`, { parse_mode: 'HTML' });
  });

  // Home callback handler for Admin Menu
  bot.action('adm_home', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    const admin = await checkAdmin(ctx.from.id);
    if (!admin || !admin.isActive) return;

    ctx.session = {}; // Clear session on going home
    const adminPanelText = `🛠️ <b>HACKER ADMIN CONTROL PANEL</b>\n✦━━━━━━━━━━━━━━━━━━━━✦\nSelect an option below:`;
    const adminButtons = Markup.inlineKeyboard([
      [Markup.button.callback('📦 Manage Products & PIDs', 'adm_products')],
      [Markup.button.callback('🔍 Search User by Telegram ID', 'adm_search_prompt')],
      [Markup.button.callback('📊 Live Key Delivery Logs', 'adm_logs')],
      [Markup.button.callback('⚙️ Setup APK & Channel Links', 'adm_settings')],
      [Markup.button.callback('🔑 Change Admin Password', 'adm_change_pass')]
    ]);

    await ctx.editMessageText(adminPanelText, adminButtons);
  });

  // Existing Manual Approval Callbacks
  bot.action(/^approve_(.+)$/, async (ctx) => {
    try {
      const admin = await checkAdmin(ctx.from.id);
      if (!admin || !admin.isActive) return ctx.answerCbQuery('❌ Unauthorized.');

      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order) return ctx.answerCbQuery('Order not found.');
      if (order.paymentStatus !== 'SUCCESS') return ctx.answerCbQuery('❌ Not verified.');

      ctx.session = ctx.session || {};
      ctx.session.awaitingKeyForOrder = orderId;
      ctx.session.sessionTime = Date.now();
      
      await ctx.reply(`🔐 Enter key to deliver:\n(Order: ${orderId.slice(0,8)})\n(Type /cancel to abort)`);
    } catch (error) {
      logger.error('Approve error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });

  bot.action(/^reject_(.+)$/, async (ctx) => {
    try {
      const admin = await checkAdmin(ctx.from.id);
      if (!admin || !admin.isActive) return ctx.answerCbQuery('❌ Unauthorized.');

      const orderId = ctx.match[1];
      await prisma.order.update({ 
        where: { id: orderId }, 
        data: { status: 'REJECTED', approvalStatus: 'REJECTED' } 
      });
      
      await ctx.reply('❌ Order rejected.');
      
      await prisma.auditLog.create({
        data: { adminId: admin.id, action: 'REJECT_ORDER', details: { orderId } },
      });
    } catch (error) {
      logger.error('Reject error:', error);
      await ctx.answerCbQuery('❌ Error.');
    }
  });

  // Text Handler for Sessions (PID updates, Password Change & Manual Key Deliveries)
  bot.on('text', async (ctx, next) => {
    try {
      const admin = await checkAdmin(ctx.from.id);
      if (!admin || !admin.isActive) return next();

      ctx.session = ctx.session || {};

      // Safeguard: If session is older than 15 minutes, auto-expire it to prevent ghost states
      if (ctx.session.sessionTime && (Date.now() - ctx.session.sessionTime > 15 * 60 * 1000)) {
        ctx.session = {};
        return next();
      }

      // 0. Handling Admin Password Change Session
      if (ctx.session.awaitingNewAdminPassword) {
        delete ctx.session.awaitingNewAdminPassword;

        const newPlainPassword = ctx.message.text.trim();
        if (!newPlainPassword) {
          return ctx.reply('❌ Password cannot be empty.');
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPlainPassword, salt);

        await prisma.admin.update({
          where: { id: admin.id },
          data: { password: hashedPassword }
        });

        await prisma.auditLog.create({
          data: { adminId: admin.id, action: 'CHANGE_PASSWORD', details: { message: 'Admin password updated successfully' } },
        });

        return ctx.reply('✅ Admin password updated successfully! Keep your new password secure.', { parse_mode: 'HTML' });
      }

      // 1. Handling Product PID Update Session
      if (ctx.session.awaitingPidForProduct) {
        const productId = ctx.session.awaitingPidForProduct;
        delete ctx.session.awaitingPidForProduct;

        const newPid = ctx.message.text.trim();
        await prisma.product.update({
          where: { id: productId },
          data: { panelProductId: newPid }
        });

        return ctx.reply(`✅ Panel PID updated successfully to: <code>${newPid}</code>`, { parse_mode: 'HTML' });
      }

      // 2. Handling Manual Key Delivery Session
      if (ctx.session.awaitingKeyForOrder) {
        const orderId = ctx.session.awaitingKeyForOrder;
        delete ctx.session.awaitingKeyForOrder;

        const keyContent = ctx.message.text.trim();

        await prisma.$transaction(async (tx) => {
          await tx.delivery.create({
            data: { orderId: orderId, keyContent: keyContent },
          });
          await tx.order.update({
            where: { id: orderId },
            data: { 
              approvalStatus: 'APPROVED', 
              deliveryStatus: 'DELIVERED', 
              status: 'DELIVERED' 
            },
          });
        });

        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { user: true, product: true, plan: true },
        });

        const supportChannelSetting = await prisma.systemSetting.findUnique({ where: { key: 'SUPPORT_CHANNEL_LINK' } });
        let channelPrompt = '';
        if (supportChannelSetting && supportChannelSetting.value) {
          channelPrompt = `\n📢 Join our update channel: ${supportChannelSetting.value}\n`;
        }

        await bot.telegram.sendMessage(
          order.user.telegramId.toString(),
          `🎉 <b>ORDER APPROVED</b>\n\n✅ Payment Verified\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n\n🔐 <b>Your Key:</b>\n<code>${keyContent}</code>${channelPrompt}\n⚠️ Keep your key private.\n\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>`,
          { parse_mode: 'HTML' }
        );

        await ctx.reply('✅ Key delivered successfully.');
        
        await prisma.auditLog.create({
          data: { adminId: admin.id, action: 'APPROVE_AND_DELIVER', details: { orderId } },
        });
        return;
      }

      return next();
    } catch (error) {
      logger.error('Text handler error in admin:', error);
      await ctx.reply('❌ Error processing admin request.');
    }
  });
};
