import express from "express";
import passport from "passport";
import {
  requestOTP,
  verifyOTP,
  registerUser,
} from "../controllers/authController.js";
import {
  requestOwnerOTP,
  verifyOwnerOTP,
} from "../controllers/ownerAuthController.js";
import { googleCallback } from "../controllers/googleAuthController.js";

const router = express.Router();

// User OTP and Registration
router.post("/request-otp", requestOTP);
router.post("/verify-otp", verifyOTP);
router.post("/register", registerUser);

// Restaurant Owner OTP
router.post("/owner/request-otp", requestOwnerOTP);
router.post("/owner/verify-otp", verifyOwnerOTP);

router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "Strict",
    secure: true,
  });
  res.status(200).json({ message: "Logged out successfully" });
});

// --- Google OAuth Routes ---
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: process.env.CLIENT_FAILURE_REDIRECT_URL,
    session: false,
  }),
  googleCallback
);

export default router;