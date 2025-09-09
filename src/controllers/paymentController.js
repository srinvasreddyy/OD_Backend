import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import User from '../models/User.js';
import Restaurant from '../models/Restaurant.js';
import { getDistanceFromLatLonInMiles } from "../utils/locationUtils.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// --- Helper Functions for a Clean and Maintainable Controller ---

const calculateDeliveryFee = (distance, settings) => {
    if (distance > settings.maxDeliveryRadius) {
        return -1; // Indicates out of range
    }
    if (distance <= settings.freeDeliveryRadius) {
        return 0;
    }
    const chargeableDistance = distance - settings.freeDeliveryRadius;
    return Math.round(chargeableDistance * settings.chargePerMile * 100) / 100;
};

const processCartForCheckout = (cart, restaurant) => {
    const processedItems = cart.map(cartItem => {
        const { menuItemId: menuItem, quantity, selectedVariant, selectedAddons } = cartItem;
        if (!menuItem) return null;

        let lineItemSubtotal = menuItem.basePrice;
        if (selectedVariant?.variantId) {
            const group = menuItem.variantGroups.find(g => g.groupId === selectedVariant.groupId);
            const variant = group?.variants.find(v => v.variantId === selectedVariant.variantId);
            if (variant) lineItemSubtotal += (variant.additionalPrice || 0);
        }
        if (selectedAddons?.length) {
            selectedAddons.forEach(addon => {
                const group = menuItem.addonGroups.find(g => g.groupId === addon.groupId);
                const option = group?.addons.find(a => a.addonId === addon.addonId);
                if (option) lineItemSubtotal += (option.price || 0);
            });
        }
        return lineItemSubtotal * quantity;
    }).filter(item => item !== null);
    
    const subtotal = processedItems.reduce((acc, total) => acc + total, 0);
    const handlingCharge = subtotal * (restaurant.handlingChargesPercentage / 100);

    return { subtotal, handlingCharge };
};

// --- Main Controller ---
export const createOrderCheckoutSession = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const { cartType, deliveryAddress } = req.body; 

        // --- CORRECTED VALIDATION ---
        // Now expects 'foodCart' or 'groceriesCart', consistent with the rest of the app.
        if (!cartType || !['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ success: false, message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        if (!deliveryAddress || !deliveryAddress.coordinates || !deliveryAddress.coordinates.coordinates) {
             return res.status(400).json({ success: false, message: "Delivery address with coordinates is required to create a checkout session." });
        }
        
        // No longer need to manually construct the field name.
        const cartField = cartType;

        const user = await User.findById(userId).populate(`${cartField}.menuItemId`).lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const cart = user[cartField];
        if (!cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: "Cannot create a checkout session for an empty cart." });
        }
        
        const restaurantId = cart[0].menuItemId.restaurantId;
        const restaurant = await Restaurant.findById(restaurantId).select('+stripeSecretKey').lean();
        if (!restaurant || !restaurant.stripeSecretKey) {
            return res.status(500).json({ success: false, message: "This restaurant is currently not accepting online payments." });
        }

        const { subtotal, handlingCharge } = processCartForCheckout(cart, restaurant);
        
        const [restaurantLon, restaurantLat] = restaurant.address.coordinates.coordinates;
        const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
        const distance = getDistanceFromLatLonInMiles(restaurantLat, restaurantLon, userLat, userLon);
        const deliveryFee = calculateDeliveryFee(distance, restaurant.deliverySettings);

        if (deliveryFee === -1) {
            return res.status(400).json({ success: false, message: `Sorry, this address is outside the restaurant's delivery radius of ${restaurant.deliverySettings.maxDeliveryRadius} miles.` });
        }

        const totalAmount = subtotal + handlingCharge + deliveryFee;

        if (totalAmount <= 0) {
            return res.status(400).json({ success: false, message: "Cart total must be greater than zero." });
        }

        const stripe = new Stripe(restaurant.stripeSecretKey);

        const line_items = [{
            price_data: {
                currency: "inr",
                product_data: {
                    name: `Order from ${restaurant.restaurantName}`,
                    description: `Includes items, handling charges, and delivery.`
                },
                unit_amount: Math.round(totalAmount * 100),
            },
            quantity: 1,
        }];
        
        const idempotencyKey = config.featureFlags.enableIdempotencyCheck ? uuidv4() : null;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items,
            mode: "payment",
            success_url: `${config.clientUrls.successRedirect}?order_session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: config.clientUrls.failureRedirect,
            customer_email: user.email, 
            metadata: {
                userId: userId.toString(),
                cartType: cartField,
                restaurantId: restaurantId.toString(),
                idempotencyKey,
                deliveryAddress: JSON.stringify(deliveryAddress), 
            }
        });

        res.status(200).json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        logger.error("Error creating Stripe checkout session", { error: error.message, userId: req.user?._id });
        next(error);
    }
};