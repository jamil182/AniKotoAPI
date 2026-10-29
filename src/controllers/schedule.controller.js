/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — schedule.controller.js
 * Repository: https://github.com/Shineii86/AniKotoAPI
 *
 * @description
 *   Controller for anime airing schedule. Returns anime episodes
 *   scheduled to air on a specific date. Requires date in
 *   YYYY-MM-DD format as a query parameter.
 *
 * @exports
 *   getSchedule - Express route handler for GET /api/schedule
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

import { scheduleQuery, scheduleService } from '../services/schedule.js';

// ══════════════════════════════════════════════════════════════
// CONTROLLER: SCHEDULE
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Anime airing schedule endpoint ----
/**
 * Handles GET /api/schedule requests. Returns anime episodes
 * scheduled for the specified date.
 *
 * @param {object} req - Express request object
 * @param {string} req.query.date - Date in YYYY-MM-DD format
 * @param {object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void} Sends JSON response with schedule data
 *
 * @example
 *   GET /api/schedule?date=2024-01-15
 *   Response: { success: true, results: [{ time, title, ... }] }
 *
 * @throws {400} If 'date' query parameter is missing
 * NOTE: Date must be in YYYY-MM-DD format
 */
const getSchedule = async (req, res, next) => {
  try {
    const { date, timezone } = scheduleQuery(req.query);
    const data = await scheduleService.get(date, timezone);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, results: data });
  } catch (error) {
    next(error);
  }
};

export { getSchedule };

// ══════════════════════════════════════════════════════════════ END: schedule.controller.js
