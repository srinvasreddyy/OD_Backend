// OD_Backend/src/routes/admin.routes.js
import express from 'express';
import { validateSuperAdmin } from '../middleware/validateSuperAdmin.js';
import { 
    getRestaurantsForAdmin,
    getRestaurantDetailsForAdmin,
    verifyRestaurant,
    toggleRestaurantActiveStatus
} from '../controllers/adminController.js';

const router = express.Router();

// All routes in this file are protected by the super admin validation middleware
router.use(validateSuperAdmin);

// GET routes
router.get('/restaurants', getRestaurantsForAdmin);
router.get('/restaurants/:restaurantId', getRestaurantDetailsForAdmin);

// PATCH routes for updates
router.patch('/restaurants/:restaurantId/verify', verifyRestaurant);
router.patch('/restaurants/:restaurantId/toggle-active', toggleRestaurantActiveStatus);

export default router;