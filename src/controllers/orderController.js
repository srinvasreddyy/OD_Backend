import mongoose from "mongoose";
import Stripe from "stripe";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import { getPaginationParams } from "../utils/paginationUtils.js";
import { calculateOrderPricing, validateCart, processOrderItems, calculateDeliveryFee } from "../utils/orderCalculation.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import logger from "../utils/logger.js";


/**
 * @description Places a new order for Cash on Delivery.
 * @route POST /api/orders/place-cash-order
 * @access Private (User)
 */
export const placeCashOrder = async (req, res, next) => {
    const { cartType, deliveryAddress, notes } = req.body;
    const userId = req.user?._id;

    const dbSession = await mongoose.startSession();
    try {
        let newOrder;
        await dbSession.withTransaction(async () => {
            // 1. Basic Input Validation
            if (!cartType || !['foodCart', 'groceriesCart'].includes(cartType)) {
                throw { statusCode: 400, message: "A valid cartType ('foodCart' or 'groceriesCart') is required." };
            }
            if (!deliveryAddress || !deliveryAddress.coordinates || !deliveryAddress.coordinates.coordinates) {
                throw { statusCode: 400, message: "A valid delivery address is required." };
            }

            // 2. Fetch User and Cart
            const user = await User.findById(userId).populate(`${cartType}.menuItemId`).session(dbSession);
            if (!user) throw { statusCode: 404, message: "User not found." };
            
            const cart = user[cartType];
            const { error: cartError, restaurantId } = validateCart(cart);
            if (cartError) throw { statusCode: 400, message: cartError };

            // 3. Fetch Restaurant and Check COD Availability
            const restaurant = await Restaurant.findById(restaurantId).session(dbSession).lean();
            if (!restaurant) throw { statusCode: 404, message: `Restaurant with ID ${restaurantId} not found.` };
            if (!restaurant.acceptsCashOnDelivery) {
                throw { statusCode: 400, message: "This restaurant does not accept Cash on Delivery." };
            }
            if (!restaurant.isActive) {
                 throw { statusCode: 400, message: "This restaurant is currently not accepting orders." };
            }

            // 4. Process items and calculate pricing
            const processedItems = await processOrderItems(cart);
            
            const [restLon, restLat] = restaurant.address.coordinates.coordinates;
            const [userLon, userLat] = deliveryAddress.coordinates.coordinates;
            const deliveryFee = calculateDeliveryFee(restLat, restLon, userLat, userLon, restaurant.deliverySettings);
            if (deliveryFee === -1) {
                throw { statusCode: 400, message: "Delivery address is out of the restaurant's range." };
            }

            const { pricing } = calculateOrderPricing(processedItems, deliveryFee, restaurant);

            // 5. Create and Save the Order
            const orderData = new Order({
                orderNumber: generateUniqueOrderNumber(),
                restaurantId,
                customerId: userId,
                customerDetails: { name: user.fullName, phoneNumber: user.phoneNumber },
                orderType: 'delivery',
                deliveryAddress,
                orderedItems: processedItems,
                pricing,
                paymentType: 'cash',
                paymentStatus: 'pending', // Will be marked 'paid' by delivery partner
                acceptanceStatus: 'pending',
                notes: notes || '',
            });

            const savedOrder = await orderData.save({ session: dbSession });
            
            // 6. Clear the user's cart
            user[cartType] = [];
            await user.save({ session: dbSession });

            newOrder = savedOrder;
        });

        return res.status(201).json({ success: true, message: "Order placed successfully!", data: newOrder });
        
    } catch (error) {
        await dbSession.abortTransaction();
        logger.error("Error placing cash order", { error: error.message, statusCode: error.statusCode, userId });
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "An unexpected error occurred while placing the order." });
    } finally {
        dbSession.endSession();
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

export const getUserOrders = async (req, res, next) => {
    try {
        const userId = req.user?._id;
        const { page, limit, skip } = getPaginationParams(req.query);
        const orders = await Order.find({ customerId: userId }).populate('restaurantId', 'restaurantName address').sort({ createdAt: -1 }).skip(skip).limit(limit);
        const totalOrders = await Order.countDocuments({ customerId: userId });
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: page } });
    } catch (error) {
        logger.error("Error fetching user orders", { error: error.message });
        next(error);
    }
};

export const getRestaurantOrders = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant?._id;
        const { status, acceptanceStatus } = req.query;
        const { page, limit, skip } = getPaginationParams(req.query);

        const query = { restaurantId };
        if (status) query.status = status;
        if (acceptanceStatus) query.acceptanceStatus = acceptanceStatus;

        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(limit);
        const totalOrders = await Order.countDocuments(query);

        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: page } });
    } catch (error) {
        logger.error("Error fetching restaurant orders", { error: error.message });
        next(error);
    }
};

export const getNewRestaurantOrders = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant?._id;
        const { page, limit, skip } = getPaginationParams(req.query);
        const query = { restaurantId, status: 'placed', acceptanceStatus: 'pending' };
        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(limit);
        const totalOrders = await Order.countDocuments(query);
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: page } });
    } catch (error) {
        logger.error("Error fetching new restaurant orders", { error: error.message });
        next(error);
    }
};

export const assignDeliveryPartner = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const orderId = req.params?.orderId;
        const deliveryPartnerId = req.body?.deliveryPartnerId;
        const restaurantId = req.restaurant?._id;
        // Use loose check for array existence
        const restaurantPartnerList = req.restaurant?.deliveryPartners || [];

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
        if (order.status === 'out_for_delivery' || order.status === 'delivered') {
             return res.status(400).json({ success: false, message: "This order has already been assigned or delivered." });
        }

        // Verify the partner is associated with this restaurant
        const isAssociated = restaurantPartnerList.some(id => id.toString() === deliveryPartnerId);
        if (!isAssociated) {
            return res.status(403).json({ success: false, message: "This delivery partner is not associated with your restaurant." });
        }
        
        const deliveryPartner = await User.findOne({ _id: deliveryPartnerId, userType: 'delivery_partner' }).session(session);
        if (!deliveryPartner) {
            return res.status(404).json({ success: false, message: "Delivery partner not found." });
        }
        
        // Strict availability check. 
        if (!deliveryPartner.deliveryPartnerProfile?.isAvailable) {
            return res.status(409).json({ success: false, message: "This delivery partner is currently unavailable for new orders." });
        }

        order.assignedDeliveryPartnerId = deliveryPartnerId;
        order.status = 'out_for_delivery';
        
        // Mark partner as busy
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
        const orderId = req.params?.orderId;
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
            'out_for_delivery': ['delivered', 'cancelled'],
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
        const restaurantId = req.restaurant?._id;
        
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
    const restaurantId = req.restaurant?._id;
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
    const restaurantId = req.restaurant?._id;

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
    const restaurantId = req.restaurant?._id;

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