// src/controllers/webhookController.js
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
    
    const { userId, restaurantId, idempotencyKey, cartType, deliveryAddress: deliveryAddressJSON } = metadata;
    
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
            const deliveryAddress = JSON.parse(deliveryAddressJSON);
            
            let deliveryFee = 0;
            const [restLon, restLat] = restaurant.address.coordinates.coordinates;
            const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
            deliveryFee = calculateDeliveryFee(restLat, restLon, userLat, userLon, restaurant.deliverySettings);
            if (deliveryFee === -1) throw new Error("Delivery address is out of range.");

            // We don't need to re-validate promo code as it was part of the initial price calculation
            const { pricing, appliedOffer } = calculateOrderPricing(processedItems, deliveryFee, restaurant);

            const backendAmount = Math.round(pricing.totalAmount * 100);
            if (Math.abs(stripeAmount - backendAmount) > 1) {
                throw new Error(`Price mismatch for session ${sessionId}. Stripe: ${stripeAmount}, Backend: ${backendAmount}`);
            }

            const newOrder = new Order({
                restaurantId,
                customerId: userId,
                customerDetails: { name: user.fullName, phoneNumber: user.phoneNumber },
                orderType: 'delivery',
                deliveryAddress,
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

// Renamed to 'handleStripeWebhook' to match index.js usage
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

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            try {
                await handleCheckoutSessionCompleted(session);
            } catch (error) {
                // Return a 500 to let Stripe know it should retry the webhook
                return res.status(500).json({ received: false, error: "Failed to process webhook." });
            }
            break;
        default:
            logger.info(`Unhandled Stripe event type ${event.type}`, { eventId: event.id });
    }

    res.status(200).json({ received: true });
};

// Added default export
export default { handleStripeWebhook };