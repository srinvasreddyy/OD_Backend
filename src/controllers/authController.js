import User from "../models/User.js";
import {generateOTP,isOTPExpired} from "../utils/OtpUtils.js";
import { generateJWT } from "../utils/JwtUtils.js";
import { sendOTPEmail } from "../utils/MailUtils.js";
export const requestOTP = async (req, res) => {
  const { email } = req.body;
  const otp = generateOTP();
  const user = await User.findOneAndUpdate(
    { email },
    {
      email,
      currentOTP: otp,
      otpGeneratedAt: new Date(),
      isPhoneVerified: false
    },
    { upsert: true, new: true }
  );
  await sendOTPEmail(email, otp);
  res.status(200).json({ message: "OTP sent to email." });
};

export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const user = await User.findOne({ email });

    if (!user || user.currentOTP !== otp) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    if (isOTPExpired(user.otpGeneratedAt)) {
      return res.status(400).json({ message: "OTP expired." });
    }

    // ✅ Safely update without triggering full schema validation
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          isPhoneVerified: true,
          currentOTP: null,
        }
      }
    );

    const isRegistered = !!user.userType;
    res.status(200).json({ message: "OTP verified", userId: user._id, isRegistered });

  } catch (error) {
    console.error("OTP verification failed:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};



export const registerUser = async (req, res) => {
  const { userId, fullName, userType, customerProfile, deliveryPartnerProfile } = req.body;

  const user = await User.findById(userId);
  if (!user || !user.isPhoneVerified) {
    return res.status(400).json({ message: "OTP verification required." });
  }

  user.fullName = fullName;
  user.userType = userType;
  if (userType === 'customer') user.customerProfile = customerProfile;
  if (userType === 'delivery_partner') user.deliveryPartnerProfile = deliveryPartnerProfile;

  await user.save();

  const token = generateJWT(user);
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 2 * 60 * 60 * 1000
  });

  res.status(200).json({ message: "Registration successful", user });
};