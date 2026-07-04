import { z } from "zod";
import { getContext } from "../middleware/requestContext.js";
import { trackEvent } from "../services/analytics.js";
import { deleteRows, insertRows, selectRows, updateRows } from "../services/supabase.js";
import { AppError, asyncHandler } from "../utils/errors.js";

const feedbackSchema = z.object({
  email: z.string().email().optional().or(z.literal("")),
  feeling: z.enum(["Happy", "Sad", "Bug Report", "Feature Request", "Suggestion", "Question", "Other"]),
  message: z.string().trim().min(3).max(2000),
});

const feedbackUpdateSchema = z.object({
  is_read: z.boolean().optional(),
  is_resolved: z.boolean().optional(),
});

export const submitFeedback = asyncHandler(async (req, res) => {
  const body = feedbackSchema.parse(req.body);
  const context = getContext(res);
  const rows = await insertRows("feedback", {
    user_id: context.user?.id ?? null,
    email: body.email || context.user?.email || null,
    feeling: body.feeling,
    message: body.message,
    ip_hash: context.ipHash,
    user_agent_hash: context.userAgentHash,
  });
  await trackEvent(req, res, "feedback_submission", { metadata: { feeling: body.feeling } });
  res.status(201).json({ feedback: rows[0] });
});

export const listFeedback = asyncHandler(async (req, res) => {
  const feeling = typeof req.query.feeling === "string" ? req.query.feeling : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filters = ["select=*", "order=created_at.desc"];
  if (feeling && feeling !== "all") filters.push(`feeling=eq.${encodeURIComponent(feeling)}`);
  if (search) filters.push(`or=(email.ilike.*${encodeURIComponent(search)}*,message.ilike.*${encodeURIComponent(search)}*)`);
  const rows = await selectRows("feedback", filters.join("&"));
  res.json({ feedback: rows });
});

export const updateFeedback = asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const patch = feedbackUpdateSchema.parse(req.body);
  if (Object.keys(patch).length === 0) throw new AppError("BAD_REQUEST", "No feedback update was provided.", 400);
  const rows = await updateRows("feedback", `id=eq.${id}`, patch);
  res.json({ feedback: rows[0] ?? null });
});

export const deleteFeedback = asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await deleteRows("feedback", `id=eq.${id}`);
  res.status(204).send();
});
