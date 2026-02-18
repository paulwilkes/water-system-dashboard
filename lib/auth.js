/**
 * Authentication Middleware
 * Guards protected routes behind Google OAuth sessions
 */

/**
 * Require an authenticated session.
 * Redirects to /login.html for page requests, returns 401 JSON for API requests.
 */
export function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  req.session.returnTo = req.originalUrl;
  res.redirect('/login.html');
}

/**
 * Redirect already-authenticated users away from the login page.
 */
export function redirectIfAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return res.redirect('/');
  next();
}
