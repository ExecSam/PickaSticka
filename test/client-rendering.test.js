const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("renders thumbnail previews with prioritized first-screen images", async () => {
  const stickers = Array.from({ length: 14 }, (_, index) => ({
    id: index + 1,
    filename: `original-${index + 1}.png`,
    thumbnailFilename: `thumbnail-${index + 1}.webp`,
    originalName: `Sticker ${index + 1}`,
    copyCount: 0
  }));

  const { grid } = await runApp(stickers);

  assert.equal(grid.children.length, stickers.length);
  assert.equal(grid.children[0].image.src, "/thumbs/thumbnail-1.webp");
  assert.equal(grid.children[0].image.decoding, "async");
  assert.equal(grid.children[0].image.loading, "eager");
  assert.equal(grid.children[0].image.fetchPriority, "high");
  assert.equal(grid.children[13].image.src, "/thumbs/thumbnail-14.webp");
  assert.equal(grid.children[13].image.loading, "lazy");
  assert.equal(grid.children[13].image.fetchPriority, "low");
});

async function runApp(stickers) {
  const grid = new Element();
  const emptyState = new Element();
  const status = new Element();
  const form = new Element();
  const fileInput = new Element();
  const pickFiles = new Element();
  const dropZone = new Element();
  const search = new Element();
  const stickerCount = new Element();
  const template = new Element();

  template.content = {
    firstElementChild: createStickerCard()
  };
  form.querySelectorAll = () => [];

  const elements = new Map([
    ["#sticker-grid", grid],
    ["#empty-state", emptyState],
    ["#sticker-card-template", template],
    ["#status", status],
    ["#upload-form", form],
    ["#file-input", fileInput],
    ["#pick-files", pickFiles],
    ["#drop-zone", dropZone],
    ["#search", search],
    ["#sticker-count", stickerCount]
  ]);

  const context = {
    Blob,
    ClipboardItem: undefined,
    FormData,
    Image: class {},
    URL,
    console,
    document: {
      addEventListener() {},
      createElement() {
        return new Element();
      },
      querySelector(selector) {
        return elements.get(selector);
      }
    },
    fetch: async (url) => {
      assert.equal(url, "/api/stickers");
      return {
        async json() {
          return { stickers };
        }
      };
    },
    navigator: {},
    setTimeout,
    window: {}
  };

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  vm.runInContext(source, context, { filename: "public/app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return { grid };
}

function createStickerCard() {
  const card = new Element();
  const image = new Element();
  const name = new Element();
  const count = new Element();

  card.image = image;
  card.name = name;
  card.count = count;
  card.querySelector = (selector) => {
    switch (selector) {
      case ".sticker-art":
        return image;
      case ".sticker-name":
        return name;
      case ".copy-count":
        return count;
      default:
        return null;
    }
  };
  card.cloneNode = () => createStickerCard();

  return card;
}

class Element {
  constructor() {
    this.children = [];
    this.classList = {
      add() {},
      remove() {},
      toggle() {}
    };
    this.files = [];
    this.value = "";
  }

  addEventListener() {}

  append(child) {
    this.children.push(child);
  }

  click() {}

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  replaceChildren(...children) {
    this.children = children;
  }
}
