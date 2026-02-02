// src/routes/owner.routes.js
import express from 'express';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { 
    createDeliveryPartner, 
    getDeliveryPartners, 
    deleteDeliveryPartner,
    updateDeliveryPartner,
    createStripeOnboardingLink,
    createStripeLoginLink,
    syncStripeAccount // <--- Added import
} from '../controllers/ownerController.js';

const router = express.Router();

// All routes are protected by restaurant owner validation
router.use(validateRestaurant);

// Stripe Connect Routes
router.post('/stripe-connect/onboarding-link', createStripeOnboardingLink);
router.post('/stripe-connect/login-link', createStripeLoginLink);
router.post('/stripe-connect/sync', syncStripeAccount); // <--- Added route

// Delivery Partner Management
router.post('/delivery-partners', createDeliveryPartner);
router.get('/delivery-partners', getDeliveryPartners);
router.put('/delivery-partners/:partnerId', updateDeliveryPartner);
router.delete('/delivery-partners/:partnerId', deleteDeliveryPartner);

export default router;