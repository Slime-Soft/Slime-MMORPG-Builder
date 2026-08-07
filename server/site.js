// server/site.js
// Read-only endpoints that feed the public landing page (public/home.html).
//
// Both exist so the site shows REAL numbers and REAL release notes. A landing
// page with invented "12,458 active creators" on it is a lie that costs
// nothing to avoid: the server already knows exactly how many monsters,
// items, skills and maps this install has, and changelogs.md already holds
// what actually shipped. Everything here is derived from those.
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Turns changelogs.md into entries for the "Latest Updates" panel.
 *
 * The file is hand-written prose, so the parser is deliberately forgiving:
 * any line that looks like a version heading starts a new entry, and any
 * bullet under it becomes one of its notes. Anything it doesn't recognise is
 * skipped rather than throwing — a malformed changelog should cost you the
 * news panel, not the whole landing page.
 *
 * Recognised heading forms (with or without leading #'s):
 *   Update 0.11
 *   ## Update 0.11 — Skybox uploads
 *   v0.11
 */
export function parseChangelog(markdown) {
  const HEADING_RE = /^\s*#{0,6}\s*(?:update\s+|version\s+|v)\s*([0-9][0-9.]*)\s*[-–—:]?\s*(.*)$/i;
  const BULLET_RE = /^\s*[*\-+]\s+(.+?)\s*$/;

  const entries = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      entries.push({ version: heading[1], title: heading[2].trim() || null, notes: [] });
      continue;
    }
    const bullet = line.match(BULLET_RE);
    // A bullet before any heading has no entry to belong to — drop it rather
    // than inventing an "untitled" release for it.
    if (bullet && entries.length) entries[entries.length - 1].notes.push(bullet[1]);
  }
  return entries;
}

/**
 * Mounts /api/site/*.
 *
 * @param {object} app express app
 * @param {string} rootDir project root
 * @param {() => Record<string, number>} readStats returns live catalog counts.
 *   A callback, not a snapshot: the editors rewrite these catalogs while the
 *   server runs, so a value captured at boot would go stale the first time
 *   someone saves a monster.
 */
export function mountSiteRoutes(app, { rootDir, readStats }) {
  const changelogPath = path.join(rootDir, 'changelogs.md');

  app.get('/api/site/news', (_req, res) => {
    try {
      if (!existsSync(changelogPath)) return res.json({ ok: true, entries: [] });
      res.json({ ok: true, entries: parseChangelog(readFileSync(changelogPath, 'utf-8')).slice(0, 6) });
    } catch (err) {
      console.warn('[site] could not read changelogs.md:', err.message);
      res.json({ ok: true, entries: [] }); // the panel just renders empty
    }
  });

  app.get('/api/site/stats', (_req, res) => {
    try {
      res.json({ ok: true, stats: readStats() });
    } catch (err) {
      console.warn('[site] could not read stats:', err.message);
      res.json({ ok: true, stats: {} });
    }
  });
}
