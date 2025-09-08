// OD_Backend/src/controllers/ownerAuthController.js
import Restaurant from "../models/Restaurant.js";
import { generateOTP, isOTPExpired } from "../utils/OtpUtils.js";
import { generateJWT } from "../utils/JwtUtils.js";
import { sendOTPEmail } from "../utils/MailUtils.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

export const requestOwnerOTP = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const otp = generateOTP();
    const owner = await Restaurant.findOneAndUpdate(
      { email },
      {
        currentOTP: otp,
        otpGeneratedAt: new Date(),
      },
      { new: true }
    );

    if (!owner) {
      // To prevent email enumeration, we still return a success-like response.
      // The email will not be sent, but the client-side experience is the same.
      logger.warn(`OTP request for non-existent owner email: ${email}`);
      return res.status(200).json({ message: "If a matching account exists, an OTP has been sent to the owner's email." });
    }

    await sendOTPEmail(email, otp);
    res.status(200).json({ message: "OTP sent to owner's email." });
  } catch (error) {
    logger.error("Error requesting owner OTP", { error: error.message });
    next(error);
  }
};

export const verifyOwnerOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const owner = await Restaurant.findOne({ email });

    // UNIFIED FAILURE RESPONSE:
    // If there's no owner OR the OTP is incorrect, return the same generic message.
    if (!owner || owner.currentOTP !== otp.trim()) {
      logger.warn("Invalid OTP or user for owner verification", { email });
      return res.status(400).json({ message: "Invalid email or OTP." });
    }

    if (isOTPExpired(owner.otpGeneratedAt)) {
      return res.status(400).json({ message: "OTP expired." });
    }

    // OTP is verified, now this acts as a login
    await Restaurant.updateOne(
      { _id: owner._id },
      { $set: { isEmailVerified: true, currentOTP: null } }
    );
    
    // The entity being passed to generateJWT is the owner (Restaurant document)
    const token = generateJWT(owner, true); // Pass a flag to indicate this is an owner

    res.cookie("token", token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "Strict",
      maxAge: 2 * 60 * 60 * 1000,
    });

    const ownerResponse = owner.toObject();
    delete ownerResponse.password;
    delete ownerResponse.currentOTP;
    delete ownerResponse.otpGeneratedAt;

    res.status(200).json({
      message: "Owner OTP verified successfully. Logged in.",
      owner: ownerResponse, 
    });
  } catch (error) {
    logger.error("Owner OTP verification failed", { error: error.message });
    next(error);
  }
};