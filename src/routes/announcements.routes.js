import express from 'express';
import { 
  createAnnouncement, 
  editAnnouncement, 
  reactToAnnouncement,
  getAnnouncementStats,
  getAnnouncements,
  getOwnerAnnouncements,
  getSingleAnnouncement,
  getAllActiveAnnouncements,
  toggleAnnouncementStatus,
  deleteAnnouncement
} from '../controllers/announcementsController.js';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import { validateUser } from '../middleware/validateUser.js';
import { uploadMemory } from '../middleware/multer.middleware.js';

const router = express.Router();

// --- Restaurant Owner Routes ---
router.post(
  '/', 
  validateRestaurant, 
  uploadMemory.single('image'), 
  createAnnouncement
);
router.get(
    '/owner/all',
    validateRestaurant,
    getOwnerAnnouncements
);
router.get(
    '/stats',
    validateRestaurant,
    getAnnouncementStats
);
router.put(
  '/:announcementId', 
  validateRestaurant, 
  editAnnouncement
);
router.patch(
    '/:announcementId/toggle-active',
    validateRestaurant,
    toggleAnnouncementStatus
);
router.delete(
    '/:announcementId',
    validateRestaurant,
    deleteAnnouncement
);

// --- Public/Customer Routes ---
router.get(
    '/all',
    getAllActiveAnnouncements
);
router.get(
    '/restaurant/:restaurantId',
    getAnnouncements
);
router.get(
    '/:announcementId',
    getSingleAnnouncement
);
router.post(
  '/:announcementId/react', 
  validateUser, 
  reactToAnnouncement
);

export default router;