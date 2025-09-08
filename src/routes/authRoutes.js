import express from "express";
import passport from "passport";
import {
  registerUser,
  requestOTP,
  verifyOTP,
} from "../controllers/authController.js";
import {
  requestOwnerOTP,
  verifyOwnerOTP,
} from "../controllers/ownerAuthController.js";
import { googleCallback } from "../controllers/googleAuthController.js";
import config from "../config/env.js";

const router = express.Router();

// Step 1: Register a new customer account
router.post("/register", registerUser);

// Step 2: Login for any user type (customer, delivery_partner)
router.post("/request-otp", requestOTP);
router.post("/verify-otp", verifyOTP);

// --- Restaurant Owner Specific Login ---
router.post("/owner/request-otp", requestOwnerOTP);
router.post("/owner/verify-otp", verifyOwnerOTP);

// --- Universal Logout ---
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "Strict",
    secure: config.nodeEnv === 'production',
  });
  res.status(200).json({ message: "Logged out successfully" });
});

// --- Google OAuth Routes (Unaffected) ---
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: config.clientUrls.failureRedirect,
    session: false,
  }),
  googleCallback
);

export default router;