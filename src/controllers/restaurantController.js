import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";

/**
 * @description Get a paginated list of all active and APPROVED restaurants.
 * @route GET /api/restaurants
 * @access Public
 */
export const getRestaurants = async (req, res) => {
    try {
        const { page = 1, limit = 10, type, search } = req.query;

        // Find approved restaurant IDs first
        const approvedDocs = await RestaurantDocuments.find({ verificationStatus: 'approved' }).select('restaurantId').lean();
        const approvedRestaurantIds = approvedDocs.map(doc => doc.restaurantId);

        // Base query now includes approval status and active status
        const query = { 
            isActive: true,
            _id: { $in: approvedRestaurantIds }
        };

        if (type && ['food_delivery_and_dining', 'groceries', 'food_delivery'].includes(type)) {
            query.restaurantType = type;
        }

        if (search) {
            query.restaurantName = { $regex: search, $options: 'i' }; // Case-insensitive search
        }

        const restaurants = await Restaurant.find(query)
            .select('-password -currentOTP -otpGeneratedAt') // Exclude sensitive fields
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await Restaurant.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: restaurants,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: "An unexpected server error occurred." 
        });
    }
};

/**
 * @description Get public details for a single approved and active restaurant.
 * @route GET /api/restaurants/:id
 * @access Public
 */
export const getRestaurantById = async (req, res) => {
    try {
        const { id } = req.params?.restaurantId;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Restaurant ID." });
        }

        // Check verification status
        const doc = await RestaurantDocuments.findOne({ restaurantId: id, verificationStatus: 'approved' }).lean();
        if (!doc) {
            return res.status(404).json({ success: false, message: "Restaurant not found or has not been approved." });
        }

        const restaurant = await Restaurant.findOne({ _id: id, isActive: true })
            .select('-password -currentOTP -otpGeneratedAt');

        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found or is currently inactive." });
        }

        return res.status(200).json({ success: true, data: restaurant });
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: "An unexpected server error occurred." 
        });
    }
};

/**
 * @description Allows a restaurant owner to update their profile details.
 * @route PUT /api/restaurants/profile
 * @access Private (Restaurant Owner)
 */
export const updateRestaurantProfile = async (req, res) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const { restaurantName, ownerFullName, phoneNumber, primaryContactName, address } = req.body;

        const updateData = {};
        if (restaurantName) updateData.restaurantName = restaurantName;
        if (ownerFullName) updateData.ownerFullName = ownerFullName;
        if (phoneNumber) updateData.phoneNumber = phoneNumber;
        if (primaryContactName) updateData.primaryContactName = primaryContactName;
        if (address) updateData.address = address;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, message: "No fields to update were provided." });
        }

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password -currentOTP -otpGeneratedAt');

        return res.status(200).json({ 
            success: true, 
            message: "Profile updated successfully.", 
            data: updatedRestaurant 
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: "An unexpected server error occurred while updating the profile." 
        });
    }
};

/**
 * @description Toggles the operational status of a restaurant (active/inactive).
 * @route PATCH /api/restaurants/toggle-status
 * @access Private (Restaurant Owner)
 */
export const toggleRestaurantStatus = async (req, res) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const  isActive  = req.restaurant?.isActive;

        const newStatus = !isActive;

        const updatedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: { isActive: newStatus } },
            { new: true }
        ).select('-password -currentOTP -otpGeneratedAt');

        return res.status(200).json({ 
            success: true, 
            message: `Restaurant is now ${newStatus ? 'open' : 'closed'} for orders.`, 
            data: updatedRestaurant 
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: "An unexpected server error occurred while toggling the status." 
        });
    }
};