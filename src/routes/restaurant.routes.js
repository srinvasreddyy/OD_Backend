import express from 'express';
import { 
    getRestaurants, 
    getRestaurantById,
    updateRestaurantProfile,
    toggleRestaurantStatus
} from '../controllers/restaurantController.js';
import { getAvailableSlots } from '../controllers/bookingController.js'; // <-- NEW IMPORT
import { validateRestaurant } from '../middleware/validateRestaurant.js';

const router = express.Router();

// --- Public Routes ---
router.get('/', getRestaurants);
router.get('/:id', getRestaurantById);

// New public route for checking table availability
router.get('/:restaurantId/availability', getAvailableSlots); // <-- NEW ROUTE

// --- Private Restaurant Owner Routes ---
router.put('/update-profile', validateRestaurant, updateRestaurantProfile);
router.patch('/toggle-status', validateRestaurant, toggleRestaurantStatus);


export default router;