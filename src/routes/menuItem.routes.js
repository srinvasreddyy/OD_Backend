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
router.get('/:itemId', getMenuItemById);
router.get('/', getAllCategories);

// --- Private Write/Modify Routes ---
const uploadMiddleware = uploadMemory.fields([
    { name: "displayImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 5 }
]);

router.post('/:restaurantId/addMenuItem', validateRestaurant, uploadMiddleware, addMenuItem);
router.post('/:restaurantId/:itemId/updateMenuItem', validateRestaurant, uploadMiddleware, updateMenuItem);
router.delete('/:restaurantId/:itemId/delete', validateRestaurant, deleteMenuItem);

export default router;