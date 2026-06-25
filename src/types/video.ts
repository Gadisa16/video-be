export type SourcePlatform =
  | "YouTube"
  | "Vimeo"
  | "Twitter"
  | "TikTok"
  | "Facebook"
  | "Instagram"
  | "Generic";

export type FormatKind = "video" | "audio";

export interface DownloadFormat {
  id: string;
  kind: FormatKind;
  container: "mp4" | "mp3" | "webm" | "m4a";
  quality: string;
  label: string;
  approxSizeMb: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  author: string;
  platform: SourcePlatform;
  durationSeconds: number;
  thumbnailUrl: string;
  formats: DownloadFormat[];
}

export type DownloadStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface DownloadJob {
  id: string;
  url: string;
  videoId?: string;
  formatId: string;
  status: DownloadStatus;
  progress: number;
  speedKbps: number | null;
  etaSeconds: number | null;
  totalSizeMb: number | null;
  downloadedMb: number;
  startedAt: number;
  finishedAt?: number;
  error?: string | null;
  fileName?: string | null;
  filePath?: string | null;
}
