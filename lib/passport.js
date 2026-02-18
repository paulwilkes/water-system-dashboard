/**
 * Passport Configuration — Google OAuth 2.0
 * Authenticates users against the allowed_users table in SQLite
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { isEmailAllowed } from '../db/database.js';

export function configurePassport() {
  // Store only the email + name in the session (lightweight)
  passport.serializeUser((user, done) => {
    done(null, { email: user.email, name: user.name });
  });

  passport.deserializeUser((userData, done) => {
    done(null, userData);
  });

  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  '/auth/google/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(null, false, { message: 'No email from Google' });
      }

      if (!isEmailAllowed(email)) {
        return done(null, false, { message: 'Email not on allowlist' });
      }

      done(null, { email, name: profile.displayName });
    }
  ));

  return passport;
}
