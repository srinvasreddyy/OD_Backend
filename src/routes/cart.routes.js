import express from 'express';
import { addItemToCart, getCart, updateItemQuantity, removeItemFromCart, clearCart } from '../controllers/cartController.js';
import { validateUser } from '../middleware/validateUser.js'; // Protect these routes

const router = express.Router();

// Apply the validateUser middleware to all cart routes
router.use(validateUser);

router.get('/:userId', getCart);
router.post('/:userId/add', addItemToCart);
router.put('/:userId/update', updateItemQuantity);
router.delete('/:userId/remove', removeItemFromCart);
router.delete('/:userId/clear', clearCart);

export default router;