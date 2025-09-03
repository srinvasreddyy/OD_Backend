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