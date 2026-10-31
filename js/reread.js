// Reread scheduler: finishing a chapter schedules rereads at expanding intervals.
import * as db from './db.js';
import { toast, DAY, startOfDay, fmtDue } from './ui.js';
import { chapterTitle } from './model.js';
import { t } from './i18n.js';

export const REREAD_DAYS = [1, 3, 7, 16, 35, 80];

/**
 * Mark a chapter as read. The first time starts the schedule; a reread on or after
 * its due day advances it; reading early just logs the read.
 */
export async function markChapterRead(ch) {
  const c = await db.get('chapters', ch.id);
  const now = Date.now();
  const r = c.reread || { step: -1, due: null, reads: [] };
  r.reads = [...(r.reads || []), now];
  const isDue = r.due == null || startOfDay(now) >= startOfDay(r.due);
  if (isDue && r.step < REREAD_DAYS.length) {
    r.step += 1;
    r.due = r.step < REREAD_DAYS.length ? startOfDay(now) + REREAD_DAYS[r.step] * DAY : null;
  }
  c.reread = r;
  await db.put('chapters', c);
  await logActivity();
  toast(r.due ? t('{0} ✓ · nochmal lesen {1}', chapterTitle(ch), fmtDue(r.due)) : t('{0} ✓ · alle Wiederholungen geschafft', chapterTitle(ch)), 2800);
  return c;
}

/** Chapters whose reread is due today or earlier. */
export function dueRereads(chapters, now = Date.now()) {
  return chapters.filter((c) => c.reread?.due && startOfDay(c.reread.due) <= startOfDay(now));
}

/** Days with any study activity (for the streak), stored as day keys. */
export async function logActivity() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = (await db.kv.get('activityDays')) || [];
  if (!days.includes(key)) {
    days.push(key);
    await db.kv.set('activityDays', days.slice(-800));
  }
}
