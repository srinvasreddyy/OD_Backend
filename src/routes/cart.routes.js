import express from 'express';
import {
    addItemToCart,
    getCart,
    getCartSummary,
    updateItemQuantity,
    removeItemFromCart,
    clearCart
} from '../controllers/cartController.js';
import { validateUser } from '../middleware/validateUser.js';

const router = express.Router();

// Apply the validateUser middleware to all cart routes to ensure the user is authenticated.
router.use(validateUser);

// --- Cart Routes ---

// GET /api/cart - Retrieve the full details of the user's carts
router.get('/', getCart);

// GET /api/cart/summary - Get a calculated summary of the cart (subtotal, tax, total)
router.get('/summary', getCartSummary);

// POST /api/cart/add - Add a new item to the cart or increment an existing one
router.post('/add', addItemToCart);

// PUT /api/cart/update-quantity - Update the quantity of a specific item in the cart
router.put('/update-quantity', updateItemQuantity);

// DELETE /api/cart/remove-item - Remove a specific item from the cart
router.delete('/remove-item', removeItemFromCart);

// DELETE /api/cart/clear - Clear all items from a specified cart (food or groceries)
router.delete('/clear', clearCart);

export default router;
