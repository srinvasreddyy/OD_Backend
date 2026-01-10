import mongoose from "mongoose";
import Stripe from "stripe";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import { calculateOrderPricing, validateCart, processOrderItems, calculateDeliveryFee } from "../utils/orderCalculation.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// --- Helper Functions ---

const handleCheckoutSessionCompleted = async (session) => {
    const {
        id: sessionId,
        metadata,
        payment_status: paymentStatus,
        amount_total: stripeAmount,
    } = session;
    
    // Safely Extract Metadata with defaults
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
            // Ensure cartType is valid before use
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
            
            // Robust JSON Parsing for Address
            let deliveryAddress = {};
            try {
                if (deliveryAddressJSON && deliveryAddressJSON !== "undefined") {
                    deliveryAddress = JSON.parse(deliveryAddressJSON);
                }
            } catch (e) {
                logger.warn("Webhook: Failed to parse deliveryAddress JSON", { sessionId, error: e.message });
            }
            
            // Robust Order Type Determination
            let validOrderType = orderType || 'delivery';
            let deliveryFee = 0;

            if (validOrderType === 'delivery') {
                if (!deliveryAddress || !deliveryAddress.coordinates || !deliveryAddress.coordinates.coordinates) {
                    logger.warn("Webhook: Order marked as 'delivery' but address coordinates are missing. Defaulting to 'pickup' to prevent data loss.", { sessionId });
                    validOrderType = 'pickup';
                } else {
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
                    name: user.fullName || "Customer", 
                    phoneNumber: user.phoneNumber 
                },
                orderType: validOrderType,
                deliveryAddress: deliveryAddress || {}, 
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

const handleAccountUpdated = async (account) => {
    // Logic to activate restaurant when Stripe onboarding is done
    // Check if details are submitted and charges are enabled
    if (account.details_submitted && account.charges_enabled) {
        try {
            await Restaurant.findOneAndUpdate(
                { stripeAccountId: account.id },
                { stripeAccountStatus: 'active' }
            );
            logger.info(`Restaurant onboarding completed and activated for account: ${account.id}`);
        } catch (error) {
            logger.error('Error updating restaurant status from webhook:', error);
        }
    } else {
        logger.info(`Account updated but not yet fully active: ${account.id}`);
    }
};

// --- Main Exported Handlers ---

// 1. Handler for "Your Account" Events (Payments)
const handlePaymentWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = new Stripe(config.stripe.secretKey);
    let event;

    try {
        // Use the Standard Webhook Secret (for checkout.session.completed)
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
        logger.error('Payment Webhook signature verification failed.', { error: err.message });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        try {
            await handleCheckoutSessionCompleted(event.data.object);
        } catch (error) {
            return res.status(500).json({ received: false, error: "Failed to process payment webhook." });
        }
    } else {
        logger.info(`Unhandled Payment event type ${event.type}`, { eventId: event.id });
    }

    res.status(200).json({ received: true });
};

// 2. Handler for "Connected Account" Events (Onboarding)
const handleConnectWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = new Stripe(config.stripe.secretKey);
    let event;

    try {
        // Use the NEW Connect Webhook Secret (for account.updated)
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.connectWebhookSecret);
    } catch (err) {
        logger.error('Connect Webhook signature verification failed.', { error: err.message });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'account.updated') {
        try {
            await handleAccountUpdated(event.data.object);
        } catch (error) {
             return res.status(500).json({ received: false, error: "Failed to process connect webhook." });
        }
    } else {
        logger.info(`Unhandled Connect event type ${event.type}`, { eventId: event.id });
    }

    res.status(200).json({ received: true });
};

export default { handlePaymentWebhook, handleConnectWebhook };