import express from 'express';
import { 
    getRestaurants, 
    getRestaurantById,
    getRestaurantMe, // <-- NEW IMPORT
    updateRestaurantProfile,
    updateRestaurantSettings,
    toggleRestaurantStatus
} from '../controllers/restaurantController.js';
import { getAvailableSlots } from '../controllers/bookingController.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';

const router = express.Router();

// --- Public Routes ---
router.get('/', getRestaurants);
// NOTE: /:id is moved down or kept here, but /me is specific so it's safer in the private section below.

// --- Private Restaurant Owner Routes ---
// These require the user to be logged in
router.get('/me', validateRestaurant, getRestaurantMe); // <-- NEW ROUTE
router.put('/profile', validateRestaurant, updateRestaurantProfile);
router.put('/settings', validateRestaurant, updateRestaurantSettings); 
router.patch('/toggle-status', validateRestaurant, toggleRestaurantStatus);

// Public route for ID lookups (Keep this last to avoid clashing with specific paths if they were public)
router.get('/:id', getRestaurantById);
router.get('/:restaurantId/availability', getAvailableSlots);

export default router;