import { generateJWT } from "../utils/JwtUtils.js";

/**
 * Handles the Google OAuth callback after Passport has authenticated the user.
 * It generates a JWT, sets it in a secure cookie, and redirects to the frontend.
 */
export const googleCallback = (req, res) => {
  if (!req.user) {
    // Redirect to a failure page on the frontend
    return res.redirect(process.env.CLIENT_FAILURE_REDIRECT_URL);
  }

  // Generate a JWT for the authenticated user (from req.user provided by Passport)
  const token = generateJWT(req.user);

  // Set the JWT in an httpOnly cookie for security
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 2 * 60 * 60 * 1000 // 2 hours
  });

  // Redirect the user to a success page on the frontend
  res.redirect(process.env.CLIENT_SUCCESS_REDIRECT_URL);
};