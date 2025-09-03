// OD_Backend/src/controllers/deliveryController.js
import User from "../models/User.js";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";

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
    const { page = 1, limit = 10, status } = req.query;

    try {
        const query = { assignedDeliveryPartnerId: partnerId };

        if (status && ['out_for_delivery', 'delivered'].includes(status)) {
            query.status = status;
        } else {
            query.status = 'out_for_delivery'; // Default to ongoing orders
        }

        const orders = await Order.find(query)
            .populate('restaurantId', 'restaurantName address')
            .populate('customerId', 'fullName')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();
        
        const count = await Order.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: orders,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });

    } catch (error) {
        logger.error("Error fetching assigned orders for delivery partner", { error: error.message, partnerId });
        next(error);
    }
};