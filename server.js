const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const stream = require("node:stream/promises");

const Database = require("better-sqlite3");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const unzipper = require("unzipper");

const PORT = Number(process.env.PORT || 6767);
const ROOT = __dirname;
const DATA_DIR = process.env.PICKASTICKA_DATA_DIR || path.join(ROOT, "data");
const STICKER_DIR = process.env.PICKASTICKA_STICKER_DIR || path.join(DATA_DIR, "stickers");
const THUMB_DIR = process.env.PICKASTICKA_THUMB_DIR || path.join(DATA_DIR, "thumbs");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const DB_PATH = process.env.PICKASTICKA_DB_PATH || path.join(DATA_DIR, "pickasticka.sqlite");

const MAX_FILE_SIZE = Number(process.env.PICKASTICKA_MAX_FILE_SIZE || 50 * 1024 * 1024);
const MAX_ZIP_SIZE = Number(process.env.PICKASTICKA_MAX_ZIP_SIZE || 500 * 1024 * 1024);
const THUMBNAIL_SIZE = Number(process.env.PICKASTICKA_THUMBNAIL_SIZE || 320);
const STATIC_ASSET_MAX_AGE = "1h";
const STATIC_IMAGE_MAX_AGE = "30d";
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const ZIP_EXTENSION = ".zip";

const upload = multer({
  dest: TMP_DIR,
  limits: {
    fileSize: MAX_ZIP_SIZE
  }
});

const app = express();

fs.mkdirSync(STICKER_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS stickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    thumbnail_filename TEXT,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    copy_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_stickers_usage
  ON stickers(copy_count DESC, updated_at DESC);
`);
ensureColumn("stickers", "thumbnail_filename", "TEXT");

const insertSticker = db.prepare(`
  INSERT INTO stickers (filename, thumbnail_filename, original_name, mime_type, size)
  VALUES (@filename, @thumbnailFilename, @originalName, @mimeType, @size)
`);
const listStickers = db.prepare(`
  SELECT id, filename, thumbnail_filename AS thumbnailFilename,
    original_name AS originalName, mime_type AS mimeType,
    size, copy_count AS copyCount, created_at AS createdAt, updated_at AS updatedAt
  FROM stickers
  ORDER BY copy_count DESC, updated_at DESC, id DESC
`);
const getSticker = db.prepare("SELECT * FROM stickers WHERE id = ?");
const listStickerFiles = db.prepare(`
  SELECT id, filename, thumbnail_filename AS thumbnailFilename
  FROM stickers
  ORDER BY id ASC
`);
const setStickerThumbnail = db.prepare(`
  UPDATE stickers
  SET thumbnail_filename = ?
  WHERE id = ?
`);
const incrementCopy = db.prepare(`
  UPDATE stickers
  SET copy_count = copy_count + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

app.disable("x-powered-by");
app.use(express.static(path.join(ROOT, "public"), {
  maxAge: STATIC_ASSET_MAX_AGE,
  setHeaders(res, filePath) {
    const basename = path.basename(filePath);
    if (basename === "index.html" || basename === "sw.js") {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    }
  }
}));
app.use("/stickers", express.static(STICKER_DIR, {
  immutable: true,
  maxAge: STATIC_IMAGE_MAX_AGE
}));
app.use("/thumbs", express.static(THUMB_DIR, {
  immutable: true,
  maxAge: STATIC_IMAGE_MAX_AGE
}));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get("/api/stickers", (_req, res) => {
  res.json({ stickers: listStickers.all() });
});

app.post("/api/stickers/:id/copy", (req, res) => {
  const id = Number(req.params.id);
  const sticker = Number.isInteger(id) ? getSticker.get(id) : null;

  if (!sticker) {
    res.status(404).json({ error: "Sticker not found." });
    return;
  }

  incrementCopy.run(id);
  const updated = getSticker.get(id);
  res.json({ copyCount: updated.copy_count });
});

app.post("/api/upload", upload.array("stickers", 25), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      res.status(400).json({ error: "No files were uploaded." });
      return;
    }

    const imported = [];
    const skipped = [];

    for (const file of files) {
      const extension = path.extname(file.originalname).toLowerCase();

      if (extension === ZIP_EXTENSION) {
        const zipResults = await importZip(file.path);
        imported.push(...zipResults.imported);
        skipped.push(...zipResults.skipped);
        await removeTmp(file.path);
        continue;
      }

      if (!IMAGE_EXTENSIONS.has(extension)) {
        skipped.push({ name: file.originalname, reason: "Unsupported file type." });
        await removeTmp(file.path);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        skipped.push({ name: file.originalname, reason: "File is too large." });
        await removeTmp(file.path);
        continue;
      }

      imported.push(await persistStickerFile(file.path, file.originalname, file.mimetype, file.size));
    }

    res.status(201).json({ imported, skipped });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Something went wrong while handling that request." });
});

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function importZip(zipPath) {
  const imported = [];
  const skipped = [];
  const directory = await unzipper.Open.file(zipPath);

  for (const entry of directory.files) {
    if (entry.type !== "File") {
      continue;
    }

    const originalName = path.basename(entry.path);
    const extension = path.extname(originalName).toLowerCase();

    if (!IMAGE_EXTENSIONS.has(extension)) {
      skipped.push({ name: entry.path, reason: "Unsupported file type." });
      continue;
    }

    if (entry.uncompressedSize > MAX_FILE_SIZE) {
      skipped.push({ name: entry.path, reason: "File is too large." });
      continue;
    }

    const tmpPath = path.join(TMP_DIR, `${crypto.randomUUID()}${extension}`);
    await stream.pipeline(entry.stream(), fs.createWriteStream(tmpPath, { flags: "wx" }));

    const stat = await fsp.stat(tmpPath);
    imported.push(await persistStickerFile(tmpPath, originalName, mimeFromExtension(extension), stat.size));
  }

  return { imported, skipped };
}

async function persistStickerFile(sourcePath, originalName, mimeType, size) {
  const extension = path.extname(originalName).toLowerCase();
  const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const thumbnailFilename = thumbnailFilenameFor(filename);
  const destination = path.join(STICKER_DIR, filename);
  const thumbnailDestination = path.join(THUMB_DIR, thumbnailFilename);

  await fsp.rename(sourcePath, destination);
  await generateThumbnail(destination, thumbnailDestination);

  const result = insertSticker.run({
    filename,
    thumbnailFilename,
    originalName: cleanOriginalName(originalName),
    mimeType: mimeType || mimeFromExtension(extension),
    size
  });

  return {
    id: result.lastInsertRowid,
    filename,
    thumbnailFilename,
    originalName: cleanOriginalName(originalName),
    mimeType: mimeType || mimeFromExtension(extension),
    size
  };
}

async function removeTmp(filePath) {
  await fsp.rm(filePath, { force: true });
}

function cleanOriginalName(name) {
  return path.basename(name).replace(/[^\w.\- ()[\]]/g, "_").slice(0, 180) || "sticker";
}

async function start() {
  await backfillMissingThumbnails();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PickaSticka is running on http://0.0.0.0:${PORT}`);
  });
}

async function backfillMissingThumbnails() {
  for (const sticker of listStickerFiles.all()) {
    const thumbnailFilename = sticker.thumbnailFilename || thumbnailFilenameFor(sticker.filename);
    const sourcePath = path.join(STICKER_DIR, sticker.filename);
    const thumbnailPath = path.join(THUMB_DIR, thumbnailFilename);

    try {
      if (!(await fileExists(sourcePath))) {
        continue;
      }

      if (!(await fileExists(thumbnailPath))) {
        await generateThumbnail(sourcePath, thumbnailPath);
      }

      if (sticker.thumbnailFilename !== thumbnailFilename) {
        setStickerThumbnail.run(thumbnailFilename, sticker.id);
      }
    } catch (error) {
      console.error(`Could not create thumbnail for ${sticker.filename}:`, error.message);
    }
  }
}

async function generateThumbnail(sourcePath, destinationPath) {
  const tempPath = `${destinationPath}.${crypto.randomUUID()}.tmp`;

  try {
    await sharp(sourcePath, { animated: true })
      .rotate()
      .resize({
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({
        quality: 72,
        effort: 4
      })
      .toFile(tempPath);

    await fsp.rename(tempPath, destinationPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function thumbnailFilenameFor(filename) {
  return `${path.parse(filename).name}-thumb.webp`;
}

function ensureColumn(tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
}

function mimeFromExtension(extension) {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
