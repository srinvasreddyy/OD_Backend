import { verifyJWT } from "../utils/JwtUtils.js";
import User from "../models/User.js";

export const validateUser = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Authentication required. Please log in." });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({ message: "Invalid or expired token. Please log in again." });
    }

    if (decoded.userType === "owner") {
      return res.status(403).json({ message: "Forbidden. This action is not available for restaurant owners." });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ message: "An unexpected server error occurred." });
  }
};