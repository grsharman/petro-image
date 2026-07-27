const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "snapshot-clipboard.js"),
  "utf8",
);

function loadClipboardApi() {
  const window = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return window.PetroImageSnapshotClipboard;
}

test("reports browser image clipboard capability requirements", () => {
  const api = loadClipboardApi();
  const supportedEnvironment = {
    isSecureContext: true,
    navigator: { clipboard: { write() {} } },
    ClipboardItem: class {
      static supports(type) {
        return type === "image/png";
      }
    },
  };

  assert.equal(
    api.getImageClipboardUnavailableReason(supportedEnvironment),
    "",
  );
  assert.match(
    api.getImageClipboardUnavailableReason({
      ...supportedEnvironment,
      isSecureContext: false,
    }),
    /HTTPS or localhost/,
  );
  assert.match(
    api.getImageClipboardUnavailableReason({
      ...supportedEnvironment,
      navigator: {},
    }),
    /not supported/,
  );
});

test("accepts supported browser and Electron snapshot clipboards", () => {
  const api = loadClipboardApi();
  const supportedBrowser = {
    isSecureContext: true,
    navigator: { clipboard: { write() {} } },
    ClipboardItem: class {
      static supports(type) {
        return type === "image/png";
      }
    },
  };

  assert.equal(
    api.getSnapshotClipboardUnavailableReason(supportedBrowser),
    "",
  );
  assert.equal(
    api.getSnapshotClipboardUnavailableReason({
      electronAPI: { copyImageToClipboard() {} },
    }),
    "",
  );
});

test("starts a PNG clipboard write before the image blob resolves", async () => {
  const api = loadClipboardApi();
  let writtenItems = null;
  let resolveBlob;
  const blobPromise = new Promise((resolve) => {
    resolveBlob = resolve;
  });

  class ClipboardItem {
    static supports(type) {
      return type === "image/png";
    }

    constructor(items) {
      this.items = items;
    }
  }

  const environment = {
    isSecureContext: true,
    ClipboardItem,
    navigator: {
      clipboard: {
        write(items) {
          writtenItems = items;
          return Promise.resolve();
        },
      },
    },
  };

  const writePromise = api.writeBrowserImageToClipboard(
    blobPromise,
    environment,
  );
  assert.equal(writtenItems.length, 1);
  assert.equal(writtenItems[0].items["image/png"], blobPromise);

  resolveBlob({ type: "image/png" });
  await writePromise;
});

test("turns clipboard permission rejection into an actionable message", async () => {
  const api = loadClipboardApi();
  class ClipboardItem {}
  const environment = {
    isSecureContext: true,
    ClipboardItem,
    navigator: {
      clipboard: {
        write() {
          const error = new Error("denied");
          error.name = "NotAllowedError";
          return Promise.reject(error);
        },
      },
    },
  };

  await assert.rejects(
    api.writeBrowserImageToClipboard(
      Promise.resolve({ type: "image/png" }),
      environment,
    ),
    /Allow clipboard access/,
  );
});
