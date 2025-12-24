import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit from "express-rate-limit";
import logger from "./src/utils/logger.js";
import config from "./src/config/env.js";
import connectDB from "./src/config/db.js";
import passport from "passport";
import "./src/config/passport-setup.js";
import createSuperAdmin from "./src/scripts/createSuperAdmin.js";

// --- ROUTES ---
import authRoutes from "./src/routes/authRoutes.js";
import restaurantRoutes from "./src/routes/restaurant.routes.js";
import adminRoutes from "./src/routes/admin.routes.js";
import ownerRegistrationRoutes from "./src/routes/ownerRegistration.routes.js";
import ownerRoutes from "./src/routes/owner.routes.js";
import menuItemRoutes from "./src/routes/menuItem.routes.js";
import cartRoutes from "./src/routes/cart.routes.js";
import orderRoutes from "./src/routes/order.routes.js";
import deliveryRoutes from "./src/routes/delivery.routes.js";
import paymentRoutes from "./src/routes/payment.routes.js";
import promoRoutes from "./src/routes/promo.routes.js";
import tableRoutes from "./src/routes/table.routes.js";
import bookingRoutes from "./src/routes/booking.routes.js";
import announcementsRoutes from "./src/routes/announcements.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import webhookController from "./src/controllers/webhookController.js";

// --- MISSING IMPORT ADDED HERE ---
import User from "./src/models/User.js"; 

dotenv.config();

const app = express();

// 1. Webhook Route (MUST be before express.json)
app.post(
  "/api/payment/stripe-webhook",
  express.raw({ type: "application/json" }),
  webhookController.handleStripeWebhook
);

// 2. Security & Parsing Middleware
app.use(helmet());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", config.clientUrls.customer, config.clientUrls.admin, config.clientUrls.restaurant],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
});
app.use(limiter);

// Passport
app.use(passport.initialize());

// 3. Routes
app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/owner-registrations", ownerRegistrationRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/menu-items", menuItemRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/promos", promoRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/users", userRoutes);

// 4. Error Handling
app.use((err, req, res, next) => {
  logger.error("Unhandled Error", { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// 5. Start Server
const PORT = config.port || 5000;

const startServer = async () => {
  try {
    await connectDB();
    
    // --- TEMPORARY INDEX FIX ---
    // This runs once to delete the old index, then you can remove it.
    try {
        await User.collection.dropIndex("email_1");
        console.log("✅ SUCCESS: Old 'email_1' index dropped. You can now restart.");
    } catch (error) {
        // If it says "index not found", that's GOOD. It means it's already gone.
        console.log("ℹ️ Index status:", error.message);
    }
    // ---------------------------

    await createSuperAdmin();
    
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`To test Stripe webhooks, run: stripe listen --forward-to localhost:${PORT}/api/payment/stripe-webhook`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error: error.message });
    process.exit(1);
  }
};

startServer();