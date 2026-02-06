import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import User from '../models/User.js';
import Restaurant from '../models/Restaurant.js';
import Order from '../models/Order.js'; 
import { getDistanceFromLatLonInMiles } from "../utils/locationUtils.js";
import { processOrderItems, calculateOrderPricing } from "../utils/orderCalculation.js"; 
import logger from "../utils/logger.js";
import config from "../config/env.js";
import { sendOrderInvoiceEmail } from "../utils/MailUtils.js"; // Import for backup verification trigger

const stripe = new Stripe(config.stripe.secretKey);

const generateOrderNumber = () => `ORD-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

export const createOrderCheckoutSession = async (req, res, next) => {
    try {
        if (!config.featureFlags.enableOnlinePayments) {
            return res.status(403).json({ success: false, message: "Online payments are currently disabled." });
        }

        const userId = req.user._id;
        const { cartType, deliveryAddress, orderType } = req.body; 

        // 1. Validate Input
        if (!cartType || !['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ success: false, message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        
        const isPickup = orderType === 'pickup';
        
        if (!isPickup && (!deliveryAddress || !deliveryAddress.coordinates)) {
             return res.status(400).json({ success: false, message: "Delivery address with coordinates is required for delivery orders." });
        }
        
        const cartField = cartType;

        // 2. Fetch User & Cart
        const user = await User.findById(userId).populate(`${cartField}.menuItemId`).lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const cart = user[cartField];
        if (!cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: "Cannot checkout with an empty cart." });
        }
        
        // 3. Validate Restaurant & Payment Capability
        const restaurantId = cart[0].menuItemId.restaurantId;
        
        const restaurant = await Restaurant.findById(restaurantId).select('+stripeAccountId').lean();
        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found." });
        }

        if (!restaurant.acceptsOnlineOrders) {
             return res.status(403).json({ success: false, message: "This restaurant does not accept online payments." });
        }

        if (!restaurant.stripeAccountId) {
            return res.status(500).json({ success: false, message: "This restaurant is not set up to receive payments yet." });
        }

        // 4. Process Items & Calculate Fees
        const processedItems = await processOrderItems(cart);
        
        let deliveryFee = 0;
        if (!isPickup) {
            const [restLon, restLat] = restaurant.address.coordinates.coordinates;
            const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
            
            const distance = getDistanceFromLatLonInMiles(restLat, restLon, userLat, userLon);
            
            if (restaurant.deliverySettings && distance > restaurant.deliverySettings.maxDeliveryRadius) {
                 return res.status(400).json({ success: false, message: `Address is outside the delivery radius of ${restaurant.deliverySettings.maxDeliveryRadius} miles.` });
            }
            
            if (restaurant.deliverySettings && distance > restaurant.deliverySettings.freeDeliveryRadius) {
                const chargeable = distance - restaurant.deliverySettings.freeDeliveryRadius;
                deliveryFee = Math.round(chargeable * restaurant.deliverySettings.chargePerMile * 100) / 100;
            }
        }

        const { pricing, appliedOffer } = calculateOrderPricing(processedItems, deliveryFee, restaurant);
        
        if (pricing.totalAmount <= 0) {
            return res.status(400).json({ success: false, message: "Order total must be greater than zero." });
        }

        const totalAmountCents = Math.round(pricing.totalAmount * 100);
        const platformKeepAmount = pricing.platformFee;
        const applicationFeeAmountCents = Math.round(platformKeepAmount * 100);

        if (applicationFeeAmountCents < 0 || applicationFeeAmountCents > totalAmountCents) {
             return res.status(500).json({ success: false, message: "Payment calculation error: Application fee invalid." });
        }

        // 5. Create Preliminary Order
        const idempotencyKey = config.featureFlags.enableIdempotencyCheck ? uuidv4() : null;
        
        const newOrder = new Order({
            orderNumber: generateOrderNumber(),
            restaurantId,
            customerId: userId,
            customerDetails: { 
                name: user.fullName || "Customer", 
                phoneNumber: user.phoneNumber,
                email: user.email // Crucial for Invoice
            },
            orderType: isPickup ? 'pickup' : 'delivery',
            deliveryAddress: deliveryAddress || {}, 
            orderedItems: processedItems, 
            pricing, 
            appliedOffer,
            paymentType: 'card',
            paymentStatus: 'pending',
            status: 'awaiting_payment',
            acceptanceStatus: 'pending',
            idempotencyKey
        });

        await newOrder.save();

        // 6. Create Stripe Session
        const clientBaseUrl = config.clientUrls.customer; 
        const successUrl = `${clientBaseUrl}/booking/success?order_session_id={CHECKOUT_SESSION_ID}`;
        const failureUrl = `${clientBaseUrl}/booking/failure?order_session_id={CHECKOUT_SESSION_ID}`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp", 
                    product_data: {
                        name: `Order ${newOrder.orderNumber}`,
                        description: `From ${restaurant.restaurantName} (${isPickup ? 'Pickup' : 'Delivery'})`
                    },
                    unit_amount: totalAmountCents, 
                },
                quantity: 1,
            }],
            mode: "payment",
            payment_intent_data: {
                application_fee_amount: applicationFeeAmountCents,
                transfer_data: {
                    destination: restaurant.stripeAccountId,
                },
            },
            success_url: successUrl,
            cancel_url: failureUrl,
            customer_email: user.email, 
            // METADATA: Essential for Webhook processing & Invoice Generation
            metadata: {
                orderId: newOrder._id.toString(),
                cartType: cartField,
                userId: userId.toString(),
                type: 'order_payment' 
            }
        });

        newOrder.sessionId = session.id;
        await newOrder.save();

        res.status(200).json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        logger.error("Error creating checkout session", { error: error.message, userId: req.user?._id });
        next(error);
    }
};

/**
 * Endpoint to manually verify payment status from frontend success page.
 * Acts as a backup if the Webhook is delayed.
 */
export const verifyPaymentStatus = async (req, res, next) => {
    try {
        const { sessionId } = req.body;
        if(!sessionId) return res.status(400).json({success: false, message: "Session ID required"});

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if(!session || !session.metadata || !session.metadata.orderId) {
             return res.status(404).json({success: false, message: "Invalid Session"});
        }

        const orderId = session.metadata.orderId;
        const order = await Order.findById(orderId).populate('customerId').populate('restaurantId');
        
        if(!order) return res.status(404).json({success: false, message: "Order not found"});

        // If Stripe says paid but DB says pending, update it now
        if (session.payment_status === 'paid' && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'paid';
            
            // Only move status if it was still stuck in awaiting_payment
            if (order.status === 'awaiting_payment') {
                order.status = 'placed';
            }
            
            await order.save();

            // Trigger Invoice Email immediately (Backup to Webhook)
            await sendOrderInvoiceEmail(order);
        }

        return res.status(200).json({ success: true, status: order.paymentStatus });
    } catch (error) {
        logger.error("Verify payment failed", {error: error.message});
        next(error);
    }
};