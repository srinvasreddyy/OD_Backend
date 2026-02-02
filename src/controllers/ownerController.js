import mongoose from "mongoose";
import Stripe from "stripe";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

const stripe = new Stripe(config.stripe.secretKey);


/**
 * @description Generates a new onboarding link. Creates the Stripe account if it doesn't exist yet.
 * @route POST /api/owner/stripe-connect/onboarding-link
 * @access Private (Owner)
 */
export const createStripeOnboardingLink = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        // Fetch restaurant with stripeAccountId (selected explicitly as it might be hidden)
        let restaurant = await Restaurant.findById(restaurantId).select('+stripeAccountId');

        // 1. Lazy Creation: If no Stripe Account ID exists, create one now.
        if (!restaurant.stripeAccountId) {
            logger.info(`Stripe Account missing for restaurant ${restaurantId}. Creating one now...`);
            
            try {
                // FIXED PROCESS: 
                // 1. Use 'express' type.
                // 2. Remove hardcoded 'capabilities' (card_payments, transfers).
                //    These are now managed in your Stripe Dashboard > Connect > Settings.
                //    This prevents mismatch errors between Code and Dashboard.
                const account = await stripe.accounts.create({
                    type: 'express',
                    country: 'GB', // Default to GB
                    email: req.restaurant.email, // Use restaurant email
                });

                restaurant.stripeAccountId = account.id;
                restaurant.stripeAccountStatus = 'pending';
                await restaurant.save();
                
                logger.info(`Created new Stripe Account ${account.id} for restaurant ${restaurantId}`);
            } catch (stripeError) {
                logger.error("Failed to create Stripe account on-the-fly", { error: stripeError.message });
                // Return the specific error from Stripe for easier debugging
                return res.status(500).json({ success: false, message: `Stripe Error: ${stripeError.message}` });
            }
        }

        // 2. Generate the Account Link
        const refreshUrl = `${config.clientUrls.restaurant}/onboarding-refresh`;
        const returnUrl = `${config.clientUrls.restaurant}/onboarding-complete`;

        const accountLink = await stripe.accountLinks.create({
            account: restaurant.stripeAccountId,
            refresh_url: refreshUrl,
            return_url: returnUrl,
            type: 'account_onboarding', 
        });

        res.status(200).json({ success: true, url: accountLink.url });
    } catch (error) {
        logger.error("Error creating onboarding link", { error: error.message });
        next(error);
    }
};

/**
 * @description Generates a login link for the Express Dashboard (to view payouts/earnings).
 * @route POST /api/owner/stripe-connect/login-link
 * @access Private (Owner)
 */
export const createStripeLoginLink = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        const restaurant = await Restaurant.findById(restaurantId).select('+stripeAccountId');

        if (!restaurant.stripeAccountId) {
            return res.status(400).json({ success: false, message: "No Stripe account connected." });
        }

        const loginLink = await stripe.accounts.createLoginLink(restaurant.stripeAccountId);

        res.status(200).json({ success: true, url: loginLink.url });
    } catch (error) {
        logger.error("Error creating login link", { error: error.message });
        next(error);
    }
};

/**
 * @description Manually syncs the local DB status with Stripe.
 * @route POST /api/owner/stripe-connect/sync
 */
export const syncStripeAccount = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        const restaurant = await Restaurant.findById(restaurantId).select('+stripeAccountId');

        if (!restaurant.stripeAccountId) {
            return res.status(400).json({ success: false, message: "No Stripe account found." });
        }

        // 1. Fetch latest status from Stripe
        const account = await stripe.accounts.retrieve(restaurant.stripeAccountId);

        // 2. Determine status
        const isDetailsSubmitted = account.details_submitted;
        const isChargesEnabled = account.charges_enabled;

        // 3. Update Database accordingly
        if (isDetailsSubmitted && isChargesEnabled) {
            restaurant.stripeAccountStatus = 'active';
            // Also update the fields you mentioned were missing
            restaurant.stripeOnboardingComplete = true; 
            if (config.featureFlags.enableOnlinePayments) {
                restaurant.acceptsOnlineOrders = true;
            }
            await restaurant.save();
            
            return res.status(200).json({ 
                success: true, 
                status: 'active', 
                message: "Account is fully active." 
            });
        } 
        
        return res.status(200).json({ 
            success: true, 
            status: 'pending', 
            message: "Stripe account is still pending verification." 
        });

    } catch (error) {
        logger.error("Error syncing Stripe account", { error: error.message });
        next(error);
    }
};

/**
 * @description Creates a new delivery partner and associates them with the restaurant.
 * @route POST /api/owner/delivery-partners
 * @access Private (Restaurant Owner)
 */
export const createDeliveryPartner = async (req, res, next) => {
    const  restaurantId  = req.restaurant?._id;
    const { fullName, username, password, phoneNumber, deliveryPartnerProfile } = req.body;
    const session = await mongoose.startSession();

    try {
        if (!fullName || !username || !password || !phoneNumber) {
            return res.status(400).json({ success: false, message: "Full name, username, password, and phone number are required." });
        }
        
        let newPartner;
        await session.withTransaction(async () => {
            const existingUser = await User.findOne({ username }).session(session);
            if (existingUser) {
                const err = new Error("A user with this username already exists.");
                err.statusCode = 409;
                throw err;
            }

            const partner = new User({
                fullName,
                username, 
                password, 
                phoneNumber,
                userType: 'delivery_partner',
                restaurantId, 
                deliveryPartnerProfile: {
                    ...(deliveryPartnerProfile || {}),
                    isAvailable: false 
                }
            });

            const savedPartner = await partner.save({ session });
            
            await Restaurant.findByIdAndUpdate(restaurantId, 
                { $push: { deliveryPartners: savedPartner._id } },
                { session }
            );
            newPartner = savedPartner;
        });

        const responsePartner = newPartner.toObject();
        delete responsePartner.password; 
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
            await Restaurant.updateOne(
                { _id: restaurantId },
                { $pull: { deliveryPartners: partnerId } },
                { session }
            );

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

        const updateData = {};
        if (fullName) updateData.fullName = fullName;
        if (phoneNumber) updateData.phoneNumber = phoneNumber;
        
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