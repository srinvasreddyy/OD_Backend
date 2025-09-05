// OD_Backend/src/routes/admin.routes.js
import express from 'express';
import { validateSuperAdmin } from '../middleware/validateSuperAdmin.js';
import { 
    getRestaurantsForAdmin,
    getRestaurantDetailsForAdmin,
    verifyRestaurant,
    toggleRestaurantActiveStatus,
    getAllUsers, 
    toggleUserActiveStatus 
} from '../controllers/adminController.js';

const router = express.Router();

// All routes in this file are protected by the super admin validation middleware
router.use(validateSuperAdmin);

// --- Restaurant Management Routes ---
router.get('/restaurants', getRestaurantsForAdmin);
router.get('/restaurants/:restaurantId', getRestaurantDetailsForAdmin);
router.patch('/restaurants/:restaurantId/verify', verifyRestaurant);
router.patch('/restaurants/:restaurantId/toggle-active', toggleRestaurantActiveStatus);

// --- NEW User Management Routes (FEATURE-002) ---
router.get('/users', getAllUsers);
router.patch('/users/:userId/toggle-active', toggleUserActiveStatus);


export default router;