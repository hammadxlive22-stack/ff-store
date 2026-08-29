const { Markup } = require('telegraf');
const QRCode = require('qrcode');
const prisma = require('../../services/db');
const logger = require('../../utils/logger');
const { createPayment, verifyPayment } = require('../../services/famgateway');

module.exports = (bot) => {
  bot.action('buy_now', async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const products = await prisma.product.findMany({
        where: { isActive: true },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      });

      if (products.length === 0) {
        return ctx.reply('❌ No products available.');
      }

      const buttons = products.map((p) => [Markup.button.callback(p.name, `product_${p.id}`)]);
      await ctx.reply('🛒 Select a product:', Markup.inlineKeyboard(buttons));
    } catch (error) {
      logger.error('Buy handler error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });

  bot.action(/^product_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const productId = parseInt(ctx.match[1]);
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      });

      if (!product) return ctx.reply('❌ Product not found.');

      const planButtons = product.plans.map((plan) =>
        [Markup.button.callback(`⏱️ ${plan.durationLabel} — ₹${plan.price}`, `plan_${plan.id}`)]
      );
      planButtons.push([Markup.button.callback('🔙 Back', 'buy_now')]);

      await ctx.reply(`📦 ${product.name}\n${product.description || ''}\n\nSelect duration:`, 
        Markup.inlineKeyboard(planButtons));
    } catch (error) {
      logger.error('Product handler error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });

  bot.action(/^plan_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Plan not found.');

      const text = `🛒 <b>ORDER SUMMARY</b>\n✦━━━━━━━━━━━━━━━━✦\n\n📦 Product: ${plan.product.name}\n⏱️ Plan: ${plan.durationLabel}\n💰 Price: ₹${plan.price}`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback(`💳 Pay ₹${plan.price} via UPI`, `pay_${plan.id}`)],
        [Markup.button.callback('🔙 Back', `product_${plan.product.id}`)],
      ]);

      await ctx.replyWithHTML(text, buttons);
    } catch (error) {
      logger.error('Plan handler error:', error);
      ctx.reply('❌ An error occurred.').catch(() => {});
    }
  });

  bot.action(/^pay_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery('⌛ Creating payment QR...').catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const telegramId = BigInt(ctx.from.id);

      let user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            telegramId,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
          },
        });
      }

      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Selected plan is no longer available.');

      const generatedOrderId = `ORD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      let dbOrder = await prisma.order.create({
        data: {
          id: generatedOrderId,
          amount: plan.price,
          status: 'PENDING',
          user: { connect: { id: user.id } },
          plan: { connect: { id: plan.id } },
          product: { connect: { id: plan.productId } },
        },
      });

      const customerName = ctx.from.first_name || ctx.from.username || 'Customer';

      const gatewayResponseRaw = await createPayment({
        amount: plan.price,
        orderId: String(dbOrder.id),
        customerName,
      });

      let parsedApi;
      try {
        parsedApi = typeof gatewayResponseRaw === 'string' ? JSON.parse(gatewayResponseRaw) : gatewayResponseRaw;
      } catch (e) {
        parsedApi = gatewayResponseRaw;
      }

      const isSuccess = parsedApi.status === 'success' || parsedApi.success === true;
      
      if (!isSuccess) {
        logger.error('Payment creation failed at gateway:', parsedApi);
        return ctx.reply(`❌ Payment creation failed. Please try again.`);
      }

      const responseData = parsedApi.data || parsedApi;
      const gatewayOrderId = responseData.order_id || parsedApi.fam_order_id;

      // 🛑 Yahan se galat gatewayOrderId update hata diya hai taaki crash na ho

      const checkoutUrl = responseData.checkout_url || parsedApi.checkout_url || `https://famgateway.in/pay.php?order_id=${gatewayOrderId}`;
      const upiIntentUrl = responseData.upi_intent || parsedApi.upi_intent || responseData.qr_text || parsedApi.qr_text;
      const fallbackQrUrl = responseData.qr_url || parsedApi.qr_image;

      let photoPayload = null;
      if (upiIntentUrl) {
        const qrBuffer = await QRCode.toBuffer(upiIntentUrl, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 500,
        });
        photoPayload = { source: qrBuffer };
      } else if (fallbackQrUrl) {
        photoPayload = fallbackQrUrl; 
      }

      const payText = `<b>💳 PAYMENT DETAILS</b>\n✦━━━━━━━━━━━━━━━━✦\n\n🆔 <b>Order ID:</b> <code>${dbOrder.id}</code>\n💰 <b>Amount:</b> ₹${plan.price}\n📦 <b>Product:</b> ${plan.product.name}\n⏱️ <b>Plan:</b> ${plan.durationLabel}\n\n👇 Scan QR Code or click payment button below:`;

      const payButtons = Markup.inlineKeyboard([
        [Markup.button.url('📲 Open Payment Page', checkoutUrl)],
        [Markup.button.callback('🔄 Verify Payment', `verify_${dbOrder.id}`)],
      ]);

      if (photoPayload) {
        await ctx.replyWithPhoto(photoPayload, {
          caption: payText,
          parse_mode: 'HTML',
          ...payButtons,
        });
      } else {
        await ctx.replyWithHTML(payText, payButtons);
      }

    } catch (error) {
      logger.error('Pay handler error:', error);
      ctx.reply('❌ Failed to process payment. Please try again.').catch(() => {});
    }
  });

  bot.action(/^verify_(.+)$/, async (ctx) => {
    try {
      const orderIdParam = ctx.match[1];
      
      const order = await prisma.order.findUnique({
        where: { id: orderIdParam },
      });

      if (!order) {
        return ctx.answerCbQuery('❌ Order not found!', { show_alert: true });
      }

      if (order.status === 'COMPLETED' || order.status === 'SUCCESS') {
        return ctx.answerCbQuery('✅ Payment already received & verified!', { show_alert: true });
      }

      const statusResponse = await verifyPayment(order.id);

      let parsedStatus;
      try {
        parsedStatus = typeof statusResponse === 'string' ? JSON.parse(statusResponse) : statusResponse;
      } catch (e) {
        parsedStatus = statusResponse;
      }

      if (parsedStatus && (parsedStatus.status === 'SUCCESS' || parsedStatus.status === 'COMPLETED')) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'COMPLETED' },
        });

        await ctx.answerCbQuery('🎉 Payment Successful!', { show_alert: true });
        return ctx.reply(`✅ <b>Payment Received!</b>\n\nOrder ID: <code>${order.id}</code>\nYour license / key will be delivered shortly.`, { parse_mode: 'HTML' });
      } else {
        return ctx.answerCbQuery('⏳ PAYMENT IS STILL PENDING!\n\nPlease complete the payment in your UPI app and try again.', { show_alert: true });
      }

    } catch (error) {
      logger.error('Verify handler error:', error);
      ctx.answerCbQuery('⚠️ Could not verify payment right now. Try again later.', { show_alert: true }).catch(() => {});
    }
  });
};
