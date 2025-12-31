import mongoose from "mongoose";
import Stripe from "stripe";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import { calculateOrderPricing, validateCart, processOrderItems, calculateDeliveryFee } from "../utils/orderCalculation.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

const handleCheckoutSessionCompleted = async (session) => {
    const {
        id: sessionId,
        metadata,
        payment_status: paymentStatus,
        amount_total: stripeAmount,
    } = session;
    
    // FIX 1: Safely Extract Metadata with defaults
    const { 
        userId, 
        restaurantId, 
        idempotencyKey, 
        cartType: rawCartType, 
        deliveryAddress: deliveryAddressJSON, 
        orderType 
    } = metadata || {};
    
    if (paymentStatus !== 'paid') {
        logger.warn('Webhook received for non-paid session', { sessionId });
        return;
    }

    if (config.featureFlags.enableIdempotencyCheck) {
        const existingOrder = await Order.findOne({ idempotencyKey });
        if (existingOrder) {
            logger.warn('Duplicate webhook event received for an already processed order', { idempotencyKey, sessionId });
            return;
        }
    }

    const dbMongoSession = await mongoose.startSession();
    try {
        await dbMongoSession.withTransaction(async () => {
            // FIX 2: Ensure cartType is valid before use to prevent "undefined" string literal
            const cartType = rawCartType && ['foodCart', 'groceriesCart'].includes(rawCartType) ? rawCartType : 'foodCart';

            const user = await User.findById(userId).populate({
                path: `${cartType}.menuItemId`,
            }).session(dbMongoSession);

            if (!user) throw new Error(`User not found for ID: ${userId}`);

            const cart = user[cartType];
            const { error: cartError } = validateCart(cart);
            if (cartError) throw new Error(cartError);

            const restaurant = await Restaurant.findById(restaurantId).session(dbMongoSession).lean();
            if (!restaurant) throw new Error(`Restaurant not found for ID: ${restaurantId}`);
            
            const processedItems = await processOrderItems(cart);
            
            // FIX 3: Robust JSON Parsing for Address
            let deliveryAddress = {};
            try {
                if (deliveryAddressJSON && deliveryAddressJSON !== "undefined") {
                    deliveryAddress = JSON.parse(deliveryAddressJSON);
                }
            } catch (e) {
                logger.warn("Webhook: Failed to parse deliveryAddress JSON", { sessionId, error: e.message });
                // Do not throw, allow order to proceed as pickup or minimal address if possible
            }
            
            // FIX 4: Robust Order Type Determination & Crash Prevention
            // If orderType says 'delivery' but we have no coordinates, we MUST fall back to 'pickup'
            // otherwise the delivery fee calculation will crash the transaction.
            let validOrderType = orderType || 'delivery';
            let deliveryFee = 0;

            if (validOrderType === 'delivery') {
                if (!deliveryAddress || !deliveryAddress.coordinates || !deliveryAddress.coordinates.coordinates) {
                    logger.warn("Webhook: Order marked as 'delivery' but address coordinates are missing. Defaulting to 'pickup' to prevent data loss.", { sessionId });
                    validOrderType = 'pickup';
                } else {
                    // Safe to calculate fee
                    const [restLon, restLat] = restaurant.address.coordinates.coordinates;
                    const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
                    deliveryFee = calculateDeliveryFee(restLat, restLon, userLat, userLon, restaurant.deliverySettings);
                    
                    if (deliveryFee === -1) {
                         logger.warn("Webhook: Delivery address out of range but payment passed.", { sessionId });
                         deliveryFee = 0; 
                    }
                }
            }

            const { pricing, appliedOffer } = calculateOrderPricing(processedItems, deliveryFee, restaurant);
            const backendAmount = Math.round(pricing.totalAmount * 100);
            
            if (Math.abs(stripeAmount - backendAmount) > 5) {
                 logger.warn(`Price mismatch for session ${sessionId}. Stripe: ${stripeAmount}, Backend: ${backendAmount}. Proceeding with order creation.`);
            }

            const newOrder = new Order({
                restaurantId,
                customerId: userId,
                customerDetails: { 
                    name: user.fullName || "Customer", // Fallback if name is missing
                    phoneNumber: user.phoneNumber 
                },
                orderType: validOrderType,
                deliveryAddress: deliveryAddress || {}, // Ensure not null
                orderedItems: processedItems,
                pricing,
                appliedOffer,
                paymentType: 'card',
                paymentStatus: 'paid',
                acceptanceStatus: 'pending',
                sessionId,
                idempotencyKey,
            });

            await newOrder.save({ session: dbMongoSession });

            user[cartType] = [];
            await user.save({ session: dbMongoSession });
            
            logger.info('Order successfully created from webhook', { orderId: newOrder._id, sessionId });
        });
    } catch (error) {
        logger.error('Error processing checkout.session.completed webhook', { error: error.message, sessionId });
        throw error; 
    } finally {
        dbMongoSession.endSession();
    }
};

const handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = new Stripe(config.stripe.secretKey);
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
        logger.error('Stripe webhook signature verification failed.', { error: err.message });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            try {
                await handleCheckoutSessionCompleted(session);
            } catch (error) {
                return res.status(500).json({ received: false, error: "Failed to process webhook." });
            }
            break;
        default:
            logger.info(`Unhandled Stripe event type ${event.type}`, { eventId: event.id });
    }

    res.status(200).json({ received: true });
};

export default { handleStripeWebhook };