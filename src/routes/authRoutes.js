import express from "express"
import { requestOTP,verifyOTP,registerUser } from "../controllers/authController.js"

const router = express.Router();

router.post('/request-otp', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/register', registerUser);

export default router;