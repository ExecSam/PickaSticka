const grid = document.querySelector("#sticker-grid");
const emptyState = document.querySelector("#empty-state");
const template = document.querySelector("#sticker-card-template");
const statusEl = document.querySelector("#status");
const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file-input");
const pickFiles = document.querySelector("#pick-files");
const dropZone = document.querySelector("#drop-zone");
const search = document.querySelector("#search");
const stickerCount = document.querySelector("#sticker-count");

let stickers = [];

loadStickers();

pickFiles.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  statusEl.textContent = fileInput.files.length
    ? `${fileInput.files.length} file${fileInput.files.length === 1 ? "" : "s"} ready.`
    : "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await uploadFiles(fileInput.files);
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  await uploadFiles(event.dataTransfer.files);
});

document.addEventListener("paste", async (event) => {
  const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));

  if (files.length === 0) {
    return;
  }

  event.preventDefault();
  await uploadFiles(files, "Pasted sticker saved.");
});

search.addEventListener("input", renderStickers);

async function loadStickers() {
  const response = await fetch("/api/stickers");
  const data = await response.json();
  stickers = data.stickers || [];
  renderStickers();
}

async function uploadFiles(files, successText) {
  const fileList = [...files];
  if (fileList.length === 0) {
    statusEl.textContent = "Choose, drop, or paste a sticker first.";
    return;
  }

  const body = new FormData();
  fileList.forEach((file) => body.append("stickers", file, file.name || `pasted-sticker-${Date.now()}.png`));

  setBusy(true, "Uploading...");

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    const skippedText = data.skipped?.length ? ` ${data.skipped.length} skipped.` : "";
    statusEl.textContent = successText || `${data.imported.length} imported.${skippedText}`;
    await loadStickers();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function renderStickers() {
  const query = search.value.trim().toLowerCase();
  const visible = stickers.filter((sticker) => sticker.originalName.toLowerCase().includes(query));

  grid.replaceChildren();
  emptyState.hidden = visible.length !== 0;
  stickerCount.textContent = `${stickers.length} sticker${stickers.length === 1 ? "" : "s"}`;

  for (const sticker of visible) {
    const card = template.content.firstElementChild.cloneNode(true);
    const img = card.querySelector(".sticker-art");
    const name = card.querySelector(".sticker-name");
    const count = card.querySelector(".copy-count");

    img.src = `/stickers/${encodeURIComponent(sticker.filename)}`;
    img.alt = sticker.originalName;
    name.textContent = sticker.originalName;
    count.textContent = `${sticker.copyCount} copied`;
    card.title = `Copy ${sticker.originalName}`;
    card.addEventListener("click", () => copySticker(sticker));

    grid.append(card);
  }
}

async function copySticker(sticker) {
  try {
    const imageResponse = await fetch(`/stickers/${encodeURIComponent(sticker.filename)}`);
    let blob = await imageResponse.blob();

    if (navigator.clipboard?.write && window.ClipboardItem) {
      if (!canWriteMime(blob.type)) {
        blob = await convertImageToPng(blob);
      }

      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
    } else {
      await navigator.clipboard.writeText(new URL(`/stickers/${sticker.filename}`, window.location.origin).href);
    }

    const countResponse = await fetch(`/api/stickers/${sticker.id}/copy`, { method: "POST" });
    const data = await countResponse.json();
    sticker.copyCount = data.copyCount;
    stickers.sort((a, b) => b.copyCount - a.copyCount || b.id - a.id);
    renderStickers();
    statusEl.textContent = `${sticker.originalName} copied.`;
  } catch (error) {
    statusEl.textContent = `Could not copy: ${error.message}`;
  }
}

function canWriteMime(mimeType) {
  return !ClipboardItem.supports || ClipboardItem.supports(mimeType);
}

async function convertImageToPng(blob) {
  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);

    return await new Promise((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
        } else {
          reject(new Error("The sticker could not be converted for clipboard copying."));
        }
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setBusy(isBusy, message) {
  form.classList.toggle("is-busy", isBusy);
  form.querySelectorAll("button, input").forEach((element) => {
    element.disabled = isBusy;
  });

  if (message) {
    statusEl.textContent = message;
  }
}
