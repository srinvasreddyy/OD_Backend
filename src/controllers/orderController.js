import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import Restaurant from "../models/Restaurant.js";
import { DELIVERY_FEE } from "../../constants.js";

// --- Helper Functions for Code Clarity and Reusability ---

/**
 * Validates a user's cart to ensure it's not empty and all items belong to a single restaurant.
 * @param {Array} cart - The user's cart, populated with menu item details.
 * @returns {{error: string|null, restaurantId: string|null}} - An object containing an error message or the restaurant ID.
 */
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

/**
 * Processes each cart item to calculate its total price, including variants and addons, and the applicable tax.
 * @param {Array} cart - The user's cart array.
 * @returns {Array} An array of processed items with their calculated totals and tax.
 */
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
            _itemTax: itemTax, // Internal property to be used for final price calculation
        };
    });
};

/**
 * Calculates the final pricing for the entire order (subtotal, tax, delivery fee, total).
 * @param {Array} processedItems - The array of processed items with their individual totals and tax.
 * @returns {Object} An object containing the final pricing details.
 */
const calculateOrderPricing = (processedItems) => {
    const subtotal = processedItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const tax = processedItems.reduce((acc, item) => acc + item._itemTax, 0);
    const totalAmount = subtotal + tax + DELIVERY_FEE;
    return { subtotal, deliveryFee: DELIVERY_FEE, tax: Math.round(tax * 100) / 100, totalAmount: Math.round(totalAmount * 100) / 100 };
};


// --- Main Controller Functions ---

/**
 * @description Creates a new order from the user's cart. Wrapped in a transaction.
 * @access Private (Customer)
 */
export const placeOrder = async (req, res) => {
    const { _id: userId } = req.user;
    const { orderType, deliveryAddress, paymentType, cartType } = req.body;

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

        // --- Validation based on restaurantType ---
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

        const order = new Order({
            _id: new mongoose.Types.ObjectId(),
            orderNumber: generateUniqueOrderNumber(),
            restaurantId,
            customerId: userId,
            customerDetails: { name: user.fullName, phoneNumber: user.phoneNumber },
            orderType,
            deliveryAddress: orderType === 'delivery' ? deliveryAddress : null,
            orderedItems: orderedItemsToSave,
            pricing,
            paymentType,
            acceptanceStatus: 'pending',
        });

        await order.save({ session });
        user[cartType] = [];
        await user.save({ session });

        await session.commitTransaction();
        return res.status(201).json({ success: true, message: "Order placed successfully! Waiting for restaurant to accept.", data: order });

    } catch (error) {
        await session.abortTransaction();
        console.error("Error placing order:", error);
        return res.status(500).json({ success: false, message: error.message || "An internal server error occurred." });
    } finally {
        session.endSession();
    }
};

/**
 * @description Retrieves a paginated list of all orders for the logged-in customer.
 * @access Private (Customer)
 */
export const getUserOrders = async (req, res) => {
    try {
        const { _id: userId } = req.user;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const orders = await Order.find({ customerId: userId }).populate('restaurantId', 'restaurantName address').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments({ customerId: userId });
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        console.error("Error fetching user orders:", error);
        return res.status(500).json({ success: false, message: "Failed to retrieve your orders." });
    }
};

/**
 * @description Retrieves a paginated list of all orders for the logged-in restaurant owner, with optional filters.
 * @access Private (Restaurant Owner)
 */
export const getRestaurantOrders = async (req, res) => {
    try {
        const { id: restaurantId } = req.restaurant;
        const { page = 1, limit = 10, status, acceptanceStatus } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = { restaurantId };
        if (status) query.status = status;
        if (acceptanceStatus) query.acceptanceStatus = acceptanceStatus;

        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments(query);

        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        console.error("Error fetching restaurant orders:", error);
        return res.status(500).json({ success: false, message: "Failed to retrieve restaurant orders." });
    }
};

/**
 * @description Retrieves a paginated list of new orders awaiting acceptance for the restaurant owner.
 * @access Private (Restaurant Owner)
 */
export const getNewRestaurantOrders = async (req, res) => {
    try {
        const { id: restaurantId } = req.restaurant;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const query = { restaurantId, status: 'placed', acceptanceStatus: 'pending' };
        const orders = await Order.find(query).populate('customerId', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const totalOrders = await Order.countDocuments(query);
        return res.status(200).json({ success: true, data: orders, pagination: { total: totalOrders, pages: Math.ceil(totalOrders / limit), currentPage: parseInt(page) } });
    } catch (error) {
        console.error("Error fetching new restaurant orders:", error);
        return res.status(500).json({ success: false, message: "Failed to retrieve new orders." });
    }
};

/**
 * @description Allows a restaurant owner to accept or reject a new order.
 * @access Private (Restaurant Owner)
 */
export const respondToOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { acceptance } = req.body; // Expects 'accepted' or 'rejected'
        const { id: restaurantId } = req.restaurant;

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
            order.status = 'cancelled'; // Automatically cancel if rejected
        }
        
        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: `Order successfully ${acceptance}.`, data: updatedOrder });

    } catch (error) {
        console.error("Error responding to order:", error);
        return res.status(500).json({ success: false, message: "Failed to respond to the order." });
    }
};

/**
 * @description Allows a restaurant owner to assign an available delivery partner to an accepted order.
 * @access Private (Restaurant Owner)
 */
export const assignDeliveryPartner = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { deliveryPartnerId } = req.body;
        const { id: restaurantId } = req.restaurant;

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

        const deliveryPartner = await User.findOne({ _id: deliveryPartnerId, userType: 'delivery_partner' });
        if (!deliveryPartner) {
            return res.status(404).json({ success: false, message: "Delivery partner not found or user is not a delivery partner." });
        }

        order.assignedDeliveryPartnerId = deliveryPartnerId;
        order.status = 'out_for_delivery'; // Automatically update status
        const updatedOrder = await order.save();
        return res.status(200).json({ success: true, message: "Delivery partner assigned successfully.", data: updatedOrder });

    } catch (error) {
        console.error("Error assigning delivery partner:", error);
        return res.status(500).json({ success: false, message: "Failed to assign delivery partner." });
    }
};

/**
 * @description Retrieves details for a single order, accessible by the customer or restaurant owner.
 * @access Private (Customer or Restaurant Owner)
 */
export const getOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid order ID format." });
        }
        const order = await Order.findById(orderId).populate('restaurantId', 'restaurantName address').populate('customerId', 'fullName email');
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        // Authorization Check
        const isCustomer = req.user.userType === 'customer' && order.customerId._id.toString() === req.user._id.toString();
        const isOwner = req.user.userType === 'owner' && order.restaurantId._id.toString() === req.restaurant.id.toString();
        if (!isCustomer && !isOwner) {
            return res.status(403).json({ success: false, message: "You are not authorized to view this order." });
        }
        return res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error("Error fetching order details:", error);
        return res.status(500).json({ success: false, message: "Failed to retrieve order details." });
    }
};

/**
 * @description A general-purpose function for a restaurant owner to update the order's main status or payment status.
 * @access Private (Restaurant Owner)
 */
export const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, paymentStatus } = req.body;
        const { id: restaurantId } = req.restaurant;

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
        console.error("Error updating order status:", error);
        return res.status(500).json({ success: false, message: "Failed to update order status." });
    }
};

/**
 * @description Allows a customer to cancel their own order, but only if it has not yet been accepted by the restaurant.
 * @access Private (Customer)
 */
export const cancelOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { _id: userId } = req.user;
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
        // Critical State Check: Can only cancel if the restaurant has not yet accepted.
        if (order.acceptanceStatus !== 'pending') {
            return res.status(400).json({ success: false, message: `This order cannot be cancelled as it has already been ${order.acceptanceStatus}.` });
        }
        order.status = 'cancelled';
        const cancelledOrder = await order.save();
        return res.status(200).json({ success: true, message: "Order has been cancelled successfully.", data: cancelledOrder });
    } catch (error) {
        console.error("Error cancelling order:", error);
        return res.status(500).json({ success: false, message: "Failed to cancel the order." });
    }
};

/**
 * @description Retrieves comprehensive sales and order statistics for a restaurant using a MongoDB aggregation pipeline.
 * @access Private (Restaurant Owner)
 */
export const getRestaurantStats = async (req, res) => {
    try {
        const { id: restaurantId } = req.restaurant;
        
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

        // Safely extract results, providing default values if a stage returns no documents
        const overall = stats[0].overallStats[0] || { totalOrders: 0, totalDelivered: 0, totalCancelled: 0, totalIncome: 0 };
        const monthly = stats[0].monthlyIncome;
        const currentMonth = stats[0].currentMonthStats[0] || { orders: 0, delivered: 0, income: 0 };
        const lastMonth = stats[0].lastMonthStats[0] || { orders: 0, delivered: 0, income: 0 };

        const calculatePercentageChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100 * 100) / 100; // Round to 2 decimal places
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
        console.error("Error fetching restaurant stats:", error);
        return res.status(500).json({ success: false, message: "Failed to retrieve restaurant statistics." });
    }
};

/**
 * @description Generates a sales report for a specified period.
 * @access Private (Restaurant Owner)
 */
export const getRestaurantSalesReport = async (req, res) => {
    const { id: restaurantId } = req.restaurant;
    const { startDate, endDate } = req.query;

    try {
        const matchStage = {
            restaurantId: new mongoose.Types.ObjectId(restaurantId),
            status: 'delivered', // Only consider completed orders for sales
            createdAt: {}
        };

        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) matchStage.createdAt.$lte = new Date(endDate);
        if (!startDate && !endDate) {
            // Default to the last 30 days if no range is provided
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
        console.error("Error generating sales report:", error);
        return res.status(500).json({ success: false, message: "Failed to generate sales report." });
    }
};

/**
 * @description Generates a report on order statuses and types.
 * @access Private (Restaurant Owner)
 */
export const getRestaurantOrdersReport = async (req, res) => {
    const { id: restaurantId } = req.restaurant;

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
        console.error("Error generating orders report:", error);
        return res.status(500).json({ success: false, message: "Failed to generate orders report." });
    }
};

/**
 * @description Analyzes and reports on the performance of menu items.
 * @access Private (Restaurant Owner)
 */
export const getMenuItemPerformance = async (req, res) => {
    const { id: restaurantId } = req.restaurant;

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
            { $sort: { totalQuantitySold: -1 } } // Sort by most sold
        ]);

        return res.status(200).json({
            success: true,
            data: itemPerformance
        });

    } catch (error) {
        console.error("Error generating menu item performance report:", error);
        return res.status(500).json({ success: false, message: "Failed to generate menu item performance report." });
    }
};