import axios from 'axios';
import logger from '../utils/logger.js';

/**
 * @description Search for an address using OpenStreetMap Nominatim
 * @route GET /api/location/search
 * @access Public
 */
export const searchAddress = async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ success: false, message: "Query parameter 'q' is required" });

        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q,
                format: 'json',
                limit: 5,
                addressdetails: 1
            },
            headers: {
                'User-Agent': 'OrderNow-App/1.0' // Nominatim requires a User-Agent
            }
        });

        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        logger.error("Location Search Error", { error: error.message });
        res.status(500).json({ success: false, message: "Failed to fetch location data" });
    }
};

/**
 * @description Reverse geocode coordinates to address
 * @route GET /api/location/reverse
 * @access Public
 */
export const reverseGeocode = async (req, res, next) => {
    try {
        const { lat, lon } = req.query;
        if (!lat || !lon) return res.status(400).json({ success: false, message: "lat and lon are required" });

        const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
            params: {
                lat,
                lon,
                format: 'json'
            },
            headers: {
                'User-Agent': 'OrderNow-App/1.0'
            }
        });

        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        logger.error("Reverse Geocode Error", { error: error.message });
        res.status(500).json({ success: false, message: "Failed to fetch address" });
    }
};