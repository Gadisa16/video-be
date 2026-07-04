import { z } from "zod";
import { trackEvent } from "../services/analytics.js";
import { asyncHandler } from "../utils/errors.js";

const pageViewSchema = z.object({
  path: z.string().min(1).max(200).regex(/^\//),
});

export const trackPageView = asyncHandler(async (req, res) => {
  const { path } = pageViewSchema.parse(req.body);
  await trackEvent(req, res, "page_view", { path });
  res.status(204).send();
});
