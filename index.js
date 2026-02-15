import express from "express";
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

// --- ROUTES IMPORTS ---
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
import locationRoutes from './src/routes/location.routes.js';
dotenv.config();

const app = express();

// ==========================================
// 1. STRIPE WEBHOOK ROUTES
// ==========================================
// IMPORTANT: These routes must be defined BEFORE `express.json()` 
// because Stripe needs the raw request body to verify signatures.

// Route A: For Standard Payments (Events from "Your Account")
// Endpoint: https://your-domain.com/api/payment/stripe-webhook
app.post(
  "/api/payment/stripe-webhook",
  express.raw({ type: "application/json" }),
  webhookController.handlePaymentWebhook
);

// Route B: For Connect Onboarding (Events from "Connected Accounts")
// Endpoint: https://your-domain.com/api/payment/stripe-connect-webhook
app.post(
  "/api/payment/stripe-connect-webhook",
  express.raw({ type: "application/json" }),
  webhookController.handleConnectWebhook
);

// ==========================================
// 2. MIDDLEWARE (Parsing & Security)
// ==========================================
app.use(helmet());

app.use(
  cors({
    origin: [
        "http://localhost:5173", 
        "http://localhost:5174", 
        "http://localhost:5175", 
        "http://localhost:5176", 
        config.clientUrls.customer, 
        "https://admin.loksar.co.uk",
        "https://delivery.loksar.co.uk",
        "https://superadmin.loksar.co.uk",
        "https://orders.loksar.co.uk",
        config.clientUrls.admin, 
        config.clientUrls.restaurant
    ].filter(Boolean), 
    credentials: true,
  })
);

// Standard parsers for all other routes
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

// Authentication Middleware
app.use(passport.initialize());

// ==========================================
// 3. API ROUTES
// ==========================================
app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/owner-registrations", ownerRegistrationRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/menu-items", menuItemRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/payment", paymentRoutes); // Note: Webhooks handled above; this handles checkout sessions
app.use("/api/promos", promoRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/users", userRoutes);
app.use('/api/location', locationRoutes);
// ==========================================
// 4. ERROR HANDLING
// ==========================================
app.use((err, req, res, next) => {
  logger.error("Unhandled Error", { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// ==========================================
// 5. SERVER START
// ==========================================
const PORT = config.port || 5000;

const startServer = async () => {
  try {
    await connectDB();
    
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`Payment Webhook Active: /api/payment/stripe-webhook`);
      logger.info(`Connect Webhook Active: /api/payment/stripe-connect-webhook`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error: error.message });
    process.exit(1);
  }
};

startServer();