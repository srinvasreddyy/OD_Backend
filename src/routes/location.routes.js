import express from 'express';
import { searchAddress, reverseGeocode } from '../controllers/locationController.js';

const router = express.Router();

router.get('/search', searchAddress);
router.get('/reverse', reverseGeocode);

export default router;