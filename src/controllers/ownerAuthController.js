import Restaurant from "../models/Restaurant.js";
import { generateOTP, isOTPExpired } from "../utils/OtpUtils.js";
import { generateJWT } from "../utils/JwtUtils.js";
import { sendOTPEmail } from "../utils/MailUtils.js";

export const requestOwnerOTP = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  const otp = generateOTP();

  try {
    const owner = await Restaurant.findOneAndUpdate(
      { email },
      {
        currentOTP: otp,
        otpGeneratedAt: new Date(),
      },
      { new: true }
    );

    if (!owner) {
      return res.status(404).json({ message: "Restaurant owner not found." });
    }

    await sendOTPEmail(email, otp);
    res.status(200).json({ message: "OTP sent to owner's email." });
  } catch (error) {
    console.error("Error requesting owner OTP:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const verifyOwnerOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required." });
  }

  try {
    const owner = await Restaurant.findOne({ email });

    if (!owner || owner.currentOTP !== otp) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    if (isOTPExpired(owner.otpGeneratedAt)) {
      return res.status(400).json({ message: "OTP expired." });
    }

    await Restaurant.updateOne(
      { _id: owner._id },
      { $set: { isEmailVerified: true, currentOTP: null } }
    );

    const token = generateJWT({
      _id: owner._id,
      userType: "owner",
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 2 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Owner OTP verified successfully.",
      owner,
    });
  } catch (error) {
    console.error("Owner OTP verification failed:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};