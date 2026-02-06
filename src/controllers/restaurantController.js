import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import MenuItem from "../models/MenuItem.js"; 
import Category from "../models/Category.js"; 
import { getPaginationParams } from "../utils/paginationUtils.js";
import logger from "../utils/logger.js";
import { getDistanceFromLatLonInMiles } from "../utils/locationUtils.js";

/**
 * @description Get a paginated list of all active and APPROVED restaurants with Distance calculation.
 * @route GET /api/restaurants
 * @access Public
 */
export const getRestaurants = async (req, res, next) => {
    try {
        const { type, search, dishSearch, acceptsDining, lat, lng } = req.query;
        const { page, limit, skip } = getPaginationParams(req.query); 

        const pipeline = [];
        const matchStage = { isActive: true };
        
        if (type) {
            if (type === 'food_delivery') {
                matchStage.restaurantType = { $in: ['food_delivery', 'food_delivery_and_dining'] };
            } else if (type === 'groceries') {
                matchStage.restaurantType = 'groceries';
            } else if (type === 'food_delivery_and_dining') {
                matchStage.restaurantType = 'food_delivery_and_dining';
            } else {
                matchStage.restaurantType = type;
            }
        }
        if (search) matchStage.restaurantName = { $regex: search, $options: 'i' };

        if (dishSearch) {
            const matchingCategories = await Category.find({ categoryName: { $regex: dishSearch, $options: 'i' } }).select('_id');
            const categoryIds = matchingCategories.map(c => c._id);
            const matchingMenuItems = await MenuItem.find({
                $or: [{ itemName: { $regex: dishSearch, $options: 'i' } }, { categories: { $in: categoryIds } }]
            }).select('restaurantId');
            const restaurantIds = matchingMenuItems.map(m => m.restaurantId);
            matchStage._id = { $in: restaurantIds };
        }
        if (acceptsDining === 'true') matchStage.acceptsDining = true;
        
        pipeline.push({ $match: matchStage });
        pipeline.push({
            $lookup: { from: "restaurantdocuments", localField: "_id", foreignField: "restaurantId", as: "documents" }
        });
        pipeline.push({ $match: { "documents.verificationStatus": "approved" } });
        
        const countPipeline = [...pipeline, { $count: "total" }];
        const countResult = await Restaurant.aggregate(countPipeline);
        const count = countResult[0]?.total || 0;

        pipeline.push({ $sort: { createdAt: -1 } });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });
        
        pipeline.push({
            $project: {
                password: 0,
                currentOTP: 0,
                otpGeneratedAt: 0,
                stripeAccountId: 0, // Exclude connect ID
                documents: 0
            }
        });

        const restaurants = await Restaurant.aggregate(pipeline);

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const hasLocation = !isNaN(userLat) && !isNaN(userLng);

        const processedRestaurants = restaurants.map(rest => {
            let distanceMiles = null;
            let isDeliverable = true; 

            if (hasLocation && rest.address?.coordinates?.coordinates) {
                const [restLng, restLat] = rest.address.coordinates.coordinates;
                distanceMiles = getDistanceFromLatLonInMiles(userLat, userLng, restLat, restLng);
                distanceMiles = parseFloat(distanceMiles.toFixed(2)); 
                const maxRadius = rest.deliverySettings?.maxDeliveryRadius || 0;
                if (distanceMiles > maxRadius) isDeliverable = false;
            }
            return { ...rest, distanceMiles, isDeliverable };
        });

        return res.status(200).json({
            success: true,
            data: processedRestaurants,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
        });
    } catch (error) {
        logger.error("Error fetching restaurants", { error: error.message });
        next(error);
    }
};

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

        // Updated projection: Exclude stripeAccountId
        const restaurant = await Restaurant.findOne({ _id: id, isActive: true })
            .select('-password -currentOTP -otpGeneratedAt -stripeAccountId');

        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found or is currently inactive." });
        }

        return res.status(200).json({ success: true, data: restaurant });
    } catch (error) {
        logger.error("Error fetching restaurant by ID", { error: error.message, restaurantId: req.params.id });
        next(error);
    }
};

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
        ).select('-password -currentOTP -otpGeneratedAt -stripeAccountId');

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

export const updateRestaurantSettings = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant?._id;
        
        const { handlingChargesPercentage, deliverySettings, acceptsCashOnDelivery, acceptsDining } = req.body;

        const updateData = {};
        if (handlingChargesPercentage !== undefined) {
            if (typeof handlingChargesPercentage !== 'number' || handlingChargesPercentage < 0) {
                return res.status(400).json({ success: false, message: "Handling charges must be a non-negative number." });
            }
            updateData.handlingChargesPercentage = handlingChargesPercentage;
        }

        if (deliverySettings) {
            updateData.deliverySettings = deliverySettings;
        }
        
        if (typeof acceptsCashOnDelivery === 'boolean') { 
            updateData.acceptsCashOnDelivery = acceptsCashOnDelivery;
        }

        if (typeof acceptsDining === 'boolean') {
            updateData.acceptsDining = acceptsDining;
        }

        // Logic for stripeSecretKey removal: We do NOT allow updating it here anymore.
        // It is managed via Stripe Connect OAuth/Onboarding.

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, message: "No settings fields to update were provided." });
        }

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password -currentOTP -otpGeneratedAt -stripeAccountId');

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

export const toggleRestaurantStatus = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const  isActive  = req.restaurant?.isActive;

        const newStatus = !isActive;

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: { isActive: newStatus } },
            { new: true }
        ).select('-password -currentOTP -otpGeneratedAt -stripeAccountId');

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

export const getRestaurantMe = async (req, res, next) => {
    try {
        const restaurant = await Restaurant.findById(req.restaurant._id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
        }
        return res.status(200).json({ success: true, data: restaurant });
    } catch (error) {
        logger.error("Error fetching my restaurant details", { error: error.message });
        next(error);
    }
};