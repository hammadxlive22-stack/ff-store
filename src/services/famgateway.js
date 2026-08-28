const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://api.famgateway.in';
const FAM_CREATE_ENDPOINT = process.env.FAMGATEWAY_CREATE_ENDPOINT || '/order/create';
const FAM_STATUS_ENDPOINT = process.env.FAMGATEWAY_STATUS_ENDPOINT || '/order/status/';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    logger.info(`Creating FamGateway payment for order: ${orderId}`);

    const payload = {
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,           // internal order ID (UUID)
      amount: amount,
      customer_name: customerName,
      currency: 'INR',
    };

    const url = `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`;
    logger.info('Request URL:', url);
    logger.info('Request payload:', payload);

    // Auth via api_key query parameter (common for such APIs)
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      params: {
        api_key: FAM_API_KEY,      // ✅ add api_key as query param
      },
    });

    logger.info('FamGateway create response:', response.data);

    return {
      success: true,
      fam_order_id: response.data.fam_order_id || response.data.gateway_order_id || response.data.order_id,
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
    return { success: false, error: error.response?.data?.message || error.response?.data?.error || 'Payment creation failed' };
  }
}

async function verifyPayment(famOrderId) {
  try {
    logger.info(`Verifying FamGateway payment: ${famOrderId}`);

    const url = `${FAM_BASE_URL}${FAM_STATUS_ENDPOINT}${famOrderId}`;
    logger.info('Verify URL:', url);

    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      params: {
        api_key: FAM_API_KEY,
      },
    });

    logger.info('FamGateway verify response:', response.data);

    const status = (response.data.status || response.data.payment_status || '').toUpperCase();
    let result;
    if (['SUCCESS', 'COMPLETED', 'PAID'].includes(status)) result = 'SUCCESS';
    else if (['FAILED', 'CANCELLED', 'REJECTED'].includes(status)) result = 'FAILED';
    else if (['EXPIRED'].includes(status)) result = 'EXPIRED';
    else result = 'PENDING';

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
