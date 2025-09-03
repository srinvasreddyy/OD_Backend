import express from 'express';
import { validateDeliveryPartner } from '../middleware/validateDeliveryPartner.js';
import { updateAvailabilityStatus, getAssignedOrders } from '../controllers/deliveryController.js';

const router = express.Router();

// All routes are protected by delivery partner validation
router.use(validateDeliveryPartner);

// Routes
router.patch('/status', updateAvailabilityStatus);
router.get('/orders', getAssignedOrders);

export default router;