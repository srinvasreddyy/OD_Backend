import { verifyJWT } from "../utils/JwtUtils.js";
import Restaurant from "../models/Restaurant.js";

export const validateRestaurant = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const decoded = verifyJWT(token);
    if (!decoded || decoded.userType !== "owner") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const restaurant = await Restaurant.findById(decoded.restaurantId);
    if (!restaurant) {
      return res.status(401).json({ message: "Invalid restaurant." });
    }

    req.restaurant = restaurant;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};