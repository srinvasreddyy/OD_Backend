import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from 'cors';
import cookieParser from "cookie-parser";
import passport from "passport";
import DBconnection from "./src/config/db.js";
import './src/config/passport-setup.js';
import logger from "./src/utils/logger.js";

// Route Imports
import authRoutes from './src/routes/authRoutes.js';
import ownerRegistrationRoutes from "./src/routes/ownerRegistration.routes.js";
import restaurantRoutes from "./src/routes/restaurant.routes.js";
import menuItemRoutes from "./src/routes/menuItem.routes.js";
import cartRoutes from "./src/routes/cart.routes.js";
import orderRoutes from "./src/routes/order.routes.js";
import announcementRoutes from "./src/routes/announcements.routes.js";

const app = express();

// --- Core Middleware ---
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173', 
  credentials: true 
}));
app.use(passport.initialize());

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/ownerRegistration', ownerRegistrationRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/menuItems', menuItemRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/announcements', announcementRoutes);

// --- Health Check Route ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is healthy.' });
});

// --- Global Error Handling Middleware ---
// This MUST be the last middleware added
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });

  const statusCode = err.statusCode || 500;
  const message = err.message || "An unexpected server error occurred.";
  
  // Do not leak stack trace in production
  const errorResponse = {
    success: false,
    message: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  };

  res.status(statusCode).json(errorResponse);
});


// --- Server Initialization ---
const PORT = process.env.PORT || 3000;
DBconnection()
.then(() => {
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
})
.catch((error) => {
  logger.error("MongoDB connection error:", { error: error.message });
  process.exit(1);
});