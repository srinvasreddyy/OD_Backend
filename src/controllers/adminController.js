// OD_Backend/src/controllers/adminController.js
import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import logger from "../utils/logger.js";

/**
 * @description Get a list of all restaurants, filterable by verification status.
 * @route GET /api/admin/restaurants
 * @access Private (Super Admin)
 */
export const getRestaurantsForAdmin = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        const query = {};

        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            const restaurantsWithStatus = await RestaurantDocuments.find({ verificationStatus: status }).select('restaurantId').lean();
            const restaurantIds = restaurantsWithStatus.map(doc => doc.restaurantId);
            query._id = { $in: restaurantIds };
        }

        const restaurants = await Restaurant.find(query)
            .select('-password -currentOTP -otpGeneratedAt')
            .populate({
                path: 'documents', // Virtual populate
                select: 'verificationStatus remarks'
            })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 })
            .exec();

        const count = await Restaurant.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: restaurants,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        logger.error("Error fetching restaurants for admin", { error: error.message });
        next(error);
    }
};

/**
 * @description Get detailed information for a single restaurant, including documents.
 * @route GET /api/admin/restaurants/:restaurantId
 * @access Private (Super Admin)
 */
export const getRestaurantDetailsForAdmin = async (req, res, next) => {
    try {
        const restaurantId  = req.params.restaurantId;
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return res.status(400).json({ success: false, message: "Invalid Restaurant ID format." });
        }

        const restaurant = await Restaurant.findById(restaurantId).select('-password').lean();
        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
        }
        
        const documents = await RestaurantDocuments.findOne({ restaurantId }).lean();
        
        return res.status(200).json({
            success: true,
            data: { ...restaurant, documents }
        });

    } catch (error) {
        logger.error("Error fetching restaurant details for admin", { error: error.message });
        next(error);
    }
};

/**
 * @description Verify (approve/reject) a restaurant's application.
 * @route PATCH /api/admin/restaurants/:restaurantId/verify
 * @access Private (Super Admin)
 */
export const verifyRestaurant = async (req, res, next) => {
    try {
        const restaurantId  = req.params.restaurantId;
        const { verificationStatus, remarks } = req.body;

        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return res.status(400).json({ success: false, message: "Invalid Restaurant ID format." });
        }
        if (!['approved', 'rejected'].includes(verificationStatus)) {
            return res.status(400).json({ success: false, message: "Invalid verification status. Must be 'approved' or 'rejected'." });
        }

        const restaurantDoc = await RestaurantDocuments.findOne({ restaurantId });
        if (!restaurantDoc) {
            return res.status(404).json({ success: false, message: "Restaurant documents not found for this establishment." });
        }

        restaurantDoc.verificationStatus = verificationStatus;
        if (remarks) {
            restaurantDoc.remarks = remarks;
        }

        // If approved, also set the restaurant to active by default. Owner can change this later.
        if (verificationStatus === 'approved') {
            await Restaurant.findByIdAndUpdate(restaurantId, { isActive: true });
        }

        await restaurantDoc.save();

        return res.status(200).json({
            success: true,
            message: `Restaurant has been successfully ${verificationStatus}.`,
            data: restaurantDoc,
        });

    } catch (error) {
        logger.error("Error verifying restaurant", { error: error.message, restaurantId });
        next(error);
    }
};

/**
 * @description Toggles the active status of a restaurant.
 * @route PATCH /api/admin/restaurants/:restaurantId/toggle-active
 * @access Private (Super Admin)
 */
export const toggleRestaurantActiveStatus = async (req, res, next) => {
    try {
        const restaurantId  = req.params.restaurantId;
        const { isActive } = req.body; // Expecting boolean true or false

        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ success: false, message: "A boolean 'isActive' field is required." });
        }
        
        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: { isActive: isActive } },
            { new: true }
        ).select('-password');

        if (!updatedRestaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
        }

        return res.status(200).json({
            success: true,
            message: `Restaurant status updated to ${isActive ? 'active' : 'inactive'}.`,
            data: updatedRestaurant,
        });
    } catch (error) {
        logger.error("Error toggling restaurant active status", { error: error.message, restaurantId });
        next(error);
    }
};