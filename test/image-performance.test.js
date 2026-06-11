const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

test("uploads create cached thumbnails while keeping originals available", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pickasticka-test-"));
  const port = 7200 + crypto.randomInt(1000);
  const server = startServer(tempRoot, port);

  t.after(async () => {
    server.kill();
    await waitForExit(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitForHealth(port);

  const original = createPng(384, 384, 12345);
  const formData = new FormData();
  formData.append("stickers", new Blob([original], { type: "image/png" }), "loud-test-sticker.png");

  const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/upload`, {
    method: "POST",
    body: formData
  });
  assert.equal(uploadResponse.status, 201);

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/stickers`);
  assert.equal(listResponse.status, 200);
  const data = await listResponse.json();
  assert.equal(data.stickers.length, 1);

  const [sticker] = data.stickers;
  assert.equal(sticker.originalName, "loud-test-sticker.png");
  assert.match(sticker.thumbnailFilename, /\.webp$/);
  assert.notEqual(sticker.thumbnailFilename, sticker.filename);

  const originalResponse = await fetch(`http://127.0.0.1:${port}/stickers/${encodeURIComponent(sticker.filename)}`);
  assert.equal(originalResponse.status, 200);
  assert.equal(originalResponse.headers.get("cache-control"), "public, max-age=2592000, immutable");

  const thumbnailResponse = await fetch(`http://127.0.0.1:${port}/thumbs/${encodeURIComponent(sticker.thumbnailFilename)}`);
  assert.equal(thumbnailResponse.status, 200);
  assert.equal(thumbnailResponse.headers.get("content-type"), "image/webp");
  assert.equal(thumbnailResponse.headers.get("cache-control"), "public, max-age=2592000, immutable");

  const thumbnail = Buffer.from(await thumbnailResponse.arrayBuffer());
  assert.ok(thumbnail.length < original.length / 2, `thumbnail ${thumbnail.length} should be less than half of original ${original.length}`);
});

function startServer(tempRoot, port) {
  const env = {
    ...process.env,
    PORT: String(port),
    PICKASTICKA_DATA_DIR: tempRoot,
    PICKASTICKA_STICKER_DIR: path.join(tempRoot, "stickers"),
    PICKASTICKA_THUMB_DIR: path.join(tempRoot, "thumbs"),
    PICKASTICKA_DB_PATH: path.join(tempRoot, "pickasticka.sqlite")
  };

  return childProcess.spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(50);
  }

  throw lastError || new Error("Server did not become healthy.");
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPng(width, height, seed) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let state = seed >>> 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;

    for (let x = 0; x < width; x += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;

      const offset = row + 1 + x * 4;
      raw[offset] = state & 255;
      raw[offset + 1] = (state >>> 8) & 255;
      raw[offset + 2] = (state >>> 16) & 255;
      raw[offset + 3] = 255;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, "ascii");
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}

function crc32(buffer) {
  let crc = ~0;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return ~crc >>> 0;
}
