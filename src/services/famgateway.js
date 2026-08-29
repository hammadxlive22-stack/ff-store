const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://famgateway.in';
const FAM_CREATE_ENDPOINT = process.env.FAMGATEWAY_CREATE_ENDPOINT || '/api/qr.php';
const FAM_STATUS_ENDPOINT = process.env.FAMGATEWAY_STATUS_ENDPOINT || '/api/status.php';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

// Helper function to sanitize customer name for FamGateway DB
function sanitizeName(name) {
  if (!name) return 'Customer';
  // Remove special symbols, emojis, fancy unicode fonts
  const cleanName = String(name).replace(/[^\w\s]/gi, '').trim();
  return cleanName.length > 0 ? cleanName : 'Customer';
}

async function createPayment({ amount, orderId, customerName }) {
  try {
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      logger.error(`Invalid amount: ${amount}`);
      return { success: false, error: 'Invalid amount' };
    }
    const amountString = numericAmount.toFixed(2); // "1.00", "50.00"

    // Sanitize name to prevent FamGateway SQL/DB crash
    const safeCustomerName = sanitizeName(customerName);

    const params = {
      api_key: FAM_API_KEY,
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,           // internal UUID
      amount: amountString,
      customer_name: safeCustomerName,
    };

    const url = `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`;
    logger.info(`FamGateway Request URL: ${url}`);
    logger.info(`FamGateway Params:`, params);

    // ✅ GET request
    const response = await axios.get(url, { params });

    logger.info('FamGateway create response:', response.data);

    // Check if FamGateway internally returned error inside 200 response
    if (response.data?.status === 'error' || response.data?.status === 500) {
      logger.error('FamGateway Internal Error:', response.data);
      return { 
        success: false, 
        error: response.data?.message || 'Gateway Database Error' 
      };
    }

    const apiData = response.data?.data || response.data;
    const gatewayOrderId = apiData.order_id || apiData.fam_order_id || apiData.gateway_order_id;

    if (!gatewayOrderId) {
      logger.error('FamGateway response missing gateway order ID:', response.data);
      return { success: false, error: 'Invalid gateway response' };
    }

    return {
      success: true,
      fam_order_id: gatewayOrderId,
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
      order_id: famOrderId,
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
