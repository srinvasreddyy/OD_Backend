import { verifyJWT } from "../utils/JwtUtils.js";
import User from "../models/User.js";

export const validateDeliveryPartner = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Authentication required. Please log in." });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({ message: "Invalid or expired token. Please log in again." });
    }

    if (decoded.userType !== "delivery_partner") {
      return res.status(403).json({ message: "Forbidden. Delivery partner access is required for this action." });
    }

    const partner = await User.findById(decoded.userId);
    if (!partner || partner.userType !== 'delivery_partner') {
      return res.status(401).json({ message: "Delivery partner not found or role has been revoked." });
    }

    req.user = partner;
    next();
  } catch (err) {
    return res.status(500).json({ message: "An unexpected server error occurred during authentication." });
  }
};