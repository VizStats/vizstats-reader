import type {
  LoadedFile,
  ReaderState,
  ReaderTab,
  ReaderTabGroup,
  ReaderTabGroupColor,
  ReaderView,
} from "@/lib/markdown/types";

const DATABASE_NAME = "markdown-reader";
const DATABASE_VERSION = 1;
const ACTIVE_TAB_STORAGE_KEY = "markdown-reader-active-tab-id";
const SESSION_KEY = "current-session";
const STORE_NAME = "reader-sessions";

let lastSaveTimestamp = 0;

type ReaderSessionRecord = {
  key: typeof SESSION_KEY;
  savedAt: number;
  schemaVersion: 2;
  state: ReaderState;
};

export type PersistedReaderSession = {
  savedAt: number;
  state: ReaderState;
};

export function isReaderPersistenceAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export async function loadReaderSession(): Promise<PersistedReaderSession | null> {
  if (!isReaderPersistenceAvailable()) {
    return null;
  }

  const db = await openReaderDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SESSION_KEY);

    request.onsuccess = () => {
      const record = normalizeSessionRecord(request.result);
      resolve(
        record
          ? {
              ...record,
              state: applyRememberedActiveTab(record.state),
            }
          : null,
      );
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Reader session could not be loaded."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Reader session transaction failed."),
      );
    };
  });
}

export async function saveReaderSession(state: ReaderState) {
  if (!isReaderPersistenceAvailable()) {
    return null;
  }

  const savedAt = getNextSaveTimestamp();
  const normalizedState = normalizeReaderState(state);

  if (!normalizedState) {
    return null;
  }

  rememberActiveReaderTabId(normalizedState.activeTabId);

  const db = await openReaderDatabase();
  const record: ReaderSessionRecord = {
    key: SESSION_KEY,
    savedAt,
    schemaVersion: 2,
    state: normalizedState,
  };

  return new Promise<number>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SESSION_KEY);

    request.onerror = () =>
      reject(request.error ?? new Error("Reader session could not be saved."));
    request.onsuccess = () => {
      const existingSavedAt = getRecordSavedAt(request.result);

      if (existingSavedAt !== null && existingSavedAt > savedAt) {
        return;
      }

      let putRequest: IDBRequest<IDBValidKey>;

      try {
        putRequest = store.put(record);
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Reader session could not be saved."),
        );
        return;
      }

      putRequest.onerror = () =>
        reject(
          putRequest.error ?? new Error("Reader session could not be saved."),
        );
    };
    transaction.oncomplete = () => {
      db.close();
      resolve(savedAt);
    };
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Reader session transaction failed."),
      );
    };
  });
}

export async function clearReaderSession() {
  if (typeof window !== "undefined" && "localStorage" in window) {
    try {
      window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    } catch {
      // Browser storage may be unavailable in private contexts.
    }
  }

  if (!isReaderPersistenceAvailable()) {
    return;
  }

  const db = await openReaderDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).delete(SESSION_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Reader session could not be cleared."),
      );
    };
  });
}

function getNextSaveTimestamp() {
  const nextTimestamp = Math.max(Date.now(), lastSaveTimestamp + 1);

  lastSaveTimestamp = nextTimestamp;

  return nextTimestamp;
}

function getRecordSavedAt(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt)
  ) {
    return null;
  }

  return value.savedAt;
}

export function rememberActiveReaderTabId(tabId: string) {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return;
  }

  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
  } catch {
    // Browser storage may be unavailable in private contexts.
  }
}

function getRememberedActiveTabId() {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return null;
  }

  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function applyRememberedActiveTab(state: ReaderState) {
  const activeTabId = getRememberedActiveTabId();

  if (
    !activeTabId ||
    !state.tabs.some((tab) => tab.id === activeTabId)
  ) {
    return state;
  }

  return {
    ...state,
    activeTabId,
  };
}

function openReaderDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Reader persistence is unavailable."));
  });
}

function normalizeSessionRecord(value: unknown): PersistedReaderSession | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2)
  ) {
    return null;
  }

  const state = normalizeReaderState(value.state);
  const savedAt =
    typeof value.savedAt === "number" && Number.isFinite(value.savedAt)
      ? value.savedAt
      : Date.now();

  return state ? { savedAt, state } : null;
}

function normalizeReaderState(value: unknown): ReaderState | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    return null;
  }

  const groups = (Array.isArray(value.groups) ? value.groups : [])
    .map(normalizeReaderTabGroup)
    .filter((group): group is ReaderTabGroup => Boolean(group))
    .filter(
      (group, index, allGroups) =>
        allGroups.findIndex((candidate) => candidate.id === group.id) === index,
    );
  const groupIds = new Set(groups.map((group) => group.id));
  const tabs = value.tabs
    .map((tab) => normalizeReaderTab(tab, groupIds))
    .filter((tab): tab is ReaderTab => Boolean(tab));

  if (tabs.length === 0) {
    return null;
  }

  const activeTabId =
    typeof value.activeTabId === "string" &&
    tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0]!.id;

  return {
    activeTabId,
    groups: groups.filter((group) =>
      tabs.some((tab) => tab.groupId === group.id),
    ),
    tabs,
  };
}

function normalizeReaderTab(
  value: unknown,
  groupIds: ReadonlySet<string>,
): ReaderTab | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const file = normalizeLoadedFile(value.file);
  const view = normalizeReaderView(value.view, file);

  return {
    activeHeadingId:
      typeof value.activeHeadingId === "string" ? value.activeHeadingId : null,
    error: typeof value.error === "string" ? value.error : null,
    file,
    groupId:
      typeof value.groupId === "string" && groupIds.has(value.groupId)
        ? value.groupId
        : null,
    id: value.id,
    view,
  };
}

function normalizeReaderTabGroup(value: unknown): ReaderTabGroup | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isReaderTabGroupColor(value.color)
  ) {
    return null;
  }

  const name = value.name.trim().replace(/\s+/g, " ").slice(0, 40);

  if (!name) {
    return null;
  }

  return {
    collapsed: value.collapsed === true,
    color: value.color,
    id: value.id,
    name,
  };
}

function normalizeLoadedFile(value: unknown): LoadedFile | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.content !== "string" ||
    typeof value.name !== "string" ||
    !isLoadedFileSource(value.source)
  ) {
    return null;
  }

  const size =
    typeof value.size === "number" && Number.isFinite(value.size)
      ? value.size
      : value.originalData instanceof ArrayBuffer
        ? value.originalData.byteLength
        : new Blob([value.content]).size;
  const lastModified =
    typeof value.lastModified === "number" &&
    Number.isFinite(value.lastModified)
      ? value.lastModified
      : Date.now();

  if (value.kind === "pdf") {
    if (
      value.source !== "file" ||
      !(value.originalData instanceof ArrayBuffer) ||
      typeof value.pageCount !== "number" ||
      !Number.isInteger(value.pageCount) ||
      value.pageCount < 1
    ) {
      return null;
    }

    return {
      content: value.content,
      kind: "pdf",
      lastModified,
      name: value.name,
      originalData: value.originalData,
      pageCount: value.pageCount,
      size,
      source: "file",
    };
  }

  if (value.kind === "screenplay") {
    return {
      content: value.content,
      kind: "screenplay",
      lastModified,
      name: value.name,
      size,
      source: "file",
    };
  }

  return {
    content: value.content,
    kind: "markdown",
    lastModified,
    name: value.name,
    size,
    source: value.source,
  };
}

function normalizeReaderView(value: unknown, file: LoadedFile | null): ReaderView {
  if (!file) {
    return "preview";
  }

  if (file.kind === "pdf") {
    return value === "original" ? "original" : "preview";
  }

  return value === "source" ? "source" : "preview";
}

function isLoadedFileSource(value: unknown): value is LoadedFile["source"] {
  return value === "file" || value === "paste";
}

function isReaderTabGroupColor(
  value: unknown,
): value is ReaderTabGroupColor {
  return (
    value === "blue" ||
    value === "cyan" ||
    value === "green" ||
    value === "orange" ||
    value === "pink" ||
    value === "purple"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
