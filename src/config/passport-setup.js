import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
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
          isPhoneVerified: true, // Email is verified by Google, so we can consider this true
        });
        await newUser.save();
        
        return done(null, newUser);

      } catch (error) {
        return done(error, null);
      }
    }
  )
);