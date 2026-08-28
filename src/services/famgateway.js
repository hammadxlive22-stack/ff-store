const axios = require('axios');
const logger = require('../utils/logger');

// Base URL and endpoint configuration
const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://api.famgateway.in';
const FAM_CREATE_ENDPOINT = process.env.FAMGATEWAY_CREATE_ENDPOINT || '/order/create'; // adjust as per docs
const FAM_STATUS_ENDPOINT = process.env.FAMGATEWAY_STATUS_ENDPOINT || '/order/status'; // adjust

const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    logger.info(`Creating FamGateway payment for order: ${orderId}`);

    const payload = {
      merchant_id: FAM_MERCHANT_ID,
      order_id: orderId,
      amount: amount,
      customer_name: customerName,
      currency: 'INR',
      // webhook_url: `${process.env.WEBHOOK_URL}/payment/webhook`, // optional
      // redirect_url: 'https://your-callback-url.com',
    };

    // Log request details (remove in production)
    logger.info('Request URL:', `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`);
    logger.info('Request payload:', payload);

    const response = await axios.post(
      `${FAM_BASE_URL}${FAM_CREATE_ENDPOINT}`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${FAM_API_KEY}`,
          'Content-Type': 'application/json',
          // Some APIs use x-api-key or other headers; adjust accordingly
        },
      }
    );

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
        'Authorization': `Bearer ${FAM_API_KEY}`,
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
