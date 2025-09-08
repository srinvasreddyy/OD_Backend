import express from 'express';
import { validateUser } from '../middleware/validateUser.js';
import { applyPromoCode } from '../controllers/promoController.js';
import featureFlags from '../config/featureFlags.js';

const router = express.Router();

if (featureFlags.ENABLE_OFFERS) {
    router.use(validateUser);
    router.post('/apply', applyPromoCode);
}

export default router;