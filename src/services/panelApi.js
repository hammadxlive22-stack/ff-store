const axios = require('axios');
const logger = require('../utils/logger');

// 🔑 Calls the real reseller panel to generate/buy a key for a paid order.
// Matches the exact contract of https://bantibhaiya.to/api/reseller_v1.php
// Shared by: the "I Have Paid" flow (payment.js) AND the admin Approve flow (admin.js)
async function generateKeyFromPanel(order) {
  const params = new URLSearchParams({
    api_key: process.env.PANEL_API_KEY,
    action: 'buy',
    product_id: order.product.panelProductId || String(order.product.id),
    duration: order.plan.durationLabel, // e.g. "1 Day", "3 Hours", "12 Hours"
  });

  // android_id is required ONLY for device-bound / V1 products
  if (order.product.requiresAndroidId && order.androidId) {
    params.append('android_id', order.androidId);
  }

  const panelResponse = await axios.post(
    'https://bantibhaiya.to/api/reseller_v1.php',
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-master-key': process.env.PANEL_MASTER_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 20000,
      maxRedirects: 5,
    }
  );

  const panelData = panelResponse.data;
  logger.info('Panel API response:', panelData);

  if (panelData && typeof panelData === 'object') {
    if (panelData.status === false || panelData.error || panelData.msg) {
      return { success: false, text: `⚠️ Panel Error: ${panelData.error || panelData.msg || JSON.stringify(panelData)}` };
    }
    return { success: true, text: panelData.key || panelData.license || JSON.stringify(panelData) };
  }

  // Some panels return the key as raw text instead of JSON
  return { success: true, text: String(panelData) };
}

module.exports = { generateKeyFromPanel };
