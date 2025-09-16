import mongoose from "mongoose";
import dotenv from 'dotenv';
import User from '../models/User.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

dotenv.config();

const createSuperAdmin = async () => {
    if (!config.featureFlags.enableSuperAdminRegistration) {
        logger.warn('Super admin registration is disabled. Set ENABLE_SUPER_ADMIN_REGISTRATION=true in .env to enable it.');
        process.exit(0);
    }

    try {
        await mongoose.connect(config.mongodbUri);
        logger.info('MongoDB connected for admin creation script.');

        const { email, fullName, password } = config.superAdmin;

        const existingAdmin = await User.findOne({ email });
        if (existingAdmin) {
            logger.warn(`An admin with the email ${email} already exists.`);
            mongoose.connection.close();
            process.exit(0);
        }

        const newAdmin = new User({
            fullName,
            email,
            password, // The pre-save hook in the User model will hash this
            userType: 'super_admin',
            isEmailVerified: true, // Super admin email is trusted
            isActive: true,
        });

        await newAdmin.save();
        logger.info(`Super admin "${fullName}" created successfully with email "${email}".`);

    } catch (error) {
        logger.error('Failed to create super admin:', { error: error.message });
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed.');
    }
};

createSuperAdmin();