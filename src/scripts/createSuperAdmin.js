import User from '../models/User.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const createSuperAdmin = async () => {
    // 1. Check if feature is enabled
    if (!config.featureFlags.enableSuperAdminRegistration) {
        // Just return, don't exit the process
        return;
    }

    try {
        // 2. We assume DB is ALREADY connected by index.js
        const { email, fullName, password } = config.superAdmin;

        const existingAdmin = await User.findOne({ email });
        if (existingAdmin) {
            // Admin exists, just return quietly
            return;
        }

        const newAdmin = new User({
            fullName,
            email,
            password, // User model pre-save hook will hash this
            userType: 'super_admin',
            isEmailVerified: true,
            isActive: true,
        });

        await newAdmin.save();
        logger.info(`Super admin "${fullName}" created successfully.`);

    } catch (error) {
        logger.error('Failed to create super admin:', { error: error.message });
        // Do not exit process, just log error so server keeps running
    }
};

// 3. EXPORT the function so index.js can use it
export default createSuperAdmin;