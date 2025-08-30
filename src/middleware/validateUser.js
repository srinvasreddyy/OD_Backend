import { verifyJWT } from "../utils/JwtUtils.js";
import User from "../models/User.js";

export const validateUser = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const decoded = verifyJWT(token);
    if (!decoded || decoded.userType === "owner") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: "Invalid user." });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};