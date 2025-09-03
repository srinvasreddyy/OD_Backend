import { verifyJWT } from "../utils/JwtUtils.js";
import User from "../models/User.js";

export const validateSuperAdmin = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Authentication required. Please log in." });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({ message: "Invalid or expired token. Please log in again." });
    }

    // Check specifically for the 'super_admin' userType
    if (decoded.userType !== "super_admin") {
      return res.status(403).json({ message: "Forbidden. Super admin access is required for this action." });
    }

    const admin = await User.findById(decoded.userId);
    if (!admin || admin.userType !== 'super_admin') {
      return res.status(401).json({ message: "Admin user not found or role has been revoked." });
    }

    req.user = admin; // Attach admin user object to the request
    next();
  } catch (err) {
    return res.status(500).json({ message: "An unexpected server error occurred during authentication." });
  }
};