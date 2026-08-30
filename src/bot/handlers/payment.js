const { Markup } = require('telegraf');
const axios = require('axios');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    // 1. Instant Callback Answer (Telegram UX Fast)
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Invalid plan.');

      // Check if product is under maintenance
      if (plan.product.isMaintenance) {
        return ctx.reply(`⚠️ Sorry! Product "<b>${plan.product.name}</b>" is currently under maintenance. Please check back later.`, { parse_mode: 'HTML' });
      }

      // 2. Database Order Creation
      const order = await prisma.order.create({
        data: {
          userId: BigInt(ctx.from.id),
          productId: plan.productId,
          planId: plan.id,
          amount: plan.price,
        },
      });

      // 3. FamGateway Integration
      const famResponse = await famgateway.createPayment({
        amount: Number(plan.price),
        orderId: order.id,
        customerName: ctx.from.first_name || 'Customer',
      });

      if (!famResponse.success) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED', paymentStatus: 'FAILED' },
        });
        return ctx.reply('❌ Payment creation failed.');
      }

      await prisma.payment.create({
        data: {
          orderId: order.id,
          famgatewayOrderId: famResponse.fam_order_id,
          amount: Number(plan.price),
          status: 'PENDING',
          paymentData: {
            qr_text: famResponse.qr_text,
            qr_url: famResponse.qr_image,
          },
        },
      });

      // 4. Combined Payment Details + QR Code Message
      const textMsg = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Amount: ₹${plan.price}\n🧾 Order ID: <code>${order.id.slice(0, 8)}</code>\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>\n\n👇 Scan this QR or use buttons below to pay:`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.payment_url || famResponse.qr_text)],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      const qrImageUrl = famResponse.qr_image || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(famResponse.qr_text)}`;

      // Send photo and text together in a single message with caption and buttons
      await ctx.replyWithPhoto(qrImageUrl, {
        caption: textMsg,
        parse_mode: 'HTML',
        ...buttons,
      });

    } catch (error) {
      logger.error('Payment creation error:', error);
      ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
    }
  });

  // ✅ Verification Flow & Auto Key Delivery via Panel API
  bot.action(/^paid_(.+)$/, async (ctx) => {
    ctx.answerCbQuery('⏳ Verification checking...').catch(() => {});

    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order || order.user.telegramId !== BigInt(ctx.from.id)) {
        return ctx.reply('❌ Order not found or unauthorized.');
      }

      // 🔒 Prevent double verification/delivery if already completed
      if (order.paymentStatus === 'SUCCESS' || order.deliveryStatus === 'DELIVERED') {
        return ctx.reply('✅ Payment is already verified and key has been delivered.');
      }

      if (['CANCELLED', 'EXPIRED'].includes(order.status)) {
        return ctx.reply('❌ Order is no longer active.');
      }

      // Check maintenance status again
      if (order.product.isMaintenance) {
        return ctx.reply(`⚠️ Product "<b>${order.product.name}</b>" is under maintenance. Your payment is safe, contact admin.`, { parse_mode: 'HTML' });
      }

      const verification = await famgateway.verifyPayment(order.payment.famgatewayOrderId);

      if (verification.status === 'SUCCESS') {
        // Mark payment and order as successful
        await prisma.$transaction([
          prisma.payment.update({
            where: { orderId: orderId },
            data: { status: 'SUCCESS', verifiedAt: new Date() },
          }),
          prisma.order.update({
            where: { id: orderId },
            data: { paymentStatus: 'SUCCESS', status: 'COMPLETED', deliveryStatus: 'DELIVERED' },
          }),
        ]);

        // 🚀 Hit Panel API to generate & fetch license key automatically
        let licenseKeyText = '';
        try {
          const apiParams = new URLSearchParams({
            api_key: process.env.PANEL_API_KEY,
            action: 'buy',
            product_id: order.product.panelProductId || order.product.id,
            duration: order.plan.durationLabel,
          });

          const panelResponse = await axios.post('https://adminpanels.shop/api/reseller_v1.php', apiParams.toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-master-key': process.env.PANEL_MASTER_KEY
            },
            timeout: 20000
          });

          const panelData = panelResponse.data;
          
          if (panelData) {
            if (typeof panelData === 'object') {
              // Handle panel error responses gracefully
              if (panelData.status === false || panelData.error || panelData.msg) {
                licenseKeyText = `⚠️ Panel Error: ${panelData.error || panelData.msg || JSON.stringify(panelData)}`;
              } else {
                licenseKeyText = panelData.key || panelData.license || JSON.stringify(panelData);
              }
            } else {
              licenseKeyText = panelData;
            }
          }
        } catch (apiErr) {
          logger.error('Panel API automatic key generation error:', apiErr);
          licenseKeyText = '⚠️ Key generation error. Contact admin with your Order ID.';
        }

        // 💾 Save Delivery Record in DB so it shows up in Live Logs & User Search
        await prisma.delivery.create({
          data: {
            orderId: order.id,
            keyContent: licenseKeyText,
          },
        }).catch((err) => logger.error('Delivery record save error:', err));

        // Fetch dynamic support channel link if set by admin
        const supportChannelSetting = await prisma.systemSetting.findUnique({ where: { key: 'SUPPORT_CHANNEL_LINK' } });
        let channelPrompt = '';
        if (supportChannelSetting && supportChannelSetting.value) {
          channelPrompt = `\n📢 Join Official Channel: ${supportChannelSetting.value}\n`;
        }

        // Send success message along with the generated license key and optional channel link to the user
        await ctx.reply(
          `✅ <b>Payment Verified Successfully!</b>\n\n` +
          `📦 Product: ${order.product.name}\n` +
          `⏱️ Plan: ${order.plan.durationLabel}\n` +
          `🧾 Order ID: <code>${order.id.slice(0, 8)}</code>\n\n` +
          `🔑 <b>Your License Key:</b>\n<code>${licenseKeyText}</code>${channelPrompt}`,
          { parse_mode: 'HTML' }
        );

        // Optional: Notify Admins about the successful auto-delivery
        const admins = await prisma.admin.findMany({
          where: { isSuperadmin: true, isActive: true, telegramId: { not: null } },
        });

        const adminMsg = `🔔 <b>AUTO-DELIVERED ORDER</b>\n\n👤 User: ${order.user.firstName}\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0, 8)}</code>\n🔑 Key: <code>${licenseKeyText}</code>`;

        for (const admin of admins) {
          await bot.telegram.sendMessage(admin.telegramId.toString(), adminMsg, {
            parse_mode: 'HTML',
          }).catch((err) => logger.error('Admin notify error:', err));
        }

      } else if (verification.status === 'PENDING') {
        await ctx.reply('⏳ Payment is still pending. Please wait.');
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'EXPIRED', paymentStatus: 'FAILED' },
        });
        await ctx.reply('❌ Payment was not detected. Please try again.');
      }
    } catch (error) {
      logger.error('Payment verification error:', error);
      ctx.reply('❌ Verification error. Try again.').catch(() => {});
    }
  });

  // ❌ Order Cancellation
  bot.action(/^cancel_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== BigInt(ctx.from.id)) {
        return ctx.reply('❌ Order not found.');
      }
      if (order.paymentStatus === 'SUCCESS') {
        return ctx.reply('❌ Cannot cancel paid order.');
      }

      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
      await ctx.reply('❌ Order cancelled.');
    } catch (error) {
      logger.error('Cancel error:', error);
      ctx.reply('❌ Error cancelling order.').catch(() => {});
    }
  });
};
