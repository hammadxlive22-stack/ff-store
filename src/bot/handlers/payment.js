const { Markup } = require('telegraf');
const QRCode = require('qrcode');
const prisma = require('../../services/db');
const famgateway = require('../../services/famgateway');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.action(/^pay_(\d+)$/, async (ctx) => {
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

      const paymentText = `💳 <b>PAYMENT CREATED</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Amount: ₹${plan.price}\n🧾 Order ID: <code>${order.id.slice(0,8)}</code>\n\n👇 <b>Scan QR to pay</b>`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔗 Pay via Link', famResponse.qr_text)],
        [Markup.button.callback('✅ I Have Paid', `paid_${order.id}`)],
        [Markup.button.callback('❌ Cancel Order', `cancel_${order.id}`)],
      ]);

      // ✅ Generate QR locally from UPI link (fast, no network)
      if (famResponse.qr_text) {
        try {
          const qrBuffer = await QRCode.toBuffer(famResponse.qr_text, {
            type: 'png',
            width: 300,
            margin: 2,
            errorCorrectionLevel: 'M',
          });
          await ctx.replyWithPhoto(
            { source: qrBuffer },
            {
              caption: paymentText,
              parse_mode: 'HTML',
              ...buttons,
            }
          );
        } catch (qrError) {
          logger.error('QR generation failed, fallback to text:', qrError.message);
          await ctx.replyWithHTML(
            paymentText + `\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`,
            buttons
          );
        }
      } else {
        await ctx.replyWithHTML(
          paymentText + `\n\n🔗 <b>UPI Link:</b>\n<code>${famResponse.qr_text}</code>`,
          buttons
        );
      }
    } catch (error) {
      logger.error('Payment creation error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });

  bot.action(/^paid_(.+)$/, async (ctx) => {
    ctx.answerCbQuery('⏳ Checking...').catch(() => {});

    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payment: true, user: true, product: true, plan: true },
      });

      if (!order || order.user.telegramId !== BigInt(ctx.from.id)) {
        return ctx.answerCbQuery('❌ Not found.').catch(() => {});
      }
      if (order.paymentStatus === 'SUCCESS') {
        return ctx.answerCbQuery('✅ Already verified.').catch(() => {});
      }
      if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
        return ctx.answerCbQuery('❌ Order inactive.').catch(() => {});
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

        await ctx.reply('✅ Payment received!\n👨‍💼 Sent to admin for approval.');
      } else if (verification.status === 'PENDING') {
        await ctx.reply('⏳ Payment pending. Wait for confirmation.');
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'EXPIRED', paymentStatus: 'FAILED' },
        });
        await ctx.reply('❌ Payment not detected.');
      }
    } catch (error) {
      logger.error('Verification error:', error);
      ctx.reply('❌ Error.').catch(() => {});
    }
  });

  bot.action(/^cancel_(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});
    try {
      const orderId = ctx.match[1];
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== BigInt(ctx.from.id)) return ctx.answerCbQuery('❌ Not found.').catch(() => {});
      if (order.paymentStatus === 'SUCCESS') return ctx.answerCbQuery('❌ Cannot cancel.').catch(() => {});
      await prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
      await ctx.reply('❌ Order cancelled.');
    } catch (error) {
      logger.error('Cancel error:', error);
      ctx.reply('❌ Error.').catch(() => {});
    }
  });
};
