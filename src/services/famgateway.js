const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://famgateway.in';
const FAM_CREATE_ENDPOINT = process.env.FAMGATEWAY_CREATE_ENDPOINT || '/api/qr.php';
const FAM_STATUS_ENDPOINT = process.env.FAMGATEWAY_STATUS_ENDPOINT || '/api/status.php/';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      logger.error(`Invalid amount: ${amount}`);
      return { success: false, error: 'Invalid amount' };
    }

    // ✅ Convert to paise (integer)
    const amountInPaise = Math.round(numericAmount * 100);
    logger.info(`Amount in paise: ${amountInPaise}`);

    const payload = {
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,
      amount: amountInPaise,        // ✅ integer paise, no decimal
      customer_name: customerName,
      // currency: 'INR', // optional, remove if not needed
    };

    const url = `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`;
    logger.info(`FamGateway Request URL: ${url}`);
    logger.info(`FamGateway Payload:`, payload);

    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      params: { api_key: FAM_API_KEY },
    });

    logger.info('FamGateway create response:', response.data);

    const famOrderId = response.data.fam_order_id || 
                       response.data.gateway_order_id || 
                       response.data.order_id;

    if (!famOrderId) {
      logger.error('FamGateway response missing gateway order ID:', response.data);
      return { success: false, error: 'Invalid gateway response' };
    }

    return {
      success: true,
      fam_order_id: famOrderId,
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

async function verifyPayment(famOrderId) {
  try {
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
