import Stripe from "stripe";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// --- Helper Functions ---

const handleCheckoutSessionCompleted = async (session) => {
    const { id: sessionId, metadata, payment_status } = session;
    
    // We expect orderId in metadata because we put it there in paymentController
    const { orderId, cartType, userId } = metadata || {};

    if (payment_status !== 'paid') {
        logger.warn(`Webhook: Session ${sessionId} not paid. Status: ${payment_status}`);
        return;
    }

    if (!orderId) {
        // NOTE: This might be a Booking session (from bookingController) not an Order session
        // Booking Controller logic usually handles success via client-side or specific webhook logic if expanded
        logger.info(`Webhook: No orderId in metadata for session ${sessionId}. Might be a Booking or other type.`);
        return;
    }

    try {
        // 1. Find the order created previously
        const order = await Order.findById(orderId);
        
        if (!order) {
            logger.error(`Webhook: Order not found for ID ${orderId}`);
            return;
        }

        // 2. Idempotency Check
        if (order.paymentStatus === 'paid') {
            logger.info(`Webhook: Order ${order.orderNumber} already processed. Skipping.`);
            return;
        }

        // 3. Update Order Status
        // Move from 'awaiting_payment' to 'placed' so it appears in the Restaurant Dashboard
        order.paymentStatus = 'paid';
        order.status = 'placed'; 
        await order.save();

        // 4. Clear User Cart
        // Now that payment is confirmed, we can safely remove items from the cart
        if (userId && cartType) {
            await User.findByIdAndUpdate(userId, { $set: { [cartType]: [] } });
            logger.info(`Webhook: Cart ${cartType} cleared for user ${userId}`);
        }

        logger.info(`Webhook: Order ${order.orderNumber} successfully finalized.`);

    } catch (error) {
        logger.error('Error processing checkout session webhook', { error: error.message, sessionId });
        throw error;
    }
};

const handleAccountUpdated = async (account) => {
    // Logic to activate restaurant when Stripe onboarding is done
    if (account.details_submitted && account.charges_enabled) {
        try {
            await Restaurant.findOneAndUpdate(
                { stripeAccountId: account.id },
                { 
                    stripeAccountStatus: 'active',
                    stripeOnboardingComplete: true, // Ensure this flag is set
                    acceptsOnlineOrders: true       // Enable online orders automatically
                }
            );
            logger.info(`Restaurant onboarding completed: ${account.id}`);
        } catch (error) {
            logger.error('Error updating restaurant status from webhook:', error);
        }
    }
};

// --- Main Exported Handlers ---

// 1. Handler for Payment Events (Platform Events: Orders)
const handlePaymentWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = new Stripe(config.stripe.secretKey);
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
        logger.error(`Payment Webhook Signature Verification Failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        try {
            await handleCheckoutSessionCompleted(event.data.object);
        } catch (error) {
            return res.status(500).json({ received: false, error: "Processing failed" });
        }
    }

    res.status(200).json({ received: true });
};

// 2. Handler for Connect Events (Connected Account Events)
const handleConnectWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = new Stripe(config.stripe.secretKey);
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.connectWebhookSecret);
    } catch (err) {
        logger.error(`Connect Webhook Signature Verification Failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'account.updated') {
        try {
            await handleAccountUpdated(event.data.object);
        } catch (error) {
             return res.status(500).json({ received: false, error: "Processing failed" });
        }
    }

    // NOTE: If you are using Direct Charges (like in Bookings), 'checkout.session.completed' 
    // might arrive here depending on your Webhook configuration in Stripe Dashboard.
    // If so, you would handle booking confirmation here similar to order confirmation.

    res.status(200).json({ received: true });
};

export default { handlePaymentWebhook, handleConnectWebhook };