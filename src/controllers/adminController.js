import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import User from "../models/User.js"; // <-- NEW IMPORT
import logger from "../utils/logger.js";
import { getPaginationParams } from "../utils/paginationUtils.js";

/**
 * @description Get a list of all restaurants, filterable by verification status using an efficient aggregation.
 * @route GET /api/admin/restaurants
 * @access Private (Super Admin)
 */
export const getRestaurantsForAdmin = async (req, res, next) => {
    try {
        const { status } = req.query;
        const { page, limit, skip } = getPaginationParams(req.query);
        
        const pipeline = [];

        // Stage 1: Lookup to join with restaurantdocuments
        pipeline.push({
            $lookup: {
                from: "restaurantdocuments",
                localField: "_id",
                foreignField: "restaurantId",
                as: "documents"
            }
        });

        // Stage 2: Unwind the documents array
        pipeline.push({ $unwind: "$documents" });

        // Stage 3: Filter by status if provided
        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            pipeline.push({ $match: { "documents.verificationStatus": status } });
        }
        
        // Stage 4: Count total matching documents before pagination
        const countPipeline = [...pipeline, { $count: "total" }];
        const countResult = await Restaurant.aggregate(countPipeline);
        const count = countResult[0]?.total || 0;

        // Stage 5: Add sorting, skipping, and limiting for pagination
        pipeline.push({ $sort: { createdAt: -1 } });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });
        
        // Stage 6: Project to shape the final output
        pipeline.push({
            $project: {
                password: 0,
                currentOTP: 0,
                otpGeneratedAt: 0,
            }
        });

        const restaurants = await Restaurant.aggregate(pipeline);

        return res.status(200).json({
            success: true,
            data: restaurants,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
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

// --- NEW FUNCTIONS FOR FEATURE-002 ---

/**
 * @description Get a paginated list of all users (customers, delivery partners).
 * @route GET /api/admin/users
 * @access Private (Super Admin)
 */
export const getAllUsers = async (req, res, next) => {
    try {
        const { userType } = req.query;
        const { page, limit, skip } = getPaginationParams(req.query);

        const query = {
            // Exclude super_admins from the list to prevent accidental deactivation
            userType: { $ne: 'super_admin' }
        };

        if (userType && ['customer', 'delivery_partner'].includes(userType)) {
            query.userType = userType;
        }

        const users = await User.find(query)
            .select('-currentOTP -otpGeneratedAt') // Sanitize sensitive data
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const count = await User.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: users,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
        });

    } catch (error) {
        logger.error("Error fetching all users for admin", { error: error.message });
        next(error);
    }
};

/**
 * @description Toggles the active status of a user account.
 * @route PATCH /api/admin/users/:userId/toggle-active
 * @access Private (Super Admin)
 */
export const toggleUserActiveStatus = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { isActive } = req.body;

        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ success: false, message: "A boolean 'isActive' field is required." });
        }
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid User ID format." });
        }

        const userToUpdate = await User.findById(userId);

        if (!userToUpdate) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        
        // Safety check to prevent deactivating an admin
        if (userToUpdate.userType === 'super_admin') {
            return res.status(403).json({ success: false, message: "Cannot change the status of a super admin." });
        }

        userToUpdate.isActive = isActive;
        await userToUpdate.save();

        return res.status(200).json({
            success: true,
            message: `User account has been successfully ${isActive ? 'activated' : 'deactivated'}.`,
        });

    } catch (error) {
        logger.error("Error toggling user active status", { error: error.message, userId: req.params.userId });
        next(error);
    }
};