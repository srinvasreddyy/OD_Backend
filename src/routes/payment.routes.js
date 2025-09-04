import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import { validateUser } from "../middleware/validateUser.js";

dotenv.config();

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/create-checkout-session", validateUser, async (req, res) => {
  const { cartTotal, customerEmail } = req.body;

  try {
    const line_items = [
      {
        price_data: {
          currency: "inr",
          product_data: {
            name: "Cart Total",
          },
          unit_amount: cartTotal * 100, // ₹ to paise
        },
        quantity: 1,
      },
    ];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card","amazon_pay"],
      line_items,
      mode: "payment",
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
      customer_email: customerEmail,
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;