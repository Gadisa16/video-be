import { Router } from "express";
import { cancelDownload, createDownload, downloadFile, getDownload } from "../controllers/downloadController.js";
import { getVideoInfo } from "../controllers/videoController.js";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.post("/api/video-info", getVideoInfo);
router.post("/api/downloads", createDownload);
router.get("/api/downloads/:jobId", getDownload);
router.post("/api/downloads/:jobId/cancel", cancelDownload);
router.get("/api/downloads/:jobId/file", downloadFile);
