import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";

/**
 * @description Get a paginated list of all active restaurants, with filtering options.
 * @route GET /api/restaurants
 * @access Public
 */
export const getRestaurants = async (req, res) => {
    try {
        const { page = 1, limit = 10, type, search } = req.query;
        const query = { isActive: true };

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
 * @description Get public details for a single restaurant.
 * @route GET /api/restaurants/:id
 * @access Public
 */
export const getRestaurantById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Restaurant ID." });
        }

        const restaurant = await Restaurant.findOne({ _id: id, isActive: true })
            .select('-password -currentOTP -otpGeneratedAt');

        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
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
        const { _id: restaurantId } = req.restaurant;
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
        const { _id: restaurantId, isActive } = req.restaurant;

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