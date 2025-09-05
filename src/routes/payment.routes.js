// OD_Backend/src/routes/payment.routes.js
import express from "express";
import { validateUser } from "../middleware/validateUser.js";
import { createOrderCheckoutSession } from "../controllers/paymentController.js";

const router = express.Router();

router.post("/create-checkout-session", validateUser, createOrderCheckoutSession);

export default router;