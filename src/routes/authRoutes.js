import express from "express";
import passport from "passport";
import {
  registerUser,
  requestOTP,
  verifyOTP,
  loginSuperAdmin,
  loginDeliveryPartner,
  getCurrentUser
} from "../controllers/authController.js";
import {
  requestOwnerOTP,
  verifyOwnerOTP,
} from "../controllers/ownerAuthController.js";
import { googleCallback } from "../controllers/googleAuthController.js";
import config from "../config/env.js";
import { validateDeliveryPartner } from "../middleware/validateDeliveryPartner.js";
import { validateUser } from "../middleware/validateUser.js";

const router = express.Router();

// --- Customer/User Routes ---
router.post("/register", registerUser);
router.post("/request-otp", requestOTP);
router.post("/verify-otp", verifyOTP);

// [CRITICAL] Session Re-hydration Route for OAuth & Persistent Login
router.get("/me", validateUser, getCurrentUser); 

// --- Delivery Partner Routes ---
router.post("/delivery-partner/login", loginDeliveryPartner);
router.get("/delivery-partner/me", validateDeliveryPartner, getCurrentUser); 

// --- Super Admin Login Route ---
router.post("/admin/login", loginSuperAdmin);

// --- Restaurant Owner Specific Login ---
router.post("/owner/request-otp", requestOwnerOTP);
router.post("/owner/verify-otp", verifyOwnerOTP);

// --- Universal Logout ---
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: config.nodeEnv === 'production' ? 'None' : 'Lax',
    secure: config.nodeEnv === 'production',
    domain: config.nodeEnv === 'production' ? '.loksar.co.uk' : undefined
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// --- Google OAuth Routes ---
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