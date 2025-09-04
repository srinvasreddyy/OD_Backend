import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import Restaurant from "../models/Restaurant.js";
import { DELIVERY_FEE } from "../../constants.js";
import logger from "../utils/logger.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Helper Functions (omitted for brevity, no changes) ---
const validateCart = (cart) => {
    if (!cart || cart.length === 0) {
        return { error: "Cannot place an order with an empty cart." };
    }
    const firstItemRestaurantId = cart[0].menuItemId.restaurantId.toString();
    for (const item of cart) {
        if (item.menuItemId.restaurantId.toString() !== firstItemRestaurantId) {
            return { error: "All items in the order must be from the same restaurant." };
        }
    }
    return { error: null, restaurantId: firstItemRestaurantId };
};
const processCartItems = (cart) => {
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
        const itemTax = itemSubTotal * (menuItem.gst / 100);

        return {
            itemId: menuItem._id,
            itemName: menuItem.itemName,
            basePrice: menuItem.basePrice,
            quantity,
            selectedVariants: variantsDetails,
            selectedAddons: addonsDetails,
            itemTotal: itemSubTotal,
            _itemTax: itemTax,
        };
    });
};
const calculateOrderPricing = (processedItems) => {
    const subtotal = processedItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const tax = processedItems.reduce((acc, item) => acc + item._itemTax, 0);
    const totalAmount = subtotal + tax + DELIVERY_FEE;
    return { subtotal, deliveryFee: DELIVERY_FEE, tax: Math.round(tax * 100) / 100, totalAmount: Math.round(totalAmount * 100) / 100 };
};



// Helper to create order object
function createOrderObject({
    user,
    restaurantId,
    orderType,
    deliveryAddress,
    orderedItemsToSave,
    pricing,
    paymentType,
    sessionId = null
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

// --- Main Controller Functions ---
export const placeOrder = async (req, res, next) => {
    const userId = req.user?._id;
    const { orderType, deliveryAddress, paymentType, cartType, sessionId } = req.body;

    if (!['delivery', 'pickup', 'dine-in'].includes(orderType)) {
        return res.status(400).json({ success: false, message: "Invalid order type specified." });
    }
    if (orderType === 'delivery' && !deliveryAddress) {
        return res.status(400).json({ success: false, message: "Delivery address is required for delivery orders." });
    }
    if (!cartType || !['foodCart', 'groceriesCart'].includes(cartType)) {
        return res.status(400).json({ success: false, message: "A valid cart type ('foodCart' or 'groceriesCart') is required." });
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await User.findById(userId).populate(`${cartType}.menuItemId`).session(session);
        if (!user) {
            throw new Error("Authenticated user not found in database.");
        }

        const { error: cartError, restaurantId } = validateCart(user[cartType]);
        if (cartError) {
            return res.status(400).json({ success: false, message: cartError });
        }

        const restaurant = await Restaurant.findById(restaurantId).session(session).lean();
        if (!restaurant) {
            throw new Error("Restaurant not found.");
        }
        if ((restaurant.restaurantType === 'groceries' || restaurant.restaurantType === 'food_delivery') && orderType === 'dine-in') {
            return res.status(400).json({ success: false, message: "Dine-in is not available for this restaurant." });
        }

        const processedItems = processCartItems(user[cartType]);
        const pricing = calculateOrderPricing(processedItems);
        const orderedItemsToSave = processedItems.map(({ _itemTax, ...rest }) => rest);

        // Payment logic
        if (paymentType === 'cash') {
            const order = createOrderObject({
                user,
                restaurantId,
                orderType,
                deliveryAddress,
                orderedItemsToSave,
                pricing,
                paymentType
            });
            await order.save({ session });
            user[cartType] = [];
            await user.save({ session });
            await session.commitTransaction();
            return res.status(201).json({ success: true, message: "Order placed successfully! Waiting for restaurant to accept.", data: order });
        } else if (paymentType === 'card') {
            if (!sessionId) {
                return res.status(400).json({ success: false, message: "sessionId is required for card payments." });
            }
            let checkoutSession;
            try {
                checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
            } catch (err) {
                return res.status(400).json({ success: false, message: "Invalid Stripe sessionId." });
            }
            if (checkoutSession.payment_status !== 'paid') {
                return res.status(400).json({ success: false, message: "Payment not completed." });
            }
            // Safety check: Stripe amount vs backend total
            const stripeAmount = checkoutSession.amount_total;
            const backendAmount = Math.round((pricing.totalAmount || pricing.grandTotal) * 100); // Stripe uses cents
            if (stripeAmount !== backendAmount) {
                return res.status(400).json({ success: false, message: "Payment amount mismatch. Please contact support." });
            }
            // Check for duplicate order
            const existingOrder = await Order.findOne({ sessionId }).session(session);
            if (existingOrder) {
                await session.commitTransaction();
                return res.status(200).json({ success: true, message: "Order already exists for this payment.", data: existingOrder });
            }
            // Create order
            const order = createOrderObject({
                user,
                restaurantId,
                orderType,
                deliveryAddress,
                orderedItemsToSave,
                pricing,
                paymentType,
                sessionId
            });
            await order.save({ session });
            user[cartType] = [];
            await user.save({ session });
            await session.commitTransaction();
            return res.status(201).json({ success: true, message: "Order placed successfully! Waiting for restaurant to accept.", data: order });
        } else {
            return res.status(400).json({ success: false, message: "Invalid payment type." });
        }

    } catch (error) {
        await session.abortTransaction();
        logger.error("Error placing order", { error: error.message });
        next(error);
    } finally {
        session.endSession();
    }
};

export const getUserOrders = async (req, res, next) => {
    try {
        const  userId  = req.user?._id;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const orders = await Order.find({ customerId: userId }).populate('restaurantId', 'restaurantName address').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments({ customerId: userId });
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        logger.error("Error fetching user orders", { error: error.message });
        next(error);
    }
};

export const getRestaurantOrders = async (req, res, next) => {
    try {
        const  restaurantId  = req.restaurant?._id;
        const { page = 1, limit = 10, status, acceptanceStatus } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

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
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const query = { restaurantId, status: 'placed', acceptanceStatus: 'pending' };
        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments(query);
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        logger.error("Error fetching new restaurant orders", { error: error.message });
        next(error);
    }
};

export const respondToOrder = async (req, res, next) => {
    try {
        const orderId  = req.params?.orderId;
        const acceptance  = req.body?.acceptance; 
        const  restaurantId  = req.restaurant?._id;

        if (!['accepted', 'rejected'].includes(acceptance)) {
            return res.status(400).json({ success: false, message: "Invalid acceptance value. Must be 'accepted' or 'rejected'." });
        }
        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });
        if (order.restaurantId.toString() !== restaurantId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to modify this order." });
        }
        if (order.acceptanceStatus !== 'pending') {
            return res.status(400).json({ success: false, message: `This order has already been ${order.acceptanceStatus}.` });
        }

        order.acceptanceStatus = acceptance;
        if (acceptance === 'rejected') {
            order.status = 'cancelled';
        }
        
        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: `Order successfully ${acceptance}.`, data: updatedOrder });

    } catch (error) {
        logger.error("Error responding to order", { error: error.message });
        next(error);
    }
};

export const assignDeliveryPartner = async (req, res, next) => {
    try {
        const  orderId  = req.params?.orderId;
        const  deliveryPartnerId  = req.body?.deliveryPartnerId;
        const restaurantId = req.restaurant?._id
        const restaurantPartnerList = req.restaurant?.deliveryPartners
        if (!mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
            return res.status(400).json({ success: false, message: "Invalid delivery partner ID format." });
        }

        const order = await Order.findById(orderId);
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

        // --- NEW VALIDATION ---
        // 1. Check if the partner belongs to this restaurant
        const isAssociated = restaurantPartnerList.some(id => id.toString() === deliveryPartnerId);
        if (!isAssociated) {
            return res.status(403).json({ success: false, message: "This delivery partner is not associated with your restaurant." });
        }
        
        // 2. Check if the delivery partner is available for duty
        const deliveryPartner = await User.findOne({ _id: deliveryPartnerId, userType: 'delivery_partner' });
        if (!deliveryPartner) {
            return res.status(404).json({ success: false, message: "Delivery partner not found." });
        }
        if (!deliveryPartner.deliveryPartnerProfile?.isAvailable) {
            return res.status(409).json({ success: false, message: "This delivery partner is currently unavailable for new orders." });
        }
        // --- END NEW VALIDATION ---

        order.assignedDeliveryPartnerId = deliveryPartnerId;
        order.status = 'out_for_delivery'; 
        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: "Delivery partner assigned successfully.", data: updatedOrder });

    } catch (error) {
        logger.error("Error assigning delivery partner", { error: error.message });
        next(error);
    }
};

/**
 * @description Retrieves details for a single order, accessible by the customer or restaurant owner.
 * @access Private (Customer or Restaurant Owner)
 */
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

        // Authorization Check: The controller is now used by two different routes.
        // We check if either req.user (from validateUser) or req.restaurant (from validateRestaurant) is present.
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
        const orderId  = req.params?.orderId;
        const { status, paymentStatus } = req.body;
        const restaurantId = req.restaurant?._id;

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid order ID format." });
        }
        const updates = {};
        if (status) {
            if (!['placed', 'out_for_delivery', 'delivered', 'cancelled'].includes(status)) {
                return res.status(400).json({ success: false, message: "Invalid 'status' value provided." });
            }
            updates.status = status;
        }
        if (paymentStatus) {
            if (!['pending', 'paid', 'failed', 'refunded'].includes(paymentStatus)) {
                return res.status(400).json({ success: false, message: "Invalid 'paymentStatus' value provided." });
            }
            updates.paymentStatus = paymentStatus;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields provided for update." });
        }
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }
        if (order.restaurantId.toString() !== restaurantId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to update this order." });
        }
        Object.assign(order, updates);
        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: "Order updated successfully.", data: updatedOrder });
    } catch (error) {
        logger.error("Error updating order status", { error: error.message });
        next(error);
    }
};

export const cancelOrder = async (req, res, next) => {
    try {
        const orderId  = req.params?.orderId;
        const userId = req.user?._id;
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid order ID format." });
        }
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }
        if (order.customerId.toString() !== userId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to cancel this order." });
        }
        if (order.acceptanceStatus !== 'pending') {
            return res.status(400).json({ success: false, message: `This order cannot be cancelled as it has already been ${order.acceptanceStatus}.` });
        }
        order.status = 'cancelled';
        const cancelledOrder = await order.save();
        return res.status(200).json({ success: true, message: "Order has been cancelled successfully.", data: cancelledOrder });
    } catch (error) {
        logger.error("Error cancelling order", { error: error.message });
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