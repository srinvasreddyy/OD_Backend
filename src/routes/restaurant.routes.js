import express from 'express';
import { 
    getRestaurants, 
    getRestaurantById,
    updateRestaurantProfile,
    updateRestaurantSettings, // <-- NEW IMPORT
    toggleRestaurantStatus
} from '../controllers/restaurantController.js';
import { getAvailableSlots } from '../controllers/bookingController.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';

const router = express.Router();

// --- Public Routes ---
router.get('/', getRestaurants);
router.get('/:id', getRestaurantById);
router.get('/:restaurantId/availability', getAvailableSlots);

// --- Private Restaurant Owner Routes ---
router.put('/profile', validateRestaurant, updateRestaurantProfile);
router.put('/settings', validateRestaurant, updateRestaurantSettings); 
router.patch('/toggle-status', validateRestaurant, toggleRestaurantStatus);


export default router;