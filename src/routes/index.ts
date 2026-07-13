import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { getAdminDashboard } from "../controllers/adminController.js";
import { trackPageView } from "../controllers/analyticsController.js";
import { adminLogin, completeProfile, getMe, requireAdmin, syncAuthProfile } from "../controllers/authController.js";
import { cancelDownload, createDownload, downloadFile, getDownload } from "../controllers/downloadController.js";
import { deleteFeedback, listFeedback, submitFeedback, updateFeedback } from "../controllers/feedbackController.js";
import { getVideoInfo } from "../controllers/videoController.js";
import { getKeepAliveStatus } from "../jobs/keepAlive.js";

export const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT_PER_15_MIN, standardHeaders: true, legacyHeaders: false });
const feedbackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.FEEDBACK_RATE_LIMIT_PER_15_MIN, standardHeaders: true, legacyHeaders: false });

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "video-downloader-api",
    health: "/health",
    keepalive: "/health/keepalive",
  });
});
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
router.get("/health/keepalive", (_req, res) => {
  res.json({ status: "ok", keepalive: getKeepAliveStatus() });
});

router.post("/api/auth/sync", authLimiter, syncAuthProfile);
router.patch("/api/auth/profile", authLimiter, completeProfile);
router.get("/api/me", getMe);
router.post("/api/admin/login", authLimiter, adminLogin);
router.get("/api/admin/dashboard", requireAdmin, getAdminDashboard);
router.get("/api/admin/feedback", requireAdmin, listFeedback);
router.patch("/api/admin/feedback/:id", requireAdmin, updateFeedback);
router.delete("/api/admin/feedback/:id", requireAdmin, deleteFeedback);
router.post("/api/feedback", feedbackLimiter, submitFeedback);
router.post("/api/analytics/page-view", trackPageView);

router.post("/api/video-info", getVideoInfo);
router.post("/api/downloads", createDownload);
router.get("/api/downloads/:jobId", getDownload);
router.post("/api/downloads/:jobId/cancel", cancelDownload);
router.get("/api/downloads/:jobId/file", downloadFile);


