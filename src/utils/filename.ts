const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

export function sanitizeFileName(input: string, fallback = "download") {
  const cleaned = input
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || FORBIDDEN_FILENAME_CHARS.has(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!cleaned || RESERVED_WINDOWS_NAMES.test(cleaned)) return fallback;
  return cleaned;
}
