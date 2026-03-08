import type { VerificationResult } from "@/app/api/verify/route";

const STORAGE_KEY = "rtv_history";
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  id: string;
  timestamp: number;
  task: string;
  result: VerificationResult;
  thumbnailDataUrl?: string;
}

export function saveVerification(
  task: string,
  result: VerificationResult,
  thumbnailDataUrl?: string
): HistoryEntry {
  const entry: HistoryEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    task,
    result,
    thumbnailDataUrl,
  };

  const existing = getHistory();
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage quota exceeded or SSR
  }

  return entry;
}

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function deleteEntry(id: string): void {
  const updated = getHistory().filter((e) => e.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
