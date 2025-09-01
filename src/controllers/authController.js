import User from "../models/User.js";
import { generateOTP, isOTPExpired } from "../utils/OtpUtils.js";
import { generateJWT } from "../utils/JwtUtils.js";
import { sendOTPEmail } from "../utils/MailUtils.js";
import logger from "../utils/logger.js";

// Request OTP
export const requestOTP = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const otp = generateOTP();
    await User.findOneAndUpdate(
      { email },
      {
        email,
        currentOTP: otp,
        otpGeneratedAt: new Date(),
        isEmailVerified: false,
      },
      { upsert: true, new: true }
    );

    await sendOTPEmail(email, otp);
    res.status(200).json({ message: "OTP sent to your email." });
  } catch (error) {
    next(error);
  }
};

// Verify OTP
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
      logger.error("Invalid OTP for user", {
        email,
        receivedOtp: otp,
        expectedOtp: user.currentOTP,
      });
      return res.status(400).json({ message: "The OTP is incorrect." });
    }

    if (isOTPExpired(user.otpGeneratedAt)) {
      return res.status(400).json({ message: "The OTP has expired." });
    }

    user.isEmailVerified = true;
    user.currentOTP = null;
    await user.save();

    const isRegistered = !!user.userType;

    if (isRegistered) {
      const token = generateJWT(user);
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 2 * 60 * 60 * 1000,
      });
      return res.status(200).json({
        message: "OTP verified successfully. You are now logged in.",
        userId: user._id,
        isRegistered,
      });
    } else {
      return res.status(200).json({
        message: "OTP verified. Please complete your registration.",
        userId: user._id,
        isRegistered,
      });
    }
  } catch (error) {
    logger.error("OTP verification failed", { error: error.message });
    next(error);
  }
};

// Register User
export const registerUser = async (req, res, next) => {
  try {
    const {
      userId,
      fullName,
      userType,
      customerProfile,
      deliveryPartnerProfile,
    } = req.body;

    const user = await User.findById(userId);
    if (!user || !user.isEmailVerified) {
      return res
        .status(400)
        .json({ message: "OTP verification is required before registration." });
    }

    user.fullName = fullName;
    user.userType = userType;
    if (userType === "customer") user.customerProfile = customerProfile;
    if (userType === "delivery_partner")
      user.deliveryPartnerProfile = deliveryPartnerProfile;

    await user.save();

    const token = generateJWT(user);
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 2 * 60 * 60 * 1000,
    });

    res.status(201).json({ message: "Registration successful.", user });
  } catch (error) {
    next(error);
  }
};