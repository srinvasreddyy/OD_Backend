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
    const { fullName, email, phoneNumber, deliveryPartnerProfile } = req.body;
    const session = await mongoose.startSession();

    try {
        if (!fullName || !email || !phoneNumber) {
            return res.status(400).json({ success: false, message: "Full name, email, and phone number are required." });
        }
        
        let newPartner;
        await session.withTransaction(async () => {
            const existingUser = await User.findOne({ email }).session(session);
            if (existingUser) {
                const err = new Error("A user with this email already exists.");
                err.statusCode = 409;
                throw err;
            }

            const partner = new User({
                fullName,
                email,
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
        delete responsePartner.currentOTP;

        return res.status(201).json({
            success: true,
            message: "Delivery partner created successfully. They can now log in using the OTP flow.",
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
                select: 'fullName email phoneNumber deliveryPartnerProfile isActive'
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
            // Ensure we only delete a partner belonging to this restaurant to prevent unauthorized deletions
            const partner = await User.findOneAndDelete(
                { _id: partnerId, restaurantId, userType: 'delivery_partner' },
                { session }
            );

            if (!partner) {
                // If partner wasn't found/deleted, throw specific error (will be caught below)
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

        // We do NOT include 'email' in the update object to prevent it from being changed.
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

        // Find the user and ensure they belong to this restaurant before updating
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