// src/controllers/promoController.js

import Announcement from "../models/Announcements.js";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import logger from "../utils/logger.js";
import { calculateOrderPricing, validateCart, processOrderItems, calculateDeliveryFee } from "../utils/orderCalculation.js";


/**
 * @description Validates a promo code against the user's cart (or booking) and returns the calculated discount.
 * @route POST /api/promo/apply
 * @access Private (User)
 */
export const applyPromoCode = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const { promoCode, cartType, deliveryAddress, bookingAmount, restaurantId: bookingRestaurantId } = req.body;

        if (!promoCode || !cartType) {
            return res.status(400).json({ success: false, message: "promoCode and cartType are required." });
        }
        
        // Allowed types now include 'booking'
        if (cartType !== 'foodCart' && cartType !== 'groceriesCart' && cartType !== 'booking') {
             return res.status(400).json({ success: false, message: "Invalid cartType." });
        }

        const upperCasePromoCode = promoCode.toUpperCase();
        
        const offer = await Announcement.findOne({ 
            'offerDetails.promoCode': upperCasePromoCode,
            isActive: true,
            'offerDetails.validUntil': { $gte: new Date() }
        }).lean();

        if (!offer) {
            return res.status(404).json({ success: false, message: "This promo code is invalid or has expired." });
        }

        // --- HANDLING BOOKING PROMOS ---
        if (cartType === 'booking') {
             if (!bookingAmount || !bookingRestaurantId) {
                 return res.status(400).json({ success: false, message: "Booking amount and restaurant ID required for booking promos." });
             }
             
             if (offer.restaurantId.toString() !== bookingRestaurantId) {
                 return res.status(400).json({ success: false, message: "This promo code is not valid for this restaurant." });
             }

             // Check Min Order Value
             if (bookingAmount < (offer.offerDetails.minOrderValue || 0)) {
                  return res.status(400).json({ success: false, message: `Minimum booking value of ${offer.offerDetails.minOrderValue} required.` });
             }

             let discountAmount = 0;
             if (offer.offerDetails.discountType === 'PERCENTAGE') {
                 discountAmount = (bookingAmount * offer.offerDetails.discountValue) / 100;
                 if (offer.offerDetails.maxDiscountAmount) {
                     discountAmount = Math.min(discountAmount, offer.offerDetails.maxDiscountAmount);
                 }
             } else if (offer.offerDetails.discountType === 'FLAT') {
                 discountAmount = offer.offerDetails.discountValue;
             }
             
             // Ensure discount doesn't exceed total
             discountAmount = Math.min(discountAmount, bookingAmount);

             return res.status(200).json({
                success: true,
                message: "Promo code applied to booking.",
                data: {
                    originalAmount: bookingAmount,
                    discountAmount: discountAmount,
                    finalAmount: bookingAmount - discountAmount,
                    promoCode: offer.offerDetails.promoCode
                }
            });
        }
        
        // --- HANDLING STANDARD CART PROMOS ---
        const user = await User.findById(userId).populate(`${cartType}.menuItemId`);
        if (!user) return res.status(404).json({ message: "User not found." });
        
        const cart = user[cartType];
        const { error: cartError, restaurantId } = validateCart(cart);
        if (cartError) return res.status(400).json({ success: false, message: cartError });

        if (offer.restaurantId.toString() !== restaurantId) {
            return res.status(400).json({ success: false, message: "This promo code is not valid for the items in your cart." });
        }

        const restaurant = await Restaurant.findById(restaurantId).lean();
        if(!restaurant) return res.status(404).json({ message: "Restaurant for items in cart not found." });
        
        const processedItems = await processOrderItems(cart);
        
        let deliveryFee = 0;
        if (deliveryAddress?.coordinates?.coordinates) {
             const [restLon, restLat] = restaurant.address.coordinates.coordinates;
             const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
             deliveryFee = calculateDeliveryFee(restLat, restLon, userLat, userLon, restaurant.deliverySettings);
             if (deliveryFee === -1) {
                 deliveryFee = 0;
             }
        }
        
        const { pricing } = calculateOrderPricing(processedItems, deliveryFee, restaurant, offer.offerDetails);

        if (pricing.discountAmount === 0) {
             return res.status(400).json({ success: false, message: `Your order does not meet the minimum requirement of £${offer.offerDetails.minOrderValue} for this offer.` });
        }
        
        //  Persist the applied promo code for Carts
        user.customerProfile.appliedPromo = {
            code: upperCasePromoCode,
            cartType: cartType
        };
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Promo code applied successfully.",
            data: {
                originalAmount: pricing.subtotal + pricing.handlingCharge + pricing.deliveryFee,
                discountAmount: pricing.discountAmount,
                finalAmount: pricing.totalAmount,
                promoCode: offer.offerDetails.promoCode
            }
        });

    } catch (error) {
        logger.error("Error applying promo code", { error: error.message, body: req.body });
        next(error);
    }
};