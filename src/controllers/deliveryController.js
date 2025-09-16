import mongoose from 'mongoose'; 
import User from "../models/User.js";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";
import { getPaginationParams } from "../utils/paginationUtils.js";

/**
 * @description Allows a delivery partner to update their availability status.
 * @route PATCH /api/delivery/status
 * @access Private (Delivery Partner)
 */
export const updateAvailabilityStatus = async (req, res, next) => {
    const  partnerId  = req.user?._id;
    const { isAvailable } = req.body;

    try {
        if (typeof isAvailable !== 'boolean') {
            return res.status(400).json({ success: false, message: "A boolean 'isAvailable' field is required." });
        }

        const updatedUser = await User.findByIdAndUpdate(
            partnerId,
            { $set: { "deliveryPartnerProfile.isAvailable": isAvailable } },
            { new: true }
        ).select('fullName deliveryPartnerProfile');

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "Delivery partner not found." });
        }

        return res.status(200).json({
            success: true,
            message: `Your status is now set to ${isAvailable ? 'Available' : 'Unavailable'}.`,
            data: updatedUser.deliveryPartnerProfile,
        });

    } catch (error) {
        logger.error("Error updating delivery partner status", { error: error.message, partnerId });
        next(error);
    }
};

/**
 * @description Get orders assigned to the logged-in delivery partner.
 * @route GET /api/delivery/orders
 * @access Private (Delivery Partner)
 */
export const getAssignedOrders = async (req, res, next) => {
    const  partnerId  = req.user?._id;
    const { status } = req.query;
    const { page, limit, skip } = getPaginationParams(req.query); 
    try {
        const query = { assignedDeliveryPartnerId: partnerId };

        if (status && ['out_for_delivery', 'delivered'].includes(status)) {
            query.status = status;
        } else {
            // Default to only ongoing orders if no status is specified
            query.status = 'out_for_delivery'; 
        }

        const orders = await Order.find(query)
            .populate('restaurantId', 'restaurantName address')
            .populate('customerId', 'fullName')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip)
            .exec();
        
        const count = await Order.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: orders,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
        });

    } catch (error) {
        logger.error("Error fetching assigned orders for delivery partner", { error: error.message, partnerId });
        next(error);
    }
};

/**
 * @description Allows a delivery partner to mark their assigned order as delivered.
 * @route PATCH /api/delivery/orders/:orderId/update-status
 * @access Private (Delivery Partner)
 */
export const updateOrderStatusByPartner = async (req, res, next) => {
    const { orderId } = req.params;
    const partnerId = req.user._id;
    const { status } = req.body;

    if (status !== 'delivered') {
        return res.status(400).json({ success: false, message: "Invalid status. Delivery partners can only mark orders as 'delivered'." });
    }

    const session = await mongoose.startSession();
    try {
        let updatedOrderData;
        await session.withTransaction(async () => {
            const order = await Order.findById(orderId).session(session);

            if (!order) {
                throw { statusCode: 404, message: "Order not found." };
            }
            if (order.assignedDeliveryPartnerId?.toString() !== partnerId.toString()) {
                throw { statusCode: 403, message: "You are not authorized to update this order." };
            }
            if (order.status !== 'out_for_delivery') {
                throw { statusCode: 400, message: `Cannot update order. Current status is '${order.status}', not 'out_for_delivery'.` };
            }

            // Update order status
            order.status = 'delivered';
            order.deliveryDate = new Date(); // Record delivery time

            // If it's a cash order, mark payment as complete
            if (order.paymentType === 'cash') {
                order.paymentStatus = 'paid';
            }

            // Make the delivery partner available again
            await User.updateOne(
                { _id: partnerId },
                { $set: { "deliveryPartnerProfile.isAvailable": true } },
                { session }
            );

            const updatedOrder = await order.save({ session });
            updatedOrderData = updatedOrder;
        });

        return res.status(200).json({
            success: true,
            message: "Order marked as delivered successfully.",
            data: updatedOrderData
        });

    } catch (error) {
        if (error.statusCode) {
             return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        logger.error("Error updating order status by partner", { error: error.message, orderId, partnerId });
        next(error);
    } finally {
        session.endSession();
    }
};