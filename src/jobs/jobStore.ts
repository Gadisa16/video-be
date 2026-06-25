import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { DownloadJob, DownloadStatus } from "../types/video.js";

export interface StoredJob extends DownloadJob {
  jobDir: string;
  process?: ChildProcessWithoutNullStreams;
  timeout?: NodeJS.Timeout;
}

class InMemoryJobStore {
  private jobs = new Map<string, StoredJob>();

  create(job: StoredJob) {
    this.jobs.set(job.id, job);
    return this.toPublic(job);
  }

  get(id: string) {
    const job = this.jobs.get(id);
    return job ? this.toPublic(job) : null;
  }

  getInternal(id: string) {
    return this.jobs.get(id) ?? null;
  }

  update(id: string, patch: Partial<StoredJob>) {
    const current = this.jobs.get(id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    this.jobs.set(id, updated);
    return this.toPublic(updated);
  }

  activeCount() {
    return Array.from(this.jobs.values()).filter((job) => job.status === "queued" || job.status === "processing").length;
  }

  listByStatus(statuses: DownloadStatus[]) {
    return Array.from(this.jobs.values()).filter((job) => statuses.includes(job.status));
  }

  private toPublic(job: StoredJob): DownloadJob {
    const publicJob: DownloadJob = { ...job };
    delete (publicJob as Partial<StoredJob>).process;
    delete (publicJob as Partial<StoredJob>).timeout;
    delete (publicJob as Partial<StoredJob>).jobDir;
    delete publicJob.filePath;
    return publicJob;
  }
}

export const jobStore = new InMemoryJobStore();
