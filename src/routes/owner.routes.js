// src/routes/owner.routes.js
import express from 'express';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { 
    createDeliveryPartner, 
    getDeliveryPartners, 
    deleteDeliveryPartner,
    updateDeliveryPartner // <-- Import the new controller
} from '../controllers/ownerController.js';

const router = express.Router();

// All routes are protected by restaurant owner validation
router.use(validateRestaurant);

// Delivery Partner Management
router.post('/delivery-partners', createDeliveryPartner);
router.get('/delivery-partners', getDeliveryPartners);
router.put('/delivery-partners/:partnerId', updateDeliveryPartner); // <-- Add Update Route
router.delete('/delivery-partners/:partnerId', deleteDeliveryPartner);

export default router;