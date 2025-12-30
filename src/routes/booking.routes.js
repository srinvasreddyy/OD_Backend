import express from 'express';
import { validateUser } from '../middleware/validateUser.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { 
    createBookingCheckoutSession,
    confirmBooking,
    handleBookingFailure, // <-- Imported
    getCustomerBookings,
    getRestaurantBookings,
    cancelBookingByUser,
    cancelBookingByOwner,
    getAvailableSlots 
} from '../controllers/bookingController.js';

const router = express.Router();

// --- Public Routes ---
router.get('/available-slots/:restaurantId', getAvailableSlots);

// --- Customer-Facing Routes (Protected) ---
router.post('/create-checkout-session', validateUser, createBookingCheckoutSession);
router.post('/confirm-booking', validateUser, confirmBooking);
router.post('/fail-booking', validateUser, handleBookingFailure); // <-- NEW Route
router.get('/my-bookings', validateUser, getCustomerBookings);
router.patch('/:bookingId/cancel', validateUser, cancelBookingByUser);

// --- Restaurant-Owner-Facing Routes (Protected) ---
router.get('/restaurant', validateRestaurant, getRestaurantBookings);
router.patch('/restaurant/:bookingId/cancel', validateRestaurant, cancelBookingByOwner);

export default router;