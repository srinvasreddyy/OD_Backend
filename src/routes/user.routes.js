import express from 'express';
import { validateUser } from '../middleware/validateUser.js';
import {
    getUserProfile,
    updateUserProfile
} from '../controllers/userController.js';

const router = express.Router();

// All routes in this file are for authenticated users, so we apply the middleware globally.
router.use(validateUser);

router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);

export default router;