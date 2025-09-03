import express from 'express';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { createDeliveryPartner, getDeliveryPartners } from '../controllers/ownerController.js';

const router = express.Router();

// All routes are protected by restaurant owner validation
router.use(validateRestaurant);

// Delivery Partner Management
router.post('/delivery-partners', createDeliveryPartner);
router.get('/delivery-partners', getDeliveryPartners);

export default router;