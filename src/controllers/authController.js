import bcrypt from "bcrypt";
import User from "../models/User.js";
import { generateOTP, isOTPExpired } from "../utils/OtpUtils.js";
import { generateJWT } from "../utils/JwtUtils.js";
import { sendOTPEmail } from "../utils/MailUtils.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// ... [Keep other functions like registerUser, requestOTP, verifyOTP, loginSuperAdmin, loginDeliveryPartner unchanged] ...

/**
 * @description Registers a new user of type 'customer'.
 * @route POST /api/auth/register
 * @access Public
 */
export const registerUser = async (req, res, next) => {
  try {
    const { fullName, email, customerProfile } = req.body;

    if (!fullName || !email) {
      return res.status(400).json({ success: false, message: "Full name and email are required." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "A user with this email already exists. Please log in." });
    }

    const newUser = new User({
      fullName,
      email,
      userType: 'customer', // Public registration is ONLY for customers
      customerProfile: customerProfile || {},
      isEmailVerified: false // Verification happens on first OTP login
    });

    await newUser.save();

    res.status(201).json({ 
        success: true, 
        message: "Registration successful. Please log in using the OTP sent to your email to verify your account." 
    });

  } catch (error) {
    if (error.code === 11000) {
        return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }
    logger.error("User registration failed", { error: error.message });
    next(error);
  }
};

/**
 * @description Sends an OTP to a registered user's email for login.
 * @route POST /api/auth/request-otp
 * @access Public
 */
export const requestOTP = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(404).json({ success: false, message: "No account found with this email. Please register first." });
    }
    
    if (user.userType !== 'customer' && user.userType !== 'delivery_partner') {
        return res.status(403).json({ success: false, message: "This login is for customers and delivery partners only." });
    }

    const otp = generateOTP();
    user.currentOTP = otp;
    user.otpGeneratedAt = new Date();
    await user.save();

    await sendOTPEmail(email, otp);
    res.status(200).json({ message: "OTP sent to your email for login." });
  } catch (error) {
    logger.error("Error in requestOTP", { error: error.message });
    next(error);
  }
};

/**
 * @description Verifies a login OTP and creates a session for the user.
 * @route POST /api/auth/verify-otp
 * @access Public
 */
export const verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const user = await User.findOne({ email });

    if (!user) {
      logger.error("User not found for OTP verification", { email });
      return res.status(404).json({ message: "User not found." });
    }

    if (user.currentOTP !== otp.trim()) {
      logger.warn("Invalid OTP for user", { email });
      return res.status(400).json({ message: "The OTP is incorrect." });
    }

    if (isOTPExpired(user.otpGeneratedAt)) {
      return res.status(400).json({ message: "The OTP has expired." });
    }

    // First successful OTP login also verifies the email
    if (!user.isEmailVerified) {
        user.isEmailVerified = true;
    }
    user.currentOTP = null;
    await user.save();
    
    const token = generateJWT(user);
    res.cookie("token", token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "Strict",
      maxAge: 2 * 60 * 60 * 1000,
    });
    
    const userResponse = {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        userType: user.userType,
        isEmailVerified: user.isEmailVerified,
    };
    
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: userResponse
    });

  } catch (error) {
    logger.error("OTP verification failed", { error: error.message });
    next(error);
  }
};

/**
 * @description Authenticates a super admin using email and password.
 * @route POST /api/auth/admin/login
 * @access Public
 */
export const loginSuperAdmin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const admin = await User.findOne({ email, userType: 'super_admin' }).select('+password');

    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const token = generateJWT(admin);
    res.cookie("token", token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "Strict",
      maxAge: 12 * 60 * 60 * 1000,
    });

    const adminResponse = {
        _id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        userType: admin.userType,
    };

    return res.status(200).json({
      success: true,
      message: "Super admin login successful.",
      data: adminResponse
    });

  } catch (error) {
    logger.error("Super admin login failed", { error: error.message });
    next(error);
  }
};

/**
 * @description Authenticates a delivery partner using USERNAME and password.
 * @route POST /api/auth/delivery-partner/login
 * @access Public
 */
export const loginDeliveryPartner = async (req, res, next) => {
  try {
    const { username, password } = req.body; 

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required." });
    }

    const user = await User.findOne({ username, userType: 'delivery_partner' }).select('+password');

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials or not a delivery partner." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // Generate Token
    const token = generateJWT(user);

    // Set Cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "Strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        _id: user._id,
        fullName: user.fullName,
        username: user.username,
        userType: user.userType
      }
    });

  } catch (error) {
    logger.error("Delivery partner login failed", { error: error.message });
    next(error);
  }
};

/**
 * @description Gets the current logged-in user's profile.
 * @route GET /api/auth/delivery-partner/me
 * @access Private
 */
export const getCurrentUser = async (req, res, next) => {
    try {
        const userId = req.user._id;
        // FIX: Populate restaurantId to get restaurantName
        const user = await User.findById(userId).populate('restaurantId', 'restaurantName');
        
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        return res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        logger.error("Get current user failed", { error: error.message });
        next(error);
    }
};