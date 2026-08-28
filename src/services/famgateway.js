const axios = require('axios');
const logger = require('../utils/logger');

const FAM_BASE_URL = process.env.FAMGATEWAY_BASE_URL || 'https://api.famgateway.com/v1';
const FAM_API_KEY = process.env.FAMGATEWAY_API_KEY;
const FAM_MERCHANT_ID = process.env.FAMGATEWAY_MERCHANT_ID;

async function createPayment({ amount, orderId, customerName }) {
  try {
    logger.info(`Creating payment for order: ${orderId}`);

    // Production API call
    /*
    const response = await axios.post(
      `${FAM_BASE_URL}/order/create`,
      {
        merchant_id: FAM_MERCHANT_ID,
        order_id: orderId,
        amount: amount,
        customer_name: customerName,
        currency: 'INR',
      },
      {
        headers: {
          'Authorization': `Bearer ${FAM_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
    */

    // Mock response
    return {
      success: true,
      fam_order_id: `FAM_${orderId.slice(0, 8)}_${Date.now()}`,
      qr_text: `upi://pay?pa=ffstore@upi&pn=FF%20STORE&am=${amount}&cu=INR`,
      payment_url: `https://pay.famgateway.com/${orderId.slice(0, 8)}`,
    };
  } catch (error) {
    logger.error('FamGateway create error:', error);
    throw new Error('Failed to create payment');
  }
}

async function verifyPayment(famOrderId) {
  try {
    logger.info(`Verifying payment: ${famOrderId}`);

    // Production API call
    /*
    const response = await axios.get(
      `${FAM_BASE_URL}/order/status/${famOrderId}`,
      {
        headers: {
          'Authorization': `Bearer ${FAM_API_KEY}`,
        },
      }
    );
    return response.data;
    */

    // Mock response
    return {
      status: 'SUCCESS',
      fam_order_id: famOrderId,
      transaction_id: `TXN_${Date.now()}`,
    };
  } catch (error) {
    logger.error('FamGateway verify error:', error);
    return { status: 'FAILED' };
  }
}

module.exports = { createPayment, verifyPayment };