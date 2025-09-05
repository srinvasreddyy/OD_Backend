import User from '../models/User.js';
import logger from '../utils/logger.js';

/**
 * @description Get the profile of the currently authenticated user.
 * @route GET /api/users/profile
 * @access Private (Customer)
 */
export const getUserProfile = async (req, res, next) => {
    try {
        // req.user is populated by the validateUser middleware
        const userId = req.user._id;

        const user = await User.findById(userId).lean();

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Sanitize the output: never return sensitive information
        delete user.currentOTP;
        delete user.otpGeneratedAt;

        return res.status(200).json({
            success: true,
            data: user
        });

    } catch (error) {
        logger.error("Error fetching user profile", { error: error.message, userId: req.user?._id });
        next(error);
    }
};

/**
 * @description Update the profile of the currently authenticated user.
 * @route PUT /api/users/profile
 * @access Private (Customer)
 */
export const updateUserProfile = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const { fullName, customerProfile } = req.body;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Update only the allowed fields
        if (fullName) {
            user.fullName = fullName;
        }

        if (customerProfile) {
            if (customerProfile.dateOfBirth) {
                user.customerProfile.dateOfBirth = new Date(customerProfile.dateOfBirth);
            }
            if (['male', 'female', 'other'].includes(customerProfile.gender)) {
                user.customerProfile.gender = customerProfile.gender;
            }
        }

        const updatedUser = await user.save();
        
        // Sanitize the output before sending it back
        const responseUser = updatedUser.toObject();
        delete responseUser.currentOTP;
        delete responseUser.otpGeneratedAt;
        
        return res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            data: responseUser
        });

    } catch (error) {
        logger.error("Error updating user profile", { error: error.message, userId: req.user?._id });
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }
        next(error);
    }
};