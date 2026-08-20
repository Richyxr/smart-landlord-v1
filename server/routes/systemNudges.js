import express from 'express';
import {
  getNudgesForUser,
  resolveNudge,
  runSystemIntelligenceEvaluator
} from '../services/systemNudgeService.js';

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(error => {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      next(error);
    });
  };
}

function getContext(req) {
  const isDemo = process.env.DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';
  return {
    orgId: req.auth?.organizationId || req.auth?.orgId || (isDemo ? 1 : null),
    userId: req.auth?.userId || req.auth?.user_id || (isDemo ? 1 : null),
    role: req.auth?.role || (isDemo ? 'landlord' : null)
  };
}

export function createSystemNudgeRoutes(pgDb = null) {
  const router = express.Router();

  // GET /api/nudges — Get active, unresolved nudges for current user role
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { orgId, userId, role } = getContext(req);
      const userRole = req.query.role || role || 'landlord';

      // Always trigger fresh evaluator scan before returning
      await runSystemIntelligenceEvaluator(pgDb);

      const nudges = await getNudgesForUser(
        { userId, role: userRole, organizationId: orgId },
        pgDb
      );

      res.json({
        success: true,
        count: nudges.length,
        nudges
      });
    })
  );

  // POST /api/nudges/:id/resolve — Mark a nudge as resolved/dismissed
  router.post(
    '/:id/resolve',
    asyncHandler(async (req, res) => {
      const { userId } = getContext(req);
      const nudgeId = req.params.id;

      const resolved = await resolveNudge({ nudgeId, userId }, pgDb);
      if (!resolved) {
        return res.status(404).json({ error: 'Nudge not found or already resolved.' });
      }

      res.json({
        success: true,
        message: 'Nudge resolved successfully.',
        nudge: resolved
      });
    })
  );

  // POST /api/nudges/trigger-eval — Force trigger system evaluation (admin / cron)
  router.post(
    '/trigger-eval',
    asyncHandler(async (req, res) => {
      const evalResult = await runSystemIntelligenceEvaluator(pgDb);
      res.json({
        success: true,
        result: evalResult
      });
    })
  );

  return router;
}
