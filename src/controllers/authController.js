import User from "../models/User.js";
import { generateOTP, isOTPExpired } from "../utils/OtpUtils.js";
import { generateJWT } from "../utils/JwtUtils.js";
import { sendOTPEmail } from "../utils/MailUtils.js";
import logger from "../utils/logger.js";

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

    // --- LOGIC CHANGE ---
    // Do not create a user here. Only find an existing one.
    const user = await User.findOne({ email });
    if (!user) {
        return res.status(404).json({ success: false, message: "No account found with this email. Please register first." });
    }
    // --- END LOGIC CHANGE ---

    const otp = generateOTP();
    user.currentOTP = otp;
    user.otpGeneratedAt = new Date();
    await user.save();

    await sendOTPEmail(email, otp);
    res.status(200).json({ message: "OTP sent to your email for login." });
  } catch (error) {
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
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 2 * 60 * 60 * 1000,
    });
    
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
          fullName: user.fullName,
          email: user.email,
          userType: user.userType
      }
    });

  } catch (error) {
    logger.error("OTP verification failed", { error: error.message });
    next(error);
  }
};