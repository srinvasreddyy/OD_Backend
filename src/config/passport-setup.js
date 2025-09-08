import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import config from './env.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: config.googleOAuth.clientId,
      clientSecret: config.googleOAuth.clientSecret,
      callbackURL: config.googleOAuth.callbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const { id, displayName, emails, photos } = profile;
        const email = emails?.[0]?.value;
        const avatarUrl = photos?.[0]?.value;

        if (!email) {
            return done(new Error("Email not provided by Google."), null);
        }

        // 1. Find user by their Google ID
        let user = await User.findOne({ googleId: id });
        if (user) {
          return done(null, user); // User found, log them in
        }

        // 2. If no user by googleId, find by email to link accounts
        user = await User.findOne({ email: email });
        if (user) {
          // This user registered with OTP, now linking their Google account
          user.googleId = id;
          user.avatarUrl = user.avatarUrl || avatarUrl; // Only update avatar if not already set
          await user.save();
          return done(null, user);
        }

        // 3. If no user exists at all, create a new one
        const newUser = new User({
          googleId: id,
          fullName: displayName,
          email: email,
          avatarUrl: avatarUrl,
          userType: 'customer', // Default role for Google sign-ups
          isEmailVerified: true, // CORRECTED: Google verifies the email, so set this flag.
        });
        await newUser.save();
        
        return done(null, newUser);

      } catch (error) {
        return done(error, null);
      }
    }
  )
);