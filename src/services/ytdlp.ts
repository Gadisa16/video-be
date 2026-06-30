import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import type { DownloadFormat, VideoInfo } from "../types/video.js";
import { AppError, mapYtDlpError } from "../utils/errors.js";
import { detectPlatform } from "./domain.js";

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  height?: number;
  acodec?: string;
  vcodec?: string;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
}

interface YtDlpInfo {
  id?: string;
  webpage_url?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  creator?: string;
  duration?: number;
  thumbnail?: string;
  extractor_key?: string;
  formats?: YtDlpFormat[];
}

export interface SelectedFormat {
  args: string[];
  outputExtension: "mp4" | "mp3";
  formatLabel: string;
}

export async function getVideoInfoFromYtDlp(url: string): Promise<VideoInfo> {
  const stdout = await runYtDlpJson([
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    url,
  ]);
  const info = JSON.parse(stdout) as YtDlpInfo;
  const duration = Math.round(info.duration ?? 0);

  if (duration > env.MAX_DURATION_SECONDS) {
    throw new AppError(
      "TOO_LONG",
      `This video is longer than the configured ${env.MAX_DURATION_SECONDS} second limit.`,
      413,
    );
  }

  const parsed = new URL(info.webpage_url ?? url);
  const formats = buildFrontendFormats(info.formats ?? []);
  if (formats.length === 0) {
    throw new AppError("UNSUPPORTED_URL", "No downloadable public formats were found for this media.", 422);
  }

  return {
    id: info.id ?? parsed.href,
    url: info.webpage_url ?? url,
    title: info.title ?? "Untitled video",
    author: info.uploader ?? info.channel ?? info.creator ?? "Unknown author",
    platform: detectPlatform(parsed.hostname),
    durationSeconds: duration,
    thumbnailUrl: info.thumbnail ?? "",
    formats,
  };
}

export function resolveSelectedFormat(formatId: string): SelectedFormat {
  const videoMatch = /^mp4-(\d+)p$/.exec(formatId);
  if (videoMatch) {
    const height = videoMatch[1];
    return {
      args: [
        "-f",
        [
          `bestvideo[height<=${height}][ext=mp4][vcodec^=h264]+bestaudio[ext=m4a]`,
          `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]`,
          `best[height<=${height}][ext=mp4][vcodec^=h264]`,
          `best[height<=${height}][ext=mp4]`,
          `best[height<=${height}]`,
          "best[ext=mp4][vcodec^=h264]",
          "best[ext=mp4]",
          "best",
        ].join("/"),
        "--merge-output-format",
        "mp4",
      ],
      outputExtension: "mp4",
      formatLabel: `MP4 - ${height}p - Video + Audio`,
    };
  }

  if (formatId === "mp3-320") {
    return {
      args: ["-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"],
      outputExtension: "mp3",
      formatLabel: "MP3 - best audio",
    };
  }

  throw new AppError("BAD_REQUEST", "The requested format is not available.", 400);
}

async function runYtDlpJson(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new AppError("INTERNAL_ERROR", `Unable to start yt-dlp: ${error.message}`, 500));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(mapYtDlpError(stderr));
      }
    });
  });
}

function buildFrontendFormats(formats: YtDlpFormat[]): DownloadFormat[] {
  const heights = Array.from(
    new Set(
      formats
        .filter((format) => format.vcodec && format.vcodec !== "none" && format.height)
        .map((format) => format.height as number)
        .filter((height) => height >= 240),
    ),
  ).sort((a, b) => b - a);

  const preferredHeights = [1080, 720, 480, 360];
  const exactPreferredHeights = preferredHeights.filter((height) => heights.includes(height));
  const displayHeights = exactPreferredHeights.length > 0 ? exactPreferredHeights : heights.slice(0, 4);

  const videoFormats: DownloadFormat[] = displayHeights.map((height) => {
    const sizeBytes = estimateSizeForHeight(formats, height);
    return {
      id: `mp4-${height}p`,
      kind: "video" as const,
      container: "mp4" as const,
      quality: `${height}p`,
      label: `MP4 - ${height}p - Video + Audio`,
      approxSizeMb: bytesToMb(sizeBytes),
      hasAudio: true,
      hasVideo: true,
    };
  });

  const audioSize = formats
    .filter((format) => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"))
    .map((format) => format.filesize ?? format.filesize_approx ?? 0)
    .sort((a, b) => b - a)[0] ?? 0;

  return [
    ...videoFormats,
    {
      id: "mp3-320",
      kind: "audio" as const,
      container: "mp3" as const,
      quality: "best",
      label: "MP3 - Best audio",
      approxSizeMb: bytesToMb(audioSize),
      hasAudio: true,
      hasVideo: false,
    },
  ].filter((format) => format.approxSizeMb === 0 || format.approxSizeMb <= env.MAX_FILE_SIZE_MB);
}

function estimateSizeForHeight(formats: YtDlpFormat[], height: number) {
  const video = formats
    .filter((format) => format.vcodec && format.vcodec !== "none" && (format.height ?? 0) <= height)
    .map((format) => format.filesize ?? format.filesize_approx ?? 0)
    .sort((a, b) => b - a)[0] ?? 0;
  const audio = formats
    .filter((format) => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"))
    .map((format) => format.filesize ?? format.filesize_approx ?? 0)
    .sort((a, b) => b - a)[0] ?? 0;
  return video + audio;
}

function bytesToMb(bytes: number) {
  if (!bytes || bytes < 0) return 0;
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
