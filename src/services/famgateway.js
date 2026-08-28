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
    const amountString = numericAmount.toFixed(2); // "1.00", "50.00"

    const params = {
      api_key: FAM_API_KEY,
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,           // internal UUID
      amount: amountString,
      customer_name: customerName,
      // currency: 'INR', // add if required
    };

    const url = `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`;
    logger.info(`FamGateway Request URL: ${url}`);
    logger.info(`FamGateway Params:`, params);

    // ✅ GET request (as per API)
    const response = await axios.get(url, { params });

    logger.info('FamGateway create response:', response.data);

    // ✅ Parse nested response: response.data.data.order_id
    const apiData = response.data?.data || response.data; // fallback if no nesting
    const gatewayOrderId = apiData.order_id || apiData.fam_order_id || apiData.gateway_order_id;

    if (!gatewayOrderId) {
      logger.error('FamGateway response missing gateway order ID:', response.data);
      return { success: false, error: 'Invalid gateway response' };
    }

    return {
      success: true,
      fam_order_id: gatewayOrderId,          // ✅ store this in DB
      qr_text: apiData.upi_intent || apiData.qr_text || apiData.upi_link || apiData.payment_link,
      qr_image: apiData.qr_url || apiData.qr_image || apiData.qr_code_image || null,
      payment_url: apiData.checkout_url || apiData.payment_url || apiData.redirect_url || null,
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
      order_id: famOrderId, // gateway order ID (e.g., fg_LLW8FR7M)
    };

    logger.info(`FamGateway Verify URL: ${url}`);
    logger.info(`FamGateway Verify Params:`, params);

    const response = await axios.get(url, { params });

    logger.info('FamGateway verify response:', response.data);

    const apiData = response.data?.data || response.data;
    const rawStatus = apiData.status || apiData.payment_status || '';
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
