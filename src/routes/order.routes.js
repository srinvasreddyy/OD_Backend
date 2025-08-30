import express from 'express';
import {
    placeOrder,
    getUserOrders, // Changed from getMyOrders
    getOrderDetails, // Changed from getOrderById
    cancelOrder,
    getRestaurantOrders,
    getNewRestaurantOrders,
    respondToOrder,
    updateOrderStatus,
    assignDeliveryPartner,
    getRestaurantStats
} from '../controllers/orderController.js';
import { validateUser } from '../middleware/validateUser.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';

const router = express.Router();

// --- Customer-Facing Routes (Protected by validateUser) ---
// These routes are for actions performed by the logged-in customer.

// POST /api/orders/place-order - Place a new order from the cart
router.post('/place-order', validateUser, placeOrder);

// GET /api/orders/my-orders - Retrieve the order history for the logged-in customer
router.get('/my-orders', validateUser, getUserOrders);

// GET /api/orders/:orderId - Get details of a specific order placed by the customer
router.get('/:orderId', validateUser, getOrderDetails);

// PATCH /api/orders/:orderId/cancel - Allow a customer to cancel their own order
router.patch('/:orderId/cancel', validateUser, cancelOrder);


// --- Restaurant-Facing Routes (Protected by validateRestaurant) ---
// These routes are for actions performed by the logged-in restaurant owner.

// GET /api/orders/restaurant/stats - Get sales and order statistics for the restaurant
router.get('/restaurant/stats', validateRestaurant, getRestaurantStats);

// GET /api/orders/restaurant/new - Get all new orders that need acceptance
router.get('/restaurant/new', validateRestaurant, getNewRestaurantOrders);

// GET /api/orders/restaurant - Get all orders associated with the restaurant
router.get('/restaurant', validateRestaurant, getRestaurantOrders);

// PATCH /api/orders/:orderId/respond - Accept or reject a new incoming order
router.patch('/:orderId/respond', validateRestaurant, respondToOrder);

// PATCH /api/orders/:orderId/status - Update the status of an order (e.g., preparing, ready)
router.patch('/:orderId/status', validateRestaurant, updateOrderStatus);

// PATCH /api/orders/:orderId/assign-delivery - Assign a delivery partner to an order
router.patch('/:orderId/assign-delivery', validateRestaurant, assignDeliveryPartner);

export default router;