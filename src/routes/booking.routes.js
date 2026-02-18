import express from 'express';
import { validateUser } from '../middleware/validateUser.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { 
    createBookingCheckoutSession,
    confirmBooking,
    handleBookingFailure,
    getCustomerBookings,
    getRestaurantBookings,
    cancelBookingByUser,
    cancelBookingByOwner,
    completeBooking,
    expireBooking, // <-- Import
    getAvailableSlots 
} from '../controllers/bookingController.js';

const router = express.Router();

// --- Public Routes ---
router.get('/available-slots/:restaurantId', getAvailableSlots);

// --- Customer-Facing Routes ---
router.post('/create-checkout-session', validateUser, createBookingCheckoutSession);
router.post('/confirm-booking', validateUser, confirmBooking);
router.post('/fail-booking', validateUser, handleBookingFailure);
router.get('/my-bookings', validateUser, getCustomerBookings);
router.patch('/:bookingId/cancel', validateUser, cancelBookingByUser);

// --- Restaurant-Owner-Facing Routes ---
router.get('/restaurant', validateRestaurant, getRestaurantBookings);
router.patch('/restaurant/:bookingId/cancel', validateRestaurant, cancelBookingByOwner); 
router.patch('/restaurant/:bookingId/complete', validateRestaurant, completeBooking);
router.patch('/restaurant/:bookingId/expire', validateRestaurant, expireBooking); // <-- NEW ROUTE

export default router;