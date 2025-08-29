import express from "express"
import passport from "passport";
import { requestOTP, verifyOTP, registerUser } from "../controllers/authController.js"
import { googleCallback } from "../controllers/googleAuthController.js";

const router = express.Router();

router.post('/request-otp', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/register', registerUser);

// --- Google OAuth Routes ---

// The route to initiate the Google login flow
router.get(
    '/google', 
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// The callback route that Google will redirect to after successful authentication
router.get(
    '/google/callback', 
    passport.authenticate('google', { 
        failureRedirect: process.env.CLIENT_FAILURE_REDIRECT_URL, 
        session: false 
    }), 
    googleCallback // Our custom controller to handle the final steps
);

export default router;