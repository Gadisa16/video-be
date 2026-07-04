import { z } from "zod";
import { env } from "../config/env.js";
import { assertAllowedDomain } from "../services/domain.js";
import { trackEvent } from "../services/analytics.js";
import { recordVideoInfoRequest } from "../services/usage.js";
import { getVideoInfoFromYtDlp } from "../services/ytdlp.js";
import { asyncHandler } from "../utils/errors.js";

const videoInfoSchema = z.object({
  url: z.string().url(),
});

export const getVideoInfo = asyncHandler(async (req, res) => {
  const { url } = videoInfoSchema.parse(req.body);
  assertAllowedDomain(url);
  await recordVideoInfoRequest(res);
  await trackEvent(req, res, "video_info_request", { videoUrl: url });
  const video = await getVideoInfoFromYtDlp(url);

  const safeFormats = video.formats.filter(
    (format) => format.approxSizeMb === 0 || format.approxSizeMb <= env.MAX_FILE_SIZE_MB,
  );

  res.json({ video: { ...video, formats: safeFormats } });
});
