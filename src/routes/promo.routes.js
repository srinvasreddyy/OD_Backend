import express from 'express';
import { validateUser } from '../middleware/validateUser.js';
import { applyPromoCode } from '../controllers/promoController.js';

const router = express.Router();

// Validates user session for all promo routes
router.use(validateUser);

// Route to apply promo code
router.post('/apply', applyPromoCode);

export default router;