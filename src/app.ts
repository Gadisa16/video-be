import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { router } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.use(
    pinoHttp({
      redact: ["req.headers.authorization", "req.headers.cookie"],
    }),
  );
  app.use(cors({ origin: env.FRONTEND_ORIGIN }));
  app.use(express.json({ limit: "64kb" }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again shortly.",
        },
      },
    }),
  );

  app.use(router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

