import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import User from '../models/User.js';
import Restaurant from '../models/Restaurant.js';
import Order from '../models/Order.js'; 
import { getDistanceFromLatLonInMiles } from "../utils/locationUtils.js";
import { processOrderItems, calculateOrderPricing } from "../utils/orderCalculation.js"; 
import logger from "../utils/logger.js";
import config from "../config/env.js";

const stripe = new Stripe(config.stripe.secretKey);

// Helper to generate a human-readable order number
const generateOrderNumber = () => `ORD-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

export const createOrderCheckoutSession = async (req, res, next) => {
    try {
        // 0. Global Feature Flag Check
        if (!config.featureFlags.enableOnlinePayments) {
            return res.status(403).json({ success: false, message: "Online payments are currently disabled." });
        }

        const userId = req.user._id;
        const { cartType, deliveryAddress, orderType } = req.body; 

        if (!cartType || !['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ success: false, message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        
        const isPickup = orderType === 'pickup';
        
        if (!isPickup && (!deliveryAddress || !deliveryAddress.coordinates)) {
             return res.status(400).json({ success: false, message: "Delivery address with coordinates is required for delivery orders." });
        }
        
        const cartField = cartType;

        // 1. Fetch User & Cart
        const user = await User.findById(userId).populate(`${cartField}.menuItemId`).lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const cart = user[cartField];
        if (!cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: "Cannot checkout with an empty cart." });
        }
        
        const restaurantId = cart[0].menuItemId.restaurantId;
        
        // 2. Fetch Restaurant (ensure stripeAccountId is selected)
        const restaurant = await Restaurant.findById(restaurantId).select('+stripeAccountId').lean();
        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
        }

        // Check if restaurant accepts online orders
        if (!restaurant.acceptsOnlineOrders) {
             return res.status(403).json({ success: false, message: "This restaurant does not accept online payments." });
        }

        if (!restaurant.stripeAccountId) {
            return res.status(500).json({ success: false, message: "This restaurant is not set up to receive payments yet." });
        }

        // 3. Process Cart Items (Snapshot current price/availability)
        // This ensures the price is locked in at the moment of checkout button click
        const processedItems = await processOrderItems(cart);
        
        // 4. Calculate Delivery Fee
        let deliveryFee = 0;
        if (!isPickup) {
            const [restLon, restLat] = restaurant.address.coordinates.coordinates;
            const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
            
            const distance = getDistanceFromLatLonInMiles(restLat, restLon, userLat, userLon);
            
            if (restaurant.deliverySettings && distance > restaurant.deliverySettings.maxDeliveryRadius) {
                 return res.status(400).json({ success: false, message: `Address is outside the delivery radius of ${restaurant.deliverySettings.maxDeliveryRadius} miles.` });
            }
            
            // Calculate fee manually based on settings or use utility if strictly available
            // Logic: if > free radius, charge per mile
            if (restaurant.deliverySettings && distance > restaurant.deliverySettings.freeDeliveryRadius) {
                const chargeable = distance - restaurant.deliverySettings.freeDeliveryRadius;
                deliveryFee = Math.round(chargeable * restaurant.deliverySettings.chargePerMile * 100) / 100;
            }
        }

        // 5. Calculate Final Pricing
        const { pricing, appliedOffer } = calculateOrderPricing(processedItems, deliveryFee, restaurant);
        
        if (pricing.totalAmount <= 0) {
            return res.status(400).json({ success: false, message: "Order total must be greater than zero." });
        }

        // 6. Create "Awaiting Payment" Order in Database
        const idempotencyKey = config.featureFlags.enableIdempotencyCheck ? uuidv4() : null;
        
        const newOrder = new Order({
            orderNumber: generateOrderNumber(),
            restaurantId,
            customerId: userId,
            customerDetails: { 
                name: user.fullName || "Customer", 
                phoneNumber: user.phoneNumber 
            },
            orderType: isPickup ? 'pickup' : 'delivery',
            deliveryAddress: deliveryAddress || {}, 
            orderedItems: processedItems, // Saved snapshot of items
            pricing,
            appliedOffer,
            paymentType: 'card',
            paymentStatus: 'pending',
            status: 'awaiting_payment', // Logic flag: not yet visible to restaurant
            acceptanceStatus: 'pending',
            idempotencyKey
        });

        await newOrder.save();

        // 7. Create Stripe Session
        // We pass the newOrder._id to metadata so the webhook knows which order to update
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp", 
                    product_data: {
                        name: `Order ${newOrder.orderNumber}`,
                        description: `From ${restaurant.restaurantName} (${isPickup ? 'Pickup' : 'Delivery'})`
                    },
                    unit_amount: Math.round(pricing.totalAmount * 100), // Amount in cents
                },
                quantity: 1,
            }],
            mode: "payment",
            payment_intent_data: {
                application_fee_amount: Math.round(pricing.handlingCharge * 100),
                transfer_data: {
                    destination: restaurant.stripeAccountId,
                },
            },
            success_url: `${config.clientUrls.successRedirect}?order_session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: config.clientUrls.failureRedirect,
            customer_email: user.email, 
            metadata: {
                orderId: newOrder._id.toString(), // CRITICAL: Link session to our DB order
                cartType: cartField,
                userId: userId.toString()
            }
        });

        // 8. Update Order with Session ID
        newOrder.sessionId = session.id;
        await newOrder.save();

        res.status(200).json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        logger.error("Error creating checkout session", { error: error.message, userId: req.user?._id });
        next(error);
    }
};