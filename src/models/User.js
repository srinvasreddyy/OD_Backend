//
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import config from "../config/env.js";

const cartItemSchema = new mongoose.Schema({
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    quantity: { type: Number, default: 1, min: 1 },
    selectedVariants: [{
        groupId: String,
        variantId: String
    }],
    selectedAddons: [{
        groupId: String,
        addonId: String
    }],
    instructions: { type: String, default: "" }, // Ensure instructions are stored
    cartItemKey: { type: String, required: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, select: false }, 
    phoneNumber: { type: String, trim: true },
    userType: { 
        type: String, 
        enum: ['customer', 'restaurant_owner', 'admin', 'super_admin', 'delivery_partner'], 
        default: 'customer' 
    },
    
    // Auth & Verification
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    googleId: String,
    authType: { type: String, enum: ['local', 'google'], default: 'local' },

    // Profiles
    customerProfile: {
        addresses: [{
            addressLine1: String,
            city: String,
            state: String,
            zipCode: String,
            country: String,
            coordinates: {
                lat: Number,
                lng: Number
            },
            isDefault: { type: Boolean, default: false }
        }],
        appliedPromo: {
            code: String,
            discountAmount: Number,
            cartType: String 
        }
    },
    
    // For Restaurant Owners
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
    
    // For Delivery Partners
    deliveryPartnerProfile: {
        isAvailable: { type: Boolean, default: false },
        currentLocation: {
            type: { type: String, default: 'Point' },
            // FIX: Added default [0,0] to prevents "Point must be an array" error
            coordinates: { type: [Number], default: [0, 0] } 
        },
        vehicleType: String,
        licenseNumber: String,
        rating: { type: Number, default: 0 },
        totalDeliveries: { type: Number, default: 0 }
    },

    // Carts
    foodCart: [cartItemSchema],
    groceriesCart: [cartItemSchema],

    lastLogin: Date,
    status: { type: String, enum: ['active', 'inactive', 'banned'], default: 'active' }

}, { timestamps: true });

// 2dsphere index for location queries
userSchema.index({ "deliveryPartnerProfile.currentLocation": "2dsphere" });

// Hash password before saving
userSchema.pre("save", async function (next) {
    // Safety check: If for some reason coordinates are empty, force them to [0,0]
    if (this.deliveryPartnerProfile && this.deliveryPartnerProfile.currentLocation) {
        if (!this.deliveryPartnerProfile.currentLocation.coordinates || this.deliveryPartnerProfile.currentLocation.coordinates.length === 0) {
            this.deliveryPartnerProfile.currentLocation.coordinates = [0, 0];
        }
    }

    if (!this.isModified("password") || !this.password) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateAuthToken = function () {
    return jwt.sign(
        { id: this._id, userType: this.userType, email: this.email },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
};

export default mongoose.model("User", userSchema);