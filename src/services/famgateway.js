const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://api.famgateway.com/v1';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    logger.info(`Creating FamGateway payment for order: ${orderId}`);

    // ⚠️ Replace with actual endpoint & payload from FamGateway docs
    const response = await axios.post(
      `${FAM_BASE_URL}/order/create`,
      {
        merchant_id: FAM_MERCHANT_ID,
        order_id: orderId,
        amount: amount,
        customer_name: customerName,
        currency: 'INR',
        // Add any other required fields
      },
      {
        headers: {
          'Authorization': `Bearer ${FAM_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // ⚠️ Adjust response mapping as per actual API
    return {
      success: true,
      fam_order_id: response.data.order_id, // or response.data.fam_order_id
      qr_text: response.data.qr_text || response.data.upi_link,
      qr_image: response.data.qr_image || null, // base64 or URL
      payment_url: response.data.payment_url || null,
    };
  } catch (error) {
    logger.error('FamGateway create payment error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.message || 'Payment creation failed' };
  }
}

async function verifyPayment(famOrderId) {
  try {
    logger.info(`Verifying FamGateway payment: ${famOrderId}`);

    // ⚠️ Replace with actual status endpoint
    const response = await axios.get(
      `${FAM_BASE_URL}/order/status/${famOrderId}`,
      {
        headers: {
          'Authorization': `Bearer ${FAM_API_KEY}`,
        },
      }
    );

    // ⚠️ Map status to SUCCESS/PENDING/FAILED/EXPIRED
    const status = response.data.status; // e.g., 'SUCCESS', 'PENDING', 'FAILED', 'EXPIRED'
    return { status };
  } catch (error) {
    logger.error('FamGateway verify error:', error.response?.data || error.message);
    return { status: 'FAILED' };
  }
}

// Optional webhook handler
async function handleWebhook(payload) {
  // Verify signature, update database accordingly
  // This will be called from a route
}

module.exports = { createPayment, verifyPayment, handleWebhook };
