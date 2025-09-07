import express from 'express';
import { validateDeliveryPartner } from '../middleware/validateDeliveryPartner.js';
import { 
    updateAvailabilityStatus, 
    getAssignedOrders,
    updateOrderStatusByPartner,
    updateLocation // <-- NEW IMPORT
} from '../controllers/deliveryController.js';

const router = express.Router();

// All routes are protected by delivery partner validation
router.use(validateDeliveryPartner);

// Routes
router.patch('/status', updateAvailabilityStatus);
router.patch('/location', updateLocation); 
router.get('/orders', getAssignedOrders);
router.patch('/orders/:orderId/update-status', updateOrderStatusByPartner);


export default router;