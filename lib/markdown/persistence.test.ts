import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearReaderSession,
  loadReaderSession,
  rememberActiveReaderTabId,
  saveReaderSession,
} from "@/lib/markdown/persistence";
import type { LoadedFile, ReaderState, ReaderTab } from "@/lib/markdown/types";

const ACTIVE_TAB_STORAGE_KEY = "markdown-reader-active-tab-id";
const DATABASE_NAME = "markdown-reader";
const SESSION_KEY = "current-session";
const STORE_NAME = "reader-sessions";

const file: LoadedFile = {
  content: "# Saved",
  kind: "markdown",
  lastModified: 1_700_000_000_000,
  name: "Saved.md",
  size: 7,
  source: "file",
};

function createTab(
  id: string,
  tabFile: LoadedFile | null = null,
  groupId: null | string = null,
): ReaderTab {
  return {
    activeHeadingId: null,
    error: null,
    file: tabFile,
    groupId,
    id,
    view: tabFile ? "source" : "preview",
  };
}

function createLocalStorageMock() {
  const entries = new Map<string, string>();

  return {
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
}

function openRawDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRawRecord(record: Record<string, unknown>) {
  const db = await openRawDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).put({ key: SESSION_KEY, ...record });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getRawRecord() {
  const db = await openRawDatabase();

  return new Promise<Record<string, unknown> | undefined>(
    (resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(SESSION_KEY) as IDBRequest<Record<string, unknown> | undefined>;

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    },
  );
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", createLocalStorageMock());
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveReaderSession and loadReaderSession", () => {
  it("round-trips a reader session", () => {
    const state: ReaderState = {
      activeTabId: "with-file",
      groups: [
        {
          collapsed: false,
          color: "cyan",
          id: "group-a",
          name: "Research",
        },
      ],
      tabs: [
        createTab("with-file", file, "group-a"),
        createTab("empty", null, "group-a"),
      ],
    };

    return saveReaderSession(state).then(async (savedAt) => {
      expect(typeof savedAt).toBe("number");

      const session = await loadReaderSession();

      expect(session?.savedAt).toBe(savedAt);
      expect(session?.state).toEqual(state);
    });
  });

  it("returns null when nothing has been saved", async () => {
    await expect(loadReaderSession()).resolves.toBeNull();
  });

  it("refuses to save a state with no usable tabs", async () => {
    await expect(
      saveReaderSession({ activeTabId: "x", groups: [], tabs: [] }),
    ).resolves.toBeNull();
    await expect(loadReaderSession()).resolves.toBeNull();
  });

  it("ignores records from an unknown schema version", async () => {
    await putRawRecord({
      savedAt: 123,
      schemaVersion: 99,
      state: { activeTabId: "a", tabs: [createTab("a")] },
    });

    await expect(loadReaderSession()).resolves.toBeNull();
  });

  it("drops malformed tabs and falls back to the first tab when the active id is stale", async () => {
    await putRawRecord({
      savedAt: 123,
      schemaVersion: 1,
      state: {
        activeTabId: "gone",
        tabs: [null, { view: "preview" }, createTab("kept")],
      },
    });

    const session = await loadReaderSession();

    expect(session?.state.tabs.map((tab) => tab.id)).toEqual(["kept"]);
    expect(session?.state.activeTabId).toBe("kept");
    expect(session?.state.groups).toEqual([]);
    expect(session?.state.tabs[0]?.groupId).toBeNull();
  });

  it("normalizes a partially stored file and resets the view of empty tabs", async () => {
    await putRawRecord({
      savedAt: 123,
      schemaVersion: 1,
      state: {
        activeTabId: "a",
        tabs: [
          {
            id: "a",
            // Missing size/lastModified and a bogus view for a tab with a file.
            file: { content: "hello", name: "hello.md", source: "paste" },
            view: "bogus",
          },
          {
            id: "b",
            // A tab without a file must never restore into source view.
            file: { name: "broken" },
            view: "source",
          },
        ],
      },
    });

    const session = await loadReaderSession();
    const [tabA, tabB] = session?.state.tabs ?? [];

    expect(tabA?.file).toMatchObject({
      content: "hello",
      kind: "markdown",
      name: "hello.md",
      size: 5,
      source: "paste",
    });
    expect(Number.isFinite(tabA?.file?.lastModified)).toBe(true);
    expect(tabA?.view).toBe("preview");
    expect(tabB?.file).toBeNull();
    expect(tabB?.view).toBe("preview");
  });

  it("round-trips a screenplay in Source view", async () => {
    const screenplay: LoadedFile = {
      content: "INT. HOUSE - DAY\n\nHe waits.",
      kind: "screenplay",
      lastModified: 42,
      name: "pilot.fountain",
      size: 27,
      source: "file",
    };
    const state: ReaderState = {
      activeTabId: "script",
      groups: [],
      tabs: [createTab("script", screenplay)],
    };

    await saveReaderSession(state);

    expect((await loadReaderSession())?.state).toEqual(state);
  });

  it("round-trips an imported PDF and restores its original view", async () => {
    const pdfData = new Uint8Array([37, 80, 68, 70]).buffer;
    const pdfFile: LoadedFile = {
      content: "# Report\n\n## Page 1\n\nHello",
      kind: "pdf",
      lastModified: 1_700_000_000_000,
      name: "Report.pdf",
      originalData: pdfData,
      pageCount: 1,
      size: pdfData.byteLength,
      source: "file",
    };
    const tab = createTab("pdf", pdfFile);
    tab.view = "original";

    await saveReaderSession({
      activeTabId: tab.id,
      groups: [],
      tabs: [tab],
    });

    const session = await loadReaderSession();
    const restoredFile = session?.state.tabs[0]?.file;

    expect(session?.state.tabs[0]?.view).toBe("original");
    expect(restoredFile?.kind).toBe("pdf");
    expect(
      restoredFile?.kind === "pdf"
        ? Array.from(new Uint8Array(restoredFile.originalData))
        : [],
    ).toEqual([37, 80, 68, 70]);
  });

  it("never lets an older save overwrite a newer record", async () => {
    const firstSavedAt = await saveReaderSession({
      activeTabId: "a",
      groups: [],
      tabs: [createTab("a")],
    });
    const newerState = {
      activeTabId: "newer",
      groups: [],
      tabs: [createTab("newer")],
    };

    await putRawRecord({
      savedAt: (firstSavedAt ?? 0) + 60_000,
      schemaVersion: 1,
      state: newerState,
    });
    await saveReaderSession({
      activeTabId: "older",
      groups: [],
      tabs: [createTab("older")],
    });

    const record = await getRawRecord();

    expect(record?.savedAt).toBe((firstSavedAt ?? 0) + 60_000);
    expect(record?.state).toEqual(newerState);
  });

  it("restores the separately remembered active tab when it still exists", async () => {
    await saveReaderSession({
      activeTabId: "a",
      groups: [],
      tabs: [createTab("a"), createTab("b")],
    });

    rememberActiveReaderTabId("b");
    await expect(loadReaderSession()).resolves.toMatchObject({
      state: { activeTabId: "b" },
    });

    rememberActiveReaderTabId("closed-elsewhere");
    await expect(loadReaderSession()).resolves.toMatchObject({
      state: { activeTabId: "a" },
    });
  });
});

describe("clearReaderSession", () => {
  it("removes the stored session and the remembered active tab", async () => {
    await saveReaderSession({
      activeTabId: "a",
      groups: [],
      tabs: [createTab("a", file)],
    });
    expect(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)).toBe("a");

    await clearReaderSession();

    expect(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)).toBeNull();
    await expect(loadReaderSession()).resolves.toBeNull();
  });
});
