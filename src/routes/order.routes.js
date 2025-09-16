import express from 'express';
import {
    getUserOrders,
    getOrderDetails,
    cancelOrder,
    placeCashOrder, // <-- NEW IMPORT
    getRestaurantOrders,
    getNewRestaurantOrders,
    respondToOrder,
    updateOrderStatus,
    assignDeliveryPartner,
    getRestaurantStats,
    getRestaurantSalesReport,
    getRestaurantOrdersReport,
    getMenuItemPerformance
} from '../controllers/orderController.js';
import { validateUser } from '../middleware/validateUser.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';

const router = express.Router();

// --- Restaurant-Facing Routes (Protected by validateRestaurant) ---
router.get('/restaurant/stats', validateRestaurant, getRestaurantStats);
router.get('/restaurant/reports/sales', validateRestaurant, getRestaurantSalesReport);
router.get('/restaurant/reports/orders', validateRestaurant, getRestaurantOrdersReport);
router.get('/restaurant/reports/menu-performance', validateRestaurant, getMenuItemPerformance);
router.get('/restaurant/new', validateRestaurant, getNewRestaurantOrders);
router.get('/restaurant', validateRestaurant, getRestaurantOrders);
router.get('/restaurant/:orderId', validateRestaurant, getOrderDetails); 
router.patch('/:orderId/respond', validateRestaurant, respondToOrder);
router.patch('/:orderId/status', validateRestaurant, updateOrderStatus);
router.patch('/:orderId/assign-delivery', validateRestaurant, assignDeliveryPartner);


// --- Customer-Facing Routes (Protected by validateUser) ---
// The POST for card-based orders is handled by the Stripe webhook.
router.post('/place-cash-order', validateUser, placeCashOrder); 
router.get('/my-orders', validateUser, getUserOrders);
router.get('/:orderId', validateUser, getOrderDetails); 
router.patch('/:orderId/cancel', validateUser, cancelOrder);


export default router;