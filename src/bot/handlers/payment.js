
const { Markup } = require('telegraf');
const QRCode = require('qrcode');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    // ✅ सबसे पहले callback answer करो (कोई await नहीं)
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Invalid plan.');

      const order = await prisma.order.create({
        data: {
          userId: BigInt(ctx.from.id),
          productId: plan.productId,
          planId: plan.id,
          amount: plan.price,
        },
      });

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

      // ✅ Step 1: UPI link text message तुरंत भेजो
      const textMsg = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Amount: ₹${plan.price}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.payment_url || 'https://famgateway.in')],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      await ctx.replyWithHTML(textMsg, buttons);

      // ✅ Step 2: QR भेजने से पहले 2 सेकंड delay (Telegram rate limit से बचें)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // QR भेजने की कोशिश (retry के साथ)
      if (famResponse.qr_text) {
        // Attempt 1: Photo 150px
        try {
          // User को बताओ कि QR आ रहा है
          await ctx.replyWithChatAction('upload_photo').catch(() => {});
          const qrBuffer = await QRCode.toBuffer(famResponse.qr_text, {
            type: 'png',
            width: 150,
            margin: 1,
            errorCorrectionLevel: 'M',
          });
          await ctx.replyWithPhoto(
            { source: qrBuffer },
            { caption: '👇 Scan this QR to pay' }
          );
          logger.info('QR photo sent (150px)');
          return;
        } catch (photoError1) {
          logger.error('Photo attempt 1 failed:', JSON.stringify(photoError1));
        }

        // 3 सेकंड wait करके document try करो
        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
          const qrBuffer = await QRCode.toBuffer(famResponse.qr_text, {
            type: 'png',
            width: 150,
            margin: 1,
          });
          await ctx.replyWithDocument(
            { source: qrBuffer, filename: 'payment-qr.png' },
            { caption: '👇 Scan this QR to pay' }
          );
          logger.info('QR document sent (150px)');
          return;
        } catch (docError) {
          logger.error('Document send failed:', JSON.stringify(docError));
        }

        // 5 सेकंड wait करके फिर photo try करो (और छोटा 120px)
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
          const qrBuffer = await QRCode.toBuffer(famResponse.qr_text, {
            type: 'png',
            width: 120,
            margin: 1,
          });
          await ctx.replyWithPhoto(
            { source: qrBuffer },
            { caption: '👇 Scan this QR to pay' }
          );
          logger.info('QR photo sent (120px)');
        } catch (photoError2) {
          logger.error('Photo attempt 2 failed:', JSON.stringify(photoError2));
          // UPI link पहले से भेज दिया गया है
        }
      }
    } catch (error) {
      logger.error('Payment creation error:', error);
      ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
    }
  });

  // ✅ I Have Paid – verification (कोई बदलाव नहीं)
  bot.action(/^paid_(.+)$/, async (ctx) => {
    ctx.answerCbQuery('⏳ Checking...').catch(() => {});

    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order || order.user.telegramId !== BigInt(ctx.from.id)) {
        return ctx.answerCbQuery('❌ Order not found.').catch(() => {});
      }

      if (order.paymentStatus === 'SUCCESS') {
        return ctx.answerCbQuery('✅ Payment already verified.').catch(() => {});
      }

      if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
        return ctx.answerCbQuery('❌ Order is no longer active.').catch(() => {});
      }

      const verification = await famgateway.verifyPayment(order.payment.famgatewayOrderId);

      if (verification.status === 'SUCCESS') {
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { orderId: orderId },
            data: { status: 'SUCCESS', verifiedAt: new Date() },
          });
          await tx.order.update({
            where: { id: orderId },
            data: { paymentStatus: 'SUCCESS', status: 'PAYMENT_VERIFIED' },
          });
        });

        const admins = await prisma.admin.findMany({
          where: { isSuperadmin: true, isActive: true, telegramId: { not: null } },
        });

        for (const admin of admins) {
          const adminMsg = `🔔 <b>NEW PAID ORDER</b>\n\n👤 User: ${order.user.firstName}\n📦 Product: ${order.product.name}\n⏱️ Plan: ${order.plan.durationLabel}\n💰 Amount: ₹${order.amount}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\nApprove or reject:`;
          const adminButtons = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve_${order.id}`), Markup.button.callback('❌ Reject', `reject_${order.id}`)],
          ]);
          await bot.telegram.sendMessage(admin.telegramId.toString(), adminMsg, {
            parse_mode: 'HTML',
            ...adminButtons,
          }).catch((err) => logger.error('Admin notify error:', err));
        }

        await ctx.reply('✅ Payment received successfully!\n👨‍💼 Your order has been sent to admin for approval.');
      } else if (verification.status === 'PENDING') {
        await ctx.reply('⏳ Payment is still pending. Please wait.');
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'EXPIRED', paymentStatus: 'FAILED' },
        });
        await ctx.reply('❌ Payment was not detected. Please create a new order.');
      }
    } catch (error) {
      logger.error('Payment verification error:', error);
      ctx.reply('❌ Verification error. Try again.').catch(() => {});
    }
  });

  // ❌ Cancel order
  bot.action(/^cancel_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });

      if (!order || order.userId !== BigInt(ctx.from.id)) {
        return ctx.answerCbQuery('❌ Order not found.').catch(() => {});
      }
      if (order.paymentStatus === 'SUCCESS') {
        return ctx.answerCbQuery('❌ Cannot cancel paid order.').catch(() => {});
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
