import mongoose from "mongoose";
import Stripe from "stripe";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import MenuItem from "../models/MenuItem.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import { getDistanceFromLatLonInMiles } from "../utils/locationUtils.js";
import logger from "../utils/logger.js";
import { getPaginationParams } from "../utils/paginationUtils.js";

// --- Helper Functions ---

const validateCart = (cart) => {
    if (!cart || cart.length === 0) {
        return { error: "Cannot place an order with an empty cart." };
    }
    const restaurantId = cart[0].menuItemId.restaurantId._id.toString();
    return { error: null, restaurantId };
};

const processOrderItems = (cart, restaurant) => {
    return cart.map(cartItem => {
        const { menuItemId: menuItem, quantity, selectedVariant, selectedAddons } = cartItem;
        let lineItemSubtotalBeforeQuantity = menuItem.basePrice;

        const variantsDetails = [];
        if (selectedVariant?.variantId) {
            const group = menuItem.variantGroups.find(g => g.groupId === selectedVariant.groupId);
            const variant = group?.variants.find(v => v.variantId === selectedVariant.variantId);
            if (variant) {
                lineItemSubtotalBeforeQuantity += (variant.additionalPrice || 0);
                variantsDetails.push({ ...selectedVariant, variantName: variant.variantName, additionalPrice: variant.additionalPrice });
            }
        }

        const addonsDetails = [];
        if (selectedAddons?.length) {
            selectedAddons.forEach(addon => {
                const group = menuItem.addonGroups.find(g => g.groupId === addon.groupId);
                const option = group?.addons.find(a => a.addonId === addon.addonId);
                if (option) {
                    lineItemSubtotalBeforeQuantity += (option.price || 0);
                    addonsDetails.push({ ...addon, optionTitle: option.optionTitle, price: option.price });
                }
            });
        }

        const itemSubTotal = lineItemSubtotalBeforeQuantity * quantity;
        
        return {
            itemId: menuItem._id,
            itemName: menuItem.itemName,
            basePrice: menuItem.basePrice,
            quantity,
            selectedVariants: variantsDetails,
            selectedAddons: addonsDetails,
            itemTotal: itemSubTotal,
        };
    });
};

const calculateOrderPricing = (processedItems, deliveryFee, restaurant) => {
    const subtotal = processedItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const handlingCharge = subtotal * (restaurant.handlingChargesPercentage / 100);
    const totalAmount = subtotal + handlingCharge + deliveryFee;

    return { 
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee,
        handlingCharge: Math.round(handlingCharge * 100) / 100, 
        totalAmount: Math.round(totalAmount * 100) / 100 
    };
};

const calculateDeliveryFee = (distance, settings) => {
    if (distance > settings.maxDeliveryRadius) {
        return -1; // Out of range
    }
    if (distance <= settings.freeDeliveryRadius) {
        return 0;
    }
    const chargeableDistance = distance - settings.freeDeliveryRadius;
    return Math.round(chargeableDistance * settings.chargePerMile * 100) / 100;
};

function createOrderObject({
    user, restaurantId, orderType, deliveryAddress, orderedItemsToSave,
    pricing, paymentType, sessionId = null
}) {
    return new Order({
        _id: new mongoose.Types.ObjectId(),
        orderNumber: generateUniqueOrderNumber(),
        restaurantId,
        customerId: user._id,
        customerDetails: { name: user.fullName, phoneNumber: user.phoneNumber },
        orderType,
        deliveryAddress: orderType === 'delivery' ? deliveryAddress : null,
        orderedItems: orderedItemsToSave,
        pricing,
        paymentType,
        paymentStatus: paymentType === 'card' ? 'paid' : 'pending',
        acceptanceStatus: 'pending',
        ...(sessionId ? { sessionId } : {})
    });
}

// --- Main Controller ---

export const placeOrder = async (req, res, next) => {
    const userId = req.user?._id;
    const { orderType, deliveryAddress, paymentType, cartType, sessionId } = req.body;

    // Validation
    if (!['delivery', 'pickup', 'dine-in'].includes(orderType)) {
        return res.status(400).json({ success: false, message: "Invalid order type specified." });
    }
    if (orderType === 'delivery' && (!deliveryAddress || !deliveryAddress.coordinates)) {
        return res.status(400).json({ success: false, message: "Delivery address with coordinates is required for delivery orders." });
    }
    if (!cartType || !['foodCart', 'groceriesCart'].includes(cartType)) {
        return res.status(400).json({ success: false, message: "A valid cart type ('foodCart' or 'groceriesCart') is required." });
    }

    const session = await mongoose.startSession();
    try {
        let finalOrder;
        await session.withTransaction(async () => {
            const user = await User.findById(userId).populate({
                path: `${cartType}.menuItemId`,
                populate: { path: 'restaurantId', select: '+stripeSecretKey' } // Crucial: populate restaurant and its key
            }).session(session);

            if (!user) throw new Error("Authenticated user not found in database.");

            const cart = user[cartType];
            const { error: cartError, restaurantId } = validateCart(cart);
            if (cartError) {
                const e = new Error(cartError); e.statusCode = 400; throw e;
            }

            const restaurant = cart[0].menuItemId.restaurantId;
            if (!restaurant) throw new Error("Restaurant data could not be loaded from cart.");

            // --- Re-fetch fresh item data for price & availability integrity ---
            const itemIds = cart.map(item => item.menuItemId._id);
            const freshMenuItems = await MenuItem.find({ '_id': { $in: itemIds } }).session(session).lean();
            const freshMenuItemsMap = new Map(freshMenuItems.map(item => [item._id.toString(), item]));

            const cartWithFreshData = cart.map(cartItem => {
                const freshItem = freshMenuItemsMap.get(cartItem.menuItemId._id.toString());
                if (!freshItem) throw new Error(`Item "${cartItem.menuItemId.itemName}" is no longer available.`);
                return { ...cartItem, menuItemId: freshItem };
            });

            const processedItems = processOrderItems(cartWithFreshData, restaurant);
            
            let deliveryFee = 0;
            if (orderType === 'delivery') {
                const [restLon, restLat] = restaurant.address.coordinates.coordinates;
                const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
                const distance = getDistanceFromLatLonInMiles(restLat, restLon, userLat, userLon);
                
                deliveryFee = calculateDeliveryFee(distance, restaurant.deliverySettings);
                if (deliveryFee === -1) {
                    const e = new Error(`This address is outside the restaurant's ${restaurant.deliverySettings.maxDeliveryRadius} mile delivery radius.`);
                    e.statusCode = 400;
                    throw e;
                }
            }

            const pricing = calculateOrderPricing(processedItems, deliveryFee, restaurant);
            
            if (paymentType === 'card') {
                if (!sessionId) { const e = new Error("sessionId is required for card payments."); e.statusCode = 400; throw e; }
                if (!restaurant.stripeSecretKey) { throw new Error("Restaurant has not configured payments."); }
                
                const stripe = new Stripe(restaurant.stripeSecretKey);
                const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

                if (checkoutSession.payment_status !== 'paid') { const e = new Error("Payment not completed."); e.statusCode = 400; throw e; }
                
                const stripeAmount = checkoutSession.amount_total;
                const backendAmount = Math.round(pricing.totalAmount * 100);
                if (stripeAmount !== backendAmount) { const e = new Error(`Price mismatch. Expected ${pricing.totalAmount}. Please try again.`); e.statusCode = 409; throw e; }

                const existingOrder = await Order.findOne({ sessionId }).session(session);
                if (existingOrder) { finalOrder = existingOrder; return; }
            }
            
            const order = createOrderObject({ user, restaurantId, orderType, deliveryAddress, orderedItemsToSave: processedItems, pricing, paymentType, sessionId });
            await order.save({ session });
            finalOrder = order;

            user[cartType] = [];
            await user.save({ session });
        });

        await session.commitTransaction();
        return res.status(201).json({ success: true, message: "Order placed successfully!", data: finalOrder });

    } catch (error) {
        await session.abortTransaction();
        logger.error("Error placing order", { error: error.message, statusCode: error.statusCode });
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "An unexpected error occurred." });
    } finally {
        session.endSession();
    }
};

export const respondToOrder = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const { acceptance } = req.body;
        const restaurantId = req.restaurant?._id;

        if (!['accepted', 'rejected'].includes(acceptance)) {
            return res.status(400).json({ success: false, message: "Invalid acceptance value." });
        }

        const order = await Order.findById(orderId).populate({ path: 'restaurantId', select: '+stripeSecretKey' });
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });
        if (order.restaurantId._id.toString() !== restaurantId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to modify this order." });
        }
        if (order.acceptanceStatus !== 'pending') {
            return res.status(400).json({ success: false, message: `This order has already been ${order.acceptanceStatus}.` });
        }
        
        if (acceptance === 'rejected' && order.paymentType === 'card' && order.paymentStatus === 'paid') {
            if (!order.restaurantId.stripeSecretKey) {
                return res.status(500).json({ success: false, message: "Cannot process refund: Restaurant payment key is not configured." });
            }
            try {
                const stripe = new Stripe(order.restaurantId.stripeSecretKey);
                const checkoutSession = await stripe.checkout.sessions.retrieve(order.sessionId);
                if (checkoutSession.payment_intent) {
                    await stripe.refunds.create({ payment_intent: checkoutSession.payment_intent });
                    order.paymentStatus = 'refunded';
                }
            } catch (refundError) {
                logger.error("Stripe refund failed", { orderId, error: refundError.message });
                return res.status(500).json({ success: false, message: "Refund could not be processed." });
            }
        }

        order.acceptanceStatus = acceptance;
        if (acceptance === 'rejected') order.status = 'cancelled';

        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: `Order successfully ${acceptance}.`, data: updatedOrder });

    } catch (error) {
        logger.error("Error responding to order", { error: error.message });
        next(error);
    }
};

// ... other functions like getUserOrders, getRestaurantOrders, etc. remain largely the same ...
// But cancelOrder needs to be updated for Stripe refunds

export const cancelOrder = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let cancelledOrder;
        await session.withTransaction(async () => {
            const { orderId } = req.params;
            const userId = req.user?._id;

            const order = await Order.findById(orderId).populate({ path: 'restaurantId', select: '+stripeSecretKey' }).session(session);

            if (!order) { const e = new Error("Order not found."); e.statusCode = 404; throw e; }
            if (order.customerId.toString() !== userId.toString()) { const e = new Error("You are not authorized to cancel this order."); e.statusCode = 403; throw e; }
            if (order.acceptanceStatus !== 'pending') { const e = new Error(`This order cannot be cancelled as it has already been ${order.acceptanceStatus}.`); e.statusCode = 400; throw e; }

            if (order.paymentType === 'card' && order.paymentStatus === 'paid') {
                if (!order.restaurantId.stripeSecretKey) { throw new Error("Cannot process refund: Restaurant payment key not configured."); }
                try {
                    const stripe = new Stripe(order.restaurantId.stripeSecretKey);
                    const checkoutSession = await stripe.checkout.sessions.retrieve(order.sessionId);
                    if (checkoutSession.payment_intent) {
                        await stripe.refunds.create({ payment_intent: checkoutSession.payment_intent });
                        order.paymentStatus = 'refunded';
                    }
                } catch (refundError) {
                    logger.error("Stripe refund failed on order cancellation", { orderId, error: refundError.message });
                    throw new Error("Order cancellation failed because the refund could not be processed.");
                }
            }

            order.status = 'cancelled';
            cancelledOrder = await order.save({ session });
        });

        return res.status(200).json({ success: true, message: "Order has been cancelled successfully.", data: cancelledOrder });
    } catch (error) {
        await session.abortTransaction();
        logger.error("Error cancelling order", { error: error.message, statusCode: error.statusCode });
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "An unexpected error occurred." });
    } finally {
        session.endSession();
    }
};

// ... ALL OTHER GET/REPORTING FUNCTIONS in orderController.js remain the same ...
// For brevity, I am omitting getRestaurantStats, getUserOrders, etc. as they don't require changes for this feature.
// Here is one example of an unmodified function for context.
export const getUserOrders = async (req, res, next) => {
    try {
        const  userId  = req.user?._id;
        const { page, limit, skip } = getPaginationParams(req.query);
        const orders = await Order.find({ customerId: userId }).populate('restaurantId', 'restaurantName address').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments({ customerId: userId });
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        logger.error("Error fetching user orders", { error: error.message });
        next(error);
    }
};

// --- Copying over the rest of the existing, unmodified functions from the original file ---
export const getRestaurantOrders = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const { status, acceptanceStatus } = req.query; // Added acceptanceStatus from original
        const { page, limit, skip } = getPaginationParams(req.query);

        const query = { restaurantId };
        if (status) query.status = status;
        if (acceptanceStatus) query.acceptanceStatus = acceptanceStatus;

        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments(query);

        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        logger.error("Error fetching restaurant orders", { error: error.message });
        next(error);
    }
};

export const getNewRestaurantOrders = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
       const { page, limit, skip } = getPaginationParams(req.query);
        const query = { restaurantId, status: 'placed', acceptanceStatus: 'pending' };
        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments(query);
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        logger.error("Error fetching new restaurant orders", { error: error.message });
        next(error);
    }
};

export const assignDeliveryPartner = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const  orderId  = req.params?.orderId;
        const  deliveryPartnerId  = req.body?.deliveryPartnerId;
        const restaurantId = req.restaurant?._id
        const restaurantPartnerList = req.restaurant?.deliveryPartners

        if (!mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
            return res.status(400).json({ success: false, message: "Invalid delivery partner ID format." });
        }

        const order = await Order.findById(orderId).session(session);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });
        if (order.restaurantId.toString() !== restaurantId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to modify this order." });
        }
        if (order.orderType !== 'delivery') {
            return res.status(400).json({ success: false, message: "Cannot assign a delivery partner to a non-delivery order." });
        }
        if (order.acceptanceStatus !== 'accepted') {
            return res.status(400).json({ success: false, message: "Cannot assign delivery partner to an order that has not been accepted." });
        }

        const isAssociated = restaurantPartnerList.some(id => id.toString() === deliveryPartnerId);
        if (!isAssociated) {
            return res.status(403).json({ success: false, message: "This delivery partner is not associated with your restaurant." });
        }
        
        const deliveryPartner = await User.findOne({ _id: deliveryPartnerId, userType: 'delivery_partner' }).session(session);
        if (!deliveryPartner) {
            return res.status(404).json({ success: false, message: "Delivery partner not found." });
        }
        if (!deliveryPartner.deliveryPartnerProfile?.isAvailable) {
            return res.status(409).json({ success: false, message: "This delivery partner is currently unavailable for new orders." });
        }

        order.assignedDeliveryPartnerId = deliveryPartnerId;
        order.status = 'out_for_delivery';
        
        deliveryPartner.deliveryPartnerProfile.isAvailable = false;

        await order.save({ session });
        await deliveryPartner.save({ session });

        await session.commitTransaction();
        
        return res.status(200).json({ success: true, message: "Delivery partner assigned successfully.", data: order });

    } catch (error) {
        await session.abortTransaction();
        logger.error("Error assigning delivery partner", { error: error.message });
        next(error);
    } finally {
        session.endSession();
    }
};

export const getOrderDetails = async (req, res, next) => {
    try {
        const  orderId  = req.params?.orderId;
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid order ID format." });
        }
        const order = await Order.findById(orderId).populate('restaurantId', 'restaurantName address').populate('customerId', 'fullName email');
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        const isCustomer = req.user && order.customerId._id.toString() === req.user._id.toString();
        const isOwner = req.restaurant && order.restaurantId._id.toString() === req.restaurant._id.toString();
        
        if (!isCustomer && !isOwner) {
            return res.status(403).json({ success: false, message: "You are not authorized to view this order." });
        }
        
        return res.status(200).json({ success: true, data: order });
    } catch (error) {
        logger.error("Error fetching order details", { error: error.message });
        next(error);
    }
};

export const updateOrderStatus = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        const restaurantId = req.restaurant?._id;

        if (!status) {
            return res.status(400).json({ success: false, message: "No status provided for update." });
        }
        
        const order = await Order.findOne({ _id: orderId, restaurantId: restaurantId });
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found or you are not authorized to update it." });
        }

        const allowedTransitions = {
            'placed': ['out_for_delivery', 'cancelled'],
            'out_for_delivery': ['delivered'],
            'delivered': [],
            'cancelled': [],
        };

        if (order.acceptanceStatus !== 'accepted' && status !== 'cancelled') {
             return res.status(400).json({ success: false, message: "Order must be accepted before its status can be updated."});
        }

        if (!allowedTransitions[order.status]?.includes(status)) {
            return res.status(400).json({ success: false, message: `Invalid status transition from '${order.status}' to '${status}'.` });
        }
        
        order.status = status;
        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: "Order updated successfully.", data: updatedOrder });

    } catch (error) {
        logger.error("Error updating order status", { error: error.message });
        next(error);
    }
};

export const getRestaurantStats = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        
        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        const stats = await Order.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
            {
                $facet: {
                    "overallStats": [
                        { $group: { _id: null, totalOrders: { $sum: 1 }, totalDelivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } }, totalCancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } }, totalIncome: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$pricing.totalAmount", 0] } } } }
                    ],
                    "monthlyIncome": [
                        { $match: { status: "delivered" } },
                        { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, totalIncome: { $sum: "$pricing.totalAmount" } } },
                        { $sort: { "_id.year": 1, "_id.month": 1 } }
                    ],
                    "currentMonthStats": [
                        { $match: { createdAt: { $gte: currentMonthStart } } },
                        { $group: { _id: null, orders: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } }, income: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$pricing.totalAmount", 0] } } } }
                    ],
                    "lastMonthStats": [
                        { $match: { createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
                        { $group: { _id: null, orders: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } }, income: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$pricing.totalAmount", 0] } } } }
                    ]
                }
            }
        ]);

        const overall = stats[0].overallStats[0] || { totalOrders: 0, totalDelivered: 0, totalCancelled: 0, totalIncome: 0 };
        const monthly = stats[0].monthlyIncome;
        const currentMonth = stats[0].currentMonthStats[0] || { orders: 0, delivered: 0, income: 0 };
        const lastMonth = stats[0].lastMonthStats[0] || { orders: 0, delivered: 0, income: 0 };

        const calculatePercentageChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100 * 100) / 100;
        };

        const comparison = {
            orders: { current: currentMonth.orders, previous: lastMonth.orders, change: calculatePercentageChange(currentMonth.orders, lastMonth.orders) },
            income: { current: currentMonth.income, previous: lastMonth.income, change: calculatePercentageChange(currentMonth.income, lastMonth.income) },
            delivered: { current: currentMonth.delivered, previous: lastMonth.delivered, change: calculatePercentageChange(currentMonth.delivered, lastMonth.delivered) }
        };

        return res.status(200).json({
            success: true,
            data: {
                overall,
                monthlyIncome: monthly,
                comparison
            }
        });

    } catch (error) {
        logger.error("Error fetching restaurant stats", { error: error.message });
        next(error);
    }
};

export const getRestaurantSalesReport = async (req, res, next) => {
    const restaurantId  = req.restaurant?._id;
    const { startDate, endDate } = req.query;

    try {
        const matchStage = {
            restaurantId: new mongoose.Types.ObjectId(restaurantId),
            status: 'delivered',
            createdAt: {}
        };

        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) matchStage.createdAt.$lte = new Date(endDate);
        if (!startDate && !endDate) {
            matchStage.createdAt.$gte = new Date(new Date().setDate(new Date().getDate() - 30));
        }

        const salesReport = await Order.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$pricing.totalAmount" },
                    totalOrders: { $sum: 1 },
                    averageOrderValue: { $avg: "$pricing.totalAmount" }
                }
            }
        ]);

        return res.status(200).json({
            success: true,
            data: salesReport[0] || { totalRevenue: 0, totalOrders: 0, averageOrderValue: 0 }
        });

    } catch (error) {
        logger.error("Error generating sales report", { error: error.message });
        next(error);
    }
};

export const getRestaurantOrdersReport = async (req, res, next) => {
    const  restaurantId  = req.restaurant?._id;

    try {
        const ordersReport = await Order.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
            {
                $facet: {
                    "byStatus": [
                        { $group: { _id: "$status", count: { $sum: 1 } } }
                    ],
                    "byOrderType": [
                        { $group: { _id: "$orderType", count: { $sum: 1 } } }
                    ]
                }
            }
        ]);

        return res.status(200).json({
            success: true,
            data: {
                statusReport: ordersReport[0].byStatus,
                orderTypeReport: ordersReport[0].byOrderType
            }
        });

    } catch (error) {
        logger.error("Error generating orders report", { error: error.message });
        next(error);
    }
};

export const getMenuItemPerformance = async (req, res, next) => {
    const  restaurantId  = req.restaurant?._id;

    try {
        const itemPerformance = await Order.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId), status: 'delivered' } },
            { $unwind: "$orderedItems" },
            {
                $group: {
                    _id: "$orderedItems.itemId",
                    itemName: { $first: "$orderedItems.itemName" },
                    totalQuantitySold: { $sum: "$orderedItems.quantity" },
                    totalRevenue: { $sum: "$orderedItems.itemTotal" }
                }
            },
            { $sort: { totalQuantitySold: -1 } }
        ]);

        return res.status(200).json({
            success: true,
            data: itemPerformance
        });

    } catch (error) {
        logger.error("Error generating menu item performance report", { error: error.message });
        next(error);
    }
};