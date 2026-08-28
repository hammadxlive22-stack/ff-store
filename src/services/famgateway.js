const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://api.famgateway.com/v1';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    logger.info(`Creating FamGateway payment for order: ${orderId}`);

    // Prepare request payload (adjust as per actual FamGateway docs)
    const payload = {
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,           // internal order ID (UUID)
      amount: amount,
      customer_name: customerName,
      currency: 'INR',
      // Add other fields like redirect_url, webhook_url if needed
    };

    // Make API call
    const response = await axios.post(
      `${FAM_BASE_URL}/order/create`,   // adjust endpoint if different
      payload,
      {
        headers: {
          // Common auth methods:
          // 1. Bearer token
          'Authorization': `Bearer ${FAM_API_KEY}`,
          // 2. API key in custom header (e.g., 'x-api-key')
          // 'x-api-key': FAM_API_KEY,
          // 3. Query parameter (some gateways use ?api_key=)
          'Content-Type': 'application/json',
        },
      }
    );

    // Log full response for debugging
    logger.info('FamGateway create response:', JSON.stringify(response.data));

    // Map response fields (adjust according to actual API)
    return {
      success: true,
      fam_order_id: response.data.fam_order_id || response.data.gateway_order_id || response.data.order_id, // gateway's own ID
      internal_order_id: orderId, // preserve internal ID
      qr_text: response.data.qr_text || response.data.upi_link || response.data.payment_link,
      qr_image: response.data.qr_image || response.data.qr_code || null,
      payment_url: response.data.payment_url || response.data.redirect_url || null,
    };
  } catch (error) {
    // Log detailed error information
    logger.error('FamGateway create payment error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });
    return { 
      success: false, 
      error: error.response?.data?.message || error.response?.data?.error || 'Payment creation failed' 
    };
  }
}

async function verifyPayment(famOrderId) {
  try {
    logger.info(`Verifying FamGateway payment: ${famOrderId}`);

    // Make status check API call (adjust endpoint)
    const response = await axios.get(
      `${FAM_BASE_URL}/order/status/${famOrderId}`,
      {
        headers: {
          'Authorization': `Bearer ${FAM_API_KEY}`,
        },
      }
    );

    logger.info('FamGateway verify response:', JSON.stringify(response.data));

    // Map status (adjust according to actual API)
    const status = (response.data.status || response.data.payment_status || '').toUpperCase();
    let result;
    if (['SUCCESS', 'COMPLETED', 'PAID'].includes(status)) {
      result = 'SUCCESS';
    } else if (['FAILED', 'CANCELLED', 'REJECTED'].includes(status)) {
      result = 'FAILED';
    } else if (['EXPIRED'].includes(status)) {
      result = 'EXPIRED';
    } else {
      result = 'PENDING';
    }
    return { status: result };
  } catch (error) {
    logger.error('FamGateway verify error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    return { status: 'FAILED' };
  }
}

module.exports = { createPayment, verifyPayment };
