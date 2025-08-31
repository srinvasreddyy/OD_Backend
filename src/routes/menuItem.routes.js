import express from 'express';
import {
    addMenuItem,
    updateMenuItem,
    deleteMenuItem,
    getAllMenuItems,
    getMenuItemById,
    getMenuByRestaurantId,
    getAllCategories
} from '../controllers/menuItemsController.js';
import { uploadMemory } from "../middleware/multer.middleware.js";
import { validateRestaurant } from '../middleware/validateRestaurant.js';

const router = express.Router();

// --- Public Read Routes ---
router.get('/all', getAllMenuItems);
router.get('/restaurant/:restaurantId', getMenuByRestaurantId);
router.get('/categories', getAllCategories); // Corrected route for categories
router.get('/:itemId', getMenuItemById);

// --- Private Write/Modify Routes (Owner Only) ---
// These routes are now more secure, relying only on the JWT for owner identification.
const uploadMiddleware = uploadMemory.fields([
    { name: "displayImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 5 }
]);

router.post('/', validateRestaurant, uploadMiddleware, addMenuItem);
router.put('/:itemId', validateRestaurant, uploadMiddleware, updateMenuItem);
router.delete('/:itemId', validateRestaurant, deleteMenuItem);

export default router;