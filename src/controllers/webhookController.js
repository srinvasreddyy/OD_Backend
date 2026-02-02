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
        logger.error(`Webhook: Missing orderId in metadata for session ${sessionId}`);
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
                    stripeOnboardingComplete: true, // <--- Ensure this flag is set
                    acceptsOnlineOrders: true       // <--- Enable online orders automatically
                }
            );
            logger.info(`Restaurant onboarding completed: ${account.id}`);
        } catch (error) {
            logger.error('Error updating restaurant status from webhook:', error);
        }
    }
};

// --- Main Exported Handlers ---

// 1. Handler for Payment Events (Your Account)
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

// 2. Handler for Connect Events (Connected Accounts)
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

    res.status(200).json({ received: true });
};

export default { handlePaymentWebhook, handleConnectWebhook };