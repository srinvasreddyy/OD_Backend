// OD_Backend/src/controllers/ownerController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import logger from "../utils/logger.js";

/**
 * @description Creates a new delivery partner and associates them with the restaurant.
 * @route POST /api/owner/delivery-partners
 * @access Private (Restaurant Owner)
 */
export const createDeliveryPartner = async (req, res, next) => {
    const  restaurantId  = req.restaurant?._id;
    // UPDATED: Destructure username and password instead of email
    const { fullName, username, password, phoneNumber, deliveryPartnerProfile } = req.body;
    const session = await mongoose.startSession();

    try {
        // UPDATED: Validation for username and password
        if (!fullName || !username || !password || !phoneNumber) {
            return res.status(400).json({ success: false, message: "Full name, username, password, and phone number are required." });
        }
        
        let newPartner;
        await session.withTransaction(async () => {
            // UPDATED: Check for existing username instead of email
            const existingUser = await User.findOne({ username }).session(session);
            if (existingUser) {
                const err = new Error("A user with this username already exists.");
                err.statusCode = 409;
                throw err;
            }

            const partner = new User({
                fullName,
                username, // Set username
                password, // Set password (will be hashed by User model pre-save)
                phoneNumber,
                userType: 'delivery_partner',
                restaurantId, // Link user to the restaurant
                deliveryPartnerProfile: {
                    ...(deliveryPartnerProfile || {}),
                    isAvailable: false // Default to not available
                }
            });

            const savedPartner = await partner.save({ session });
            
            // Add the new partner's ID to the restaurant's list of partners
            await Restaurant.findByIdAndUpdate(restaurantId, 
                { $push: { deliveryPartners: savedPartner._id } },
                { session }
            );
            newPartner = savedPartner;
        });

        // Exclude sensitive info from the response
        const responsePartner = newPartner.toObject();
        delete responsePartner.password; // Ensure password is not returned
        delete responsePartner.currentOTP;

        return res.status(201).json({
            success: true,
            message: "Delivery partner created successfully.",
            data: responsePartner,
        });

    } catch (error) {
        logger.error("Error creating delivery partner", { error: error.message, statusCode: error.statusCode });
        next(error);
    } finally {
        session.endSession();
    }
};

/**
 * @description Lists all delivery partners for the owner's restaurant.
 * @route GET /api/owner/delivery-partners
 * @access Private (Restaurant Owner)
 */
export const getDeliveryPartners = async (req, res, next) => {
    const  restaurantId  = req.restaurant?._id;
    try {
        const restaurant = await Restaurant.findById(restaurantId)
            .populate({
                path: 'deliveryPartners',
                // UPDATED: Select username instead of email
                select: 'fullName username phoneNumber deliveryPartnerProfile isActive'
            })
            .lean();

        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
        }

        return res.status(200).json({
            success: true,
            data: restaurant.deliveryPartners || []
        });
    } catch (error) {
        logger.error("Error fetching delivery partners", { error: error.message });
        next(error);
    }
};

/**
 * @description Deletes a delivery partner.
 * @route DELETE /api/owner/delivery-partners/:partnerId
 * @access Private (Restaurant Owner)
 */
export const deleteDeliveryPartner = async (req, res, next) => {
    const restaurantId = req.restaurant._id;
    const { partnerId } = req.params;
    const session = await mongoose.startSession();

    try {
        if (!mongoose.Types.ObjectId.isValid(partnerId)) {
            return res.status(400).json({ success: false, message: "Invalid partner ID format." });
        }

        await session.withTransaction(async () => {
            // 1. Remove from Restaurant's list
            await Restaurant.updateOne(
                { _id: restaurantId },
                { $pull: { deliveryPartners: partnerId } },
                { session }
            );

            // 2. Check and Delete the User document
            const partner = await User.findOneAndDelete(
                { _id: partnerId, restaurantId, userType: 'delivery_partner' },
                { session }
            );

            if (!partner) {
                const error = new Error("Delivery partner not found or not associated with your restaurant.");
                error.statusCode = 404;
                throw error;
            }
        });

        return res.status(200).json({ success: true, message: "Delivery partner deleted successfully." });

    } catch (error) {
        logger.error("Error deleting delivery partner", { error: error.message, partnerId });
        if (error.statusCode) {
             return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        session.endSession();
    }
};


/**
 * @description Updates an existing delivery partner's details.
 * @route PUT /api/owner/delivery-partners/:partnerId
 * @access Private (Restaurant Owner)
 */
export const updateDeliveryPartner = async (req, res, next) => {
    const restaurantId = req.restaurant._id;
    const { partnerId } = req.params;
    const { fullName, phoneNumber, deliveryPartnerProfile } = req.body;

    try {
        if (!mongoose.Types.ObjectId.isValid(partnerId)) {
            return res.status(400).json({ success: false, message: "Invalid partner ID format." });
        }

        // We do NOT include 'username' or 'password' here to keep it simple.
        const updateData = {};
        if (fullName) updateData.fullName = fullName;
        if (phoneNumber) updateData.phoneNumber = phoneNumber;
        
        // Handle nested profile updates properly
        if (deliveryPartnerProfile) {
            if (deliveryPartnerProfile.vehicleType) {
                updateData["deliveryPartnerProfile.vehicleType"] = deliveryPartnerProfile.vehicleType;
            }
            if (deliveryPartnerProfile.vehicleNumber) {
                updateData["deliveryPartnerProfile.vehicleNumber"] = deliveryPartnerProfile.vehicleNumber;
            }
        }

        const updatedPartner = await User.findOneAndUpdate(
            { _id: partnerId, restaurantId, userType: 'delivery_partner' },
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password -currentOTP -otpGeneratedAt');

        if (!updatedPartner) {
            return res.status(404).json({ success: false, message: "Delivery partner not found or not associated with your restaurant." });
        }

        return res.status(200).json({
            success: true,
            message: "Delivery partner updated successfully.",
            data: updatedPartner
        });

    } catch (error) {
        logger.error("Error updating delivery partner", { error: error.message, partnerId });
        next(error);
    }
};