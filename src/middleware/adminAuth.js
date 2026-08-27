/*
 * AniKotoAPI — adminAuth.js
 * Fail-closed admin gate. Without ADMIN_TOKEN set the admin surface is
 * disabled (503); with it set, requests must carry the matching token in
 * the x-admin-token header (or ?token=).
 */

export function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ success: false, message: "Admin is not configured (set ADMIN_TOKEN)." });
  }
  const got = req.get("x-admin-token") || req.query.token;
  if (got !== expected) {
    return res.status(401).json({ success: false, message: "Invalid admin token." });
  }
  next();
}
