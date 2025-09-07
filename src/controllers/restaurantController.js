import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import { getPaginationParams } from "../utils/paginationUtils.js";
import logger from "../utils/logger.js";

/**
 * @description Get a paginated list of all active and APPROVED restaurants.
 * @route GET /api/restaurants
 * @access Public
 */
export const getRestaurants = async (req, res, next) => {
    try {
        const { type, search, acceptsDining } = req.query;
        const { page, limit, skip } = getPaginationParams(req.query); 

        const approvedDocs = await RestaurantDocuments.find({ verificationStatus: 'approved' }).select('restaurantId').lean();
        const approvedRestaurantIds = approvedDocs.map(doc => doc.restaurantId);

        const query = { 
            isActive: true,
            _id: { $in: approvedRestaurantIds }
        };

        if (type && ['food_delivery_and_dining', 'groceries', 'food_delivery'].includes(type)) {
            query.restaurantType = type;
        }

        if (search) {
            query.restaurantName = { $regex: search, $options: 'i' };
        }
        
        if (acceptsDining === 'true') {
            query.acceptsDining = true;
        }

        const restaurants = await Restaurant.find(query)
            .select('-password -currentOTP -otpGeneratedAt -stripeSecretKey') // Exclude sensitive fields
            .limit(limit)
            .skip(skip)
            .exec();

        const count = await Restaurant.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: restaurants,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
        });
    } catch (error) {
        logger.error("Error fetching restaurants", { error: error.message });
        next(error);
    }
};

/**
 * @description Get public details for a single approved and active restaurant.
 * @route GET /api/restaurants/:id
 * @access Public
 */
export const getRestaurantById = async (req, res, next) => {
    try {
        const { id } = req.params; 
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Restaurant ID." });
        }

        const doc = await RestaurantDocuments.findOne({ restaurantId: id, verificationStatus: 'approved' }).lean();
        if (!doc) {
            return res.status(404).json({ success: false, message: "Restaurant not found or has not been approved." });
        }

        const restaurant = await Restaurant.findOne({ _id: id, isActive: true })
            .select('-password -currentOTP -otpGeneratedAt -stripeSecretKey');

        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found or is currently inactive." });
        }

        return res.status(200).json({ success: true, data: restaurant });
    } catch (error) {
        logger.error("Error fetching restaurant by ID", { error: error.message, restaurantId: req.params.id });
        next(error);
    }
};

/**
 * @description Allows a restaurant owner to update their profile details.
 * @route PUT /api/restaurants/profile
 * @access Private (Restaurant Owner)
 */
export const updateRestaurantProfile = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const { restaurantName, ownerFullName, phoneNumber, primaryContactName, address, acceptsDining } = req.body;

        const updateData = {};
        if (restaurantName) updateData.restaurantName = restaurantName;
        if (ownerFullName) updateData.ownerFullName = ownerFullName;
        if (phoneNumber) updateData.phoneNumber = phoneNumber;
        if (primaryContactName) updateData.primaryContactName = primaryContactName;
        if (address) updateData.address = address;
        if (typeof acceptsDining === 'boolean') updateData.acceptsDining = acceptsDining;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, message: "No fields to update were provided." });
        }

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password -currentOTP -otpGeneratedAt -stripeSecretKey');

        return res.status(200).json({ 
            success: true, 
            message: "Profile updated successfully.", 
            data: updatedRestaurant 
        });

    } catch (error) {
        logger.error("Error updating restaurant profile", { error: error.message, restaurantId: req.restaurant?._id });
        next(error);
    }
};

/**
 * @description Allows a restaurant owner to update their financial and delivery settings.
 * @route PUT /api/restaurants/settings
 * @access Private (Restaurant Owner)
 */
export const updateRestaurantSettings = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant?._id;
        const { handlingChargesPercentage, deliverySettings, stripeSecretKey } = req.body;

        const updateData = {};
        if (handlingChargesPercentage !== undefined) {
            if (typeof handlingChargesPercentage !== 'number' || handlingChargesPercentage < 0) {
                return res.status(400).json({ success: false, message: "Handling charges must be a non-negative number." });
            }
            updateData.handlingChargesPercentage = handlingChargesPercentage;
        }

        if (deliverySettings) {
            // Add validation for deliverySettings object
            updateData.deliverySettings = deliverySettings;
        }

        if (stripeSecretKey) {
            // In a real app, you'd encrypt this key before saving
            updateData.stripeSecretKey = stripeSecretKey;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, message: "No settings fields to update were provided." });
        }

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password -currentOTP -otpGeneratedAt -stripeSecretKey');

        return res.status(200).json({ 
            success: true, 
            message: "Settings updated successfully.", 
            data: updatedRestaurant 
        });

    } catch (error) {
        logger.error("Error updating restaurant settings", { error: error.message, restaurantId: req.restaurant?._id });
        next(error);
    }
};

/**
 * @description Toggles the operational status of a restaurant (active/inactive).
 * @route PATCH /api/restaurants/toggle-status
 * @access Private (Restaurant Owner)
 */
export const toggleRestaurantStatus = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const  isActive  = req.restaurant?.isActive;

        const newStatus = !isActive;

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: { isActive: newStatus } },
            { new: true }
        ).select('-password -currentOTP -otpGeneratedAt -stripeSecretKey');

        return res.status(200).json({ 
            success: true, 
            message: `Restaurant is now ${newStatus ? 'open' : 'closed'} for orders.`, 
            data: updatedRestaurant 
        });

    } catch (error) {
        logger.error("Error toggling restaurant status", { error: error.message, restaurantId: req.restaurant?._id });
        next(error);
    }
};