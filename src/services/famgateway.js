const axios = require('axios');
const logger = require('../utils/logger');

// Environment variables (Render dashboard mein set karo)
const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://api.famgateway.in';
const FAM_CREATE_ENDPOINT = process.env.FAMGATEWAY_CREATE_ENDPOINT || '/order/create';
const FAM_STATUS_ENDPOINT = process.env.FAMGATEWAY_STATUS_ENDPOINT || '/order/status/';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

/**
 * Create a payment order via FamGateway.
 * @param {object} params
 * @param {number|string} params.amount - Amount in INR (decimal)
 * @param {string} params.orderId - Internal order UUID
 * @param {string} params.customerName - Customer name
 * @returns {Promise<object>} { success, fam_order_id, qr_text, qr_image, payment_url, error? }
 */
async function createPayment({ amount, orderId, customerName }) {
  try {
    // Convert amount to number (required by FamGateway)
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      logger.error(`Invalid amount provided: ${amount}`);
      return { success: false, error: 'Invalid amount' };
    }

    // Optional: If FamGateway expects paise (integer), uncomment next line
    // const amountInPaise = Math.round(numericAmount * 100);

    const payload = {
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,                    // internal UUID
      amount: numericAmount,                // ✅ number (e.g., 1, 50, 100.5)
      customer_name: customerName,
      currency: 'INR',
      // Add these if required by docs:
      // webhook_url: `${process.env.WEBHOOK_URL}/payment/webhook`,
      // redirect_url: 'https://your-callback-url.com',
    };

    const url = `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`;
    logger.info(`FamGateway Request URL: ${url}`);
    logger.info(`FamGateway Payload:`, payload);

    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      params: {
        api_key: FAM_API_KEY,               // ✅ query param
      },
    });

    logger.info('FamGateway create response:', response.data);

    // Extract gateway's own order ID (may be named differently)
    const famOrderId = response.data.fam_order_id || 
                       response.data.gateway_order_id || 
                       response.data.order_id;

    if (!famOrderId) {
      logger.error('FamGateway response did not contain gateway order ID:', response.data);
      return { success: false, error: 'Invalid response from gateway' };
    }

    return {
      success: true,
      fam_order_id: famOrderId,             // ✅ store in DB
      qr_text: response.data.qr_text || response.data.upi_link || response.data.payment_link || response.data.qr_code,
      qr_image: response.data.qr_image || response.data.qr_code_image || null,
      payment_url: response.data.payment_url || response.data.redirect_url || null,
    };
  } catch (error) {
    logger.error('FamGateway create payment error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    return { 
      success: false, 
      error: error.response?.data?.message || error.response?.data?.error || 'Payment creation failed' 
    };
  }
}

/**
 * Verify payment status via FamGateway.
 * @param {string} famOrderId - Gateway order ID
 * @returns {Promise<object>} { status: 'SUCCESS'|'PENDING'|'FAILED'|'EXPIRED' }
 */
async function verifyPayment(famOrderId) {
  try {
    logger.info(`Verifying FamGateway payment: ${famOrderId}`);

    const url = `${FAM_BASE_URL}${FAM_STATUS_ENDPOINT}${famOrderId}`;
    logger.info(`FamGateway Verify URL: ${url}`);

    const response = await axios.get(url, {
      headers: { 'Content-Type': 'application/json' },
      params: { api_key: FAM_API_KEY },
    });

    logger.info('FamGateway verify response:', response.data);

    const rawStatus = response.data.status || response.data.payment_status || '';
    const statusUpper = String(rawStatus).toUpperCase();

    let status;
    if (['SUCCESS', 'COMPLETED', 'PAID'].includes(statusUpper)) status = 'SUCCESS';
    else if (['FAILED', 'CANCELLED', 'REJECTED'].includes(statusUpper)) status = 'FAILED';
    else if (['EXPIRED'].includes(statusUpper)) status = 'EXPIRED';
    else status = 'PENDING';

    return { status };
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
