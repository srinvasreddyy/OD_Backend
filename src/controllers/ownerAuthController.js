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
    // We only update OTP fields, preserving isEmailVerified status
    const owner = await Restaurant.findOneAndUpdate(
      { email },
      {
        currentOTP: otp,
        otpGeneratedAt: new Date(),
      },
      { new: true }
    );

    if (!owner) {
      logger.warn(`OTP request for non-existent owner email: ${email}. No OTP was sent.`);
      // Security: Don't reveal if email exists or not
      return res.status(200).json({ message: "If a matching account exists, an OTP has been sent to the owner's email." });
    }

    logger.info(`Attempting to send Owner OTP to ${email} (Provider: Gmail/Hostinger)...`);
    
    // This await will fail if the mailer configuration is wrong
    await sendOTPEmail(email, otp);
    
    logger.info(`Owner OTP sent successfully to ${email}`);
    res.status(200).json({ message: "OTP sent to owner's email." });

  } catch (error) {
    // Log the EXACT error from Nodemailer/Hostinger
    logger.error("Error requesting owner OTP", { error: error.message, stack: error.stack });
    
    // If in development or simple error reporting is needed, we can send 500
    // But usually we pass to global error handler
    if (config.nodeEnv === 'development') {
         return res.status(500).json({ message: "Email sending failed", error: error.message });
    }
    next(error);
  }
};

export const verifyOwnerOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    // EXPLICITLY select isEmailVerified to ensure it is available
    const owner = await Restaurant.findOne({ email }).select('+currentOTP +isEmailVerified');

    if (!owner) {
        return res.status(400).json({ message: "Invalid email or OTP." });
    }

    // DEBUG LOG: Check your server console to see this value when you try to login
    logger.info(`Owner Login Attempt for ${email} | Verified Status: ${owner.isEmailVerified}`);

    if (owner.currentOTP !== otp.trim()) {
      logger.warn("Invalid OTP for owner verification", { email });
      return res.status(400).json({ message: "Invalid email or OTP." });
    }

    if (isOTPExpired(owner.otpGeneratedAt)) {
      return res.status(400).json({ message: "OTP expired." });
    }

    // STRICT CHECK: If it is ANYTHING other than true (false, null, undefined), block login
    if (owner.isEmailVerified !== true) {
       logger.warn("Owner login blocked: Account not approved", { email });
       return res.status(403).json({ 
           error_code: 'APPROVAL_PENDING',
           message: "Your account is waiting for Super Admin approval." 
       });
    }

    // If we pass here, the user is verified. Clear OTP and login.
    await Restaurant.updateOne(
      { _id: owner._id },
      { $set: { currentOTP: null } }
    );
    
    const token = generateJWT(owner, true);

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