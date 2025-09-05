import express from 'express';
import { validateUser } from '../middleware/validateUser.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { 
    createBookingCheckoutSession,
    confirmBooking,
    getCustomerBookings,
    getRestaurantBookings,
    cancelBookingByUser,
    cancelBookingByOwner
} from '../controllers/bookingController.js';

const router = express.Router();

// --- Customer-Facing Routes ---
router.post('/create-checkout-session', validateUser, createBookingCheckoutSession);
router.post('/confirm-booking', validateUser, confirmBooking);
router.get('/my-bookings', validateUser, getCustomerBookings);
router.patch('/:bookingId/cancel', validateUser, cancelBookingByUser);

// --- Restaurant-Owner-Facing Routes ---
router.get('/restaurant', validateRestaurant, getRestaurantBookings);
router.patch('/restaurant/:bookingId/cancel', validateRestaurant, cancelBookingByOwner);


export default router;