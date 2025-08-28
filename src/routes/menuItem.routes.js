import express from 'express';
import { addMenuItem } from '../controllers/menuItemsController.js'; 
import {uploadMemory} from "../middleware/multer.middleware.js";

const router = express.Router();

router.post(
  '/:restaurantId/menu-items',
  uploadMemory.fields([
    { name: "displayImage", maxCount: 1 },       
    { name: "galleryImages", maxCount: 5 } 
  ]), // This middleware must come before your controller
  addMenuItem
);

export default router;