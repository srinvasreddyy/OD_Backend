import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from 'cors';
import cookieParser from "cookie-parser";
import passport from "passport";
import DBconnection from "./src/config/db.js";
import './src/config/passport-setup.js';

// Route Imports
import authRoutes from './src/routes/authRoutes.js';
import ownerRegistrationRoutes from "./src/routes/ownerRegistration.routes.js";
import restaurantRoutes from "./src/routes/restaurant.routes.js"; // New
import menuItemRoutes from "./src/routes/menuItem.routes.js";
import cartRoutes from "./src/routes/cart.routes.js";
import orderRoutes from "./src/routes/order.routes.js";
import announcementRoutes from "./src/routes/announcements.routes.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: 'http://localhost:5173', 
  credentials: true 
}));

app.use(passport.initialize());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ownerRegistration', ownerRegistrationRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/menuItems', menuItemRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/announcements', announcementRoutes);

const PORT = process.env.PORT || 3000;
DBconnection()
.then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
})
.catch((error) => {
  console.error("MongoDB connection error:", error);
});