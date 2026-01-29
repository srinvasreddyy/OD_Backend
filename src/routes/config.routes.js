const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/config/payment-status
 * @desc    Returns global online payment status
 * @access  Public
 */
router.get('/payment-status', (req, res) => {
  // STRICT CHECK: Returns true ONLY if explicitly set to 'true' string
  const isOnlinePaymentEnabled = process.env.ENABLE_ONLINE_PAYMENTS === 'true';
  
  res.status(200).json({
    success: true,
    onlinePaymentEnabled: isOnlinePaymentEnabled,
    message: isOnlinePaymentEnabled 
      ? "Online payments are active." 
      : "Online payments are temporarily disabled."
  });
});

module.exports = router;