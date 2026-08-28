const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://famgateway.in';
const FAM_CREATE_ENDPOINT = process.env.FAMGATEWAY_CREATE_ENDPOINT || '/api/qr.php';
const FAM_STATUS_ENDPOINT = process.env.FAMGATEWAY_STATUS_ENDPOINT || '/api/status.php';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      logger.error(`Invalid amount: ${amount}`);
      return { success: false, error: 'Invalid amount' };
    }

    // Amount in rupees (decimal) as string with two decimals
    const amountString = numericAmount.toFixed(2); // e.g., "50.00"

    // Build query parameters (GET request)
    const params = {
      api_key: FAM_API_KEY,
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,
      amount: amountString,          // "50.00"
      customer_name: customerName,
      // currency: 'INR',  // if needed, add here
    };

    const url = `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`;
    logger.info(`FamGateway Request URL: ${url}`);
    logger.info(`FamGateway Query Params:`, params);

    // ✅ Use GET request with query parameters
    const response = await axios.get(url, { params });

    logger.info('FamGateway create response:', response.data);

    // Response might be JSON or plain text; adjust parsing
    let data = response.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { /* keep as string */ }
    }

    const famOrderId = data.fam_order_id || data.gateway_order_id || data.order_id || data.qr_id;
    if (!famOrderId) {
      logger.error('FamGateway response missing gateway order ID:', data);
      return { success: false, error: 'Invalid gateway response' };
    }

    return {
      success: true,
      fam_order_id: famOrderId,
      qr_text: data.qr_text || data.upi_link || data.payment_link || data.qr_code || data.qr,
      qr_image: data.qr_image || data.qr_code_image || null,
      payment_url: data.payment_url || data.redirect_url || null,
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
    const url = `${FAM_BASE_URL}${FAM_STATUS_ENDPOINT}`;
    const params = {
      api_key: FAM_API_KEY,
      order_id: famOrderId, // or gateway order id
    };

    logger.info(`FamGateway Verify URL: ${url}`);
    logger.info(`FamGateway Verify Params:`, params);

    const response = await axios.get(url, { params });

    logger.info('FamGateway verify response:', response.data);

    let data = response.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { /* ignore */ }
    }

    const rawStatus = data.status || data.payment_status || '';
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
