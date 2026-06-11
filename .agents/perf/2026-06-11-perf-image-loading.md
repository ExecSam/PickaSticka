# Performance Report: Image Loading
Date: 2026-06-11
Mode: profile
Language: Node.js, browser JavaScript

## Summary
The current app loads full original sticker files directly into the grid. Browser and HTTP caching help repeat visits, but first load and any uncached sticker set are bounded by original image byte volume, request fan-out, and full-grid DOM replacement.

## Baseline Metrics
Synthetic baseline used 120 valid PNG stickers totaling 26,943,921 bytes.

| Metric | Value |
|--------|-------|
| API list median | 1.818 ms |
| API list payload | 23,208 bytes |
| First 24 originals | 5,388,952 bytes |
| First 24 fetch median | 20.477 ms on localhost |
| All 120 originals | 26,943,921 bytes |
| All 120 fetch median | 78.316 ms on localhost |
| Original sticker cache header | public, max-age=2592000, immutable |

## Current Flow
- `server.js` serves `/stickers` from the original sticker directory with 30-day immutable caching.
- `GET /api/stickers` returns every row from SQLite in copy-count order.
- `public/app.js` fetches all sticker metadata, filters in memory, clears the grid, and recreates every visible card.
- Each card image uses `/stickers/<filename>`, so the grid displays originals instead of display-sized thumbnails.
- Copying a sticker fetches the original image, updates copy count, sorts the array, and re-renders the whole grid.

## Hotspots
1. Full original image transfer for grid previews.
   - Every visible card points to the original file.
   - Impact: high. On the synthetic set, the first 24 cards represented 5.39 MB and all 120 represented 26.94 MB.

2. Eager full-grid image creation.
   - `renderStickers()` creates an `<img>` for every visible sticker immediately.
   - Impact: high for large libraries. Browser loading will fan out across all rendered images instead of prioritizing above-the-fold work.

3. Full DOM replacement on search and copy-count update.
   - `grid.replaceChildren()` discards image elements and card state on each render.
   - Impact: medium to high depending on sticker count. Network cache may avoid re-downloads, but decode, layout, and paint work repeat.

4. No thumbnail pipeline.
   - Upload persistence stores only the original.
   - Impact: high. The server cannot serve a cheap grid preview even though the CSS displays images at roughly 118-150 px tall.

5. Limited app-shell caching.
   - HTML, CSS, and JS use default `max-age=0` headers.
   - Impact: low compared with images, but easy to improve.

## Findings
High impact:
- Generate and serve small thumbnails for grid previews, keeping originals only for clipboard copy.
- Lazy-load below-the-fold previews and prioritize the first viewport.
- Render large libraries incrementally instead of replacing the whole grid on every interaction.

Medium impact:
- Add a cache-first service worker for thumbnails and originals.
- Avoid full re-render after copy; update the affected card count and only reorder if needed.

Low impact:
- Add longer cache headers for fingerprinted or versioned static app assets.

## Recommendations
Recommended route:
1. Add `sharp` and a thumbnail directory, for example `data/thumbs`.
2. On upload/import, write the original to `data/stickers` and a bounded WebP thumbnail around 256 px to `data/thumbs`.
3. Add a database migration for `thumbnail_filename`, or derive it deterministically from the original filename.
4. Serve `/thumbs` with long immutable caching.
5. Return `thumbnailFilename` from `/api/stickers`.
6. Change grid images to use thumbnails, with `loading="lazy"` for non-initial cards, `decoding="async"`, explicit width/height, and high fetch priority for the first screen.
7. Fetch originals only when the user clicks to copy.
8. Add a small cache-first service worker for `/thumbs/*` and `/stickers/*`.
9. Update copy-count UI in place where possible, avoiding full grid replacement.

Expected result:
- First screen transfers thumbnails instead of originals.
- A 24-card first viewport should move from multi-megabyte transfer to hundreds of kilobytes in typical sticker data.
- Repeat visits should feel instant because thumbnail and original URLs are immutable and service-worker/browser cached.

## Optimizations Applied
| Change | Before | After | Improvement |
|--------|--------|-------|-------------|
| Grid preview source | Original files from `/stickers` | WebP thumbnails from `/thumbs` | First 24 preview bytes down from 5,388,952 to 969,586 |
| Full library preview transfer | 26,943,921 bytes | 4,849,322 bytes | 82.0% fewer bytes |
| Representative preview file | 224,569-byte PNG | 40,452-byte WebP | 82.0% fewer bytes |
| Image loading behavior | Every rendered image requested as original | First screen eager/high priority, lower cards lazy/low priority | Less request fan-out on first paint |
| Repeat image visits | Browser HTTP cache only | Browser cache plus cache-first service worker for immutable images | Faster repeat loads after first visit |

## After Metrics
| Metric | Value |
|--------|-------|
| Startup with 120-thumbnail backfill | 1,666.546 ms |
| API list median | 1.290 ms |
| API list payload | 28,248 bytes |
| First 24 thumbnails | 969,586 bytes |
| First 24 thumbnail fetch median | 9.401 ms on localhost |
| All 120 thumbnails | 4,849,322 bytes |
| All 120 thumbnail fetch median | 31.968 ms on localhost |
| Thumbnail cache header | public, max-age=2592000, immutable |
