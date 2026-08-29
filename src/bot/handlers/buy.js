const { Markup } = require('telegraf');
const prisma = require('../../services/db');
const logger = require('../../utils/logger');
const { createPayment } = require('../../services/famgateway'); // FamGateway Service

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

  // ✅ HANDLER: Pay Action Logic to create Order and call FamGateway
  bot.action(/^pay_(\d+)$/, async (ctx) => {
    ctx.answerCbQuery('⌛ Creating payment QR...').catch(() => {});

    try {
      const planId = parseInt(ctx.match[1]);
      const telegramId = BigInt(ctx.from.id);

      // 1. Ensure User exists in DB
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

      // 2. Fetch Plan Details
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: { product: true },
      });

      if (!plan) return ctx.reply('❌ Selected plan is no longer available.');

      // 3. Unique Order ID String for Gateway
      const generatedOrderId = `ORD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // 4. Create Local DB Pending Order (Fixed: Removed invalid `orderId` field)
      const dbOrder = await prisma.order.create({
        data: {
          id: generatedOrderId, // Agar schema me `id` String hai to custom orderId id me jayegi
          amount: plan.price,
          status: 'PENDING',
          user: { connect: { id: user.id } },
          plan: { connect: { id: plan.id } },
          product: { connect: { id: plan.productId } },
        },
      }).catch(async (err) => {
        // Agar schema me `id` auto-generated (cuid/autoincrement) hai to bina custom ID ke create karega
        return await prisma.order.create({
          data: {
            amount: plan.price,
            status: 'PENDING',
            user: { connect: { id: user.id } },
            plan: { connect: { id: plan.id } },
            product: { connect: { id: plan.productId } },
          },
        });
      });

      const finalOrderId = dbOrder.id || generatedOrderId;

      // 5. Customer Name Fallback
      const customerName = ctx.from.first_name || ctx.from.username || 'Customer';

      // 6. Call FamGateway API
      const gatewayResponse = await createPayment({
        amount: plan.price,
        orderId: String(finalOrderId),
        customerName,
      });

      if (!gatewayResponse.success) {
        logger.error('Payment creation failed at gateway:', gatewayResponse.error);
        return ctx.reply(`❌ Payment creation failed: ${gatewayResponse.error}`);
      }

      // 7. Save FamGateway Order ID in DB (if field exists in schema)
      try {
        await prisma.order.update({
          where: { id: dbOrder.id },
          data: { gatewayOrderId: gatewayResponse.fam_order_id },
        });
      } catch (e) {
        // Fallback if gatewayOrderId column isn't present in schema
      }

      // 8. Send QR Code & Payment Link
      const payText = `<b>💳 PAYMENT DETAILS</b>\n✦━━━━━━━━━━━━━━━━✦\n\n🆔 <b>Order ID:</b> <code>${finalOrderId}</code>\n💰 <b>Amount:</b> ₹${plan.price}\n📦 <b>Product:</b> ${plan.product.name}\n⏱️ <b>Plan:</b> ${plan.durationLabel}\n\n👇 Scan QR Code or click payment button below:`;

      const payButtons = Markup.inlineKeyboard([
        [Markup.button.url('📲 Open UPI Payment', gatewayResponse.qr_text || gatewayResponse.payment_url || '#')],
        [Markup.button.callback('🔄 Verify Payment', `verify_${dbOrder.id}`)],
      ]);

      if (gatewayResponse.qr_image) {
        await ctx.replyWithPhoto(gatewayResponse.qr_image, {
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
};
