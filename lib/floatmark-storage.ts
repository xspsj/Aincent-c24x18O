// lib/floatmark-storage.ts
// 浮痕记忆数据的本机 IndexedDB 缓存（原生 indexedDB，经 openIndexedDbAtLeast 打开，
// 写法对齐 memory-storage.ts）。
//
// 这是运行时工作副本，不是权威数据源——角色的 GitHub 仓库才是权威数据源。
// Prompt 组装时读这里（走 IDB，但没有网络往返），保证离线/弱网下聊天仍然可用，
// 也避免每轮对话都打 GitHub API 配额。

import { openIndexedDbAtLeast } from "./idb-open";
import type { FloatmarkIndexEntry, FloatmarkMemory } from "./floatmark-types";

const DB_NAME = "ai_phone_floatmark_db_v1";
const DB_VERSION = 1;
const INDEX_STORE = "memory_index";   // 镜像 index.json，一条记忆一行
const BODY_STORE = "memory_body";      // 按需缓存的完整正文（memories/{id}.json）

function hasBrowserApi(): boolean {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function ensureStores(db: IDBDatabase, tx: IDBTransaction | null): void {
    let indexStore: IDBObjectStore;
    if (!db.objectStoreNames.contains(INDEX_STORE)) {
        indexStore = db.createObjectStore(INDEX_STORE, { keyPath: "id" });
    } else {
        indexStore = tx!.objectStore(INDEX_STORE);
    }
    if (!indexStore.indexNames.contains("by_character")) {
        indexStore.createIndex("by_character", "characterId", { unique: false });
    }

    let bodyStore: IDBObjectStore;
    if (!db.objectStoreNames.contains(BODY_STORE)) {
        bodyStore = db.createObjectStore(BODY_STORE, { keyPath: "id" });
    } else {
        bodyStore = tx!.objectStore(BODY_STORE);
    }
    if (!bodyStore.indexNames.contains("by_character")) {
        bodyStore.createIndex("by_character", "characterId", { unique: false });
    }
}

async function openDb(): Promise<IDBDatabase | null> {
    if (!hasBrowserApi()) return null;
    return openIndexedDbAtLeast(DB_NAME, DB_VERSION, (db, _oldVersion, tx) => {
        ensureStores(db, tx);
    }).catch(() => null);
}

function runRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// index.json 每条记忆本身没有 characterId 字段（文件已经按角色分仓库），
// 存进本机缓存时附带上，支撑 by_character 索引查询。
type IndexRow = FloatmarkIndexEntry & { characterId: string };
type BodyRow = FloatmarkMemory & { characterId: string };

// ── 索引（index.json 镜像） ──

/** 用仓库拉到的最新 index.json 整批覆盖本机缓存：先清掉该角色旧行，再写入新行。 */
export async function replaceMemoryIndex(characterId: string, entries: FloatmarkIndexEntry[]): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        const tx = db.transaction(INDEX_STORE, "readwrite");
        const store = tx.objectStore(INDEX_STORE);
        const existing: IndexRow[] = await runRequest(store.index("by_character").getAll(characterId));
        for (const row of existing) store.delete(row.id);
        for (const entry of entries) store.put({ ...entry, characterId } as IndexRow);
        await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    } finally {
        db.close();
    }
}

export async function loadMemoryIndex(characterId: string): Promise<FloatmarkIndexEntry[]> {
    const db = await openDb();
    if (!db) return [];
    try {
        const tx = db.transaction(INDEX_STORE, "readonly");
        const rows: IndexRow[] = await runRequest(tx.objectStore(INDEX_STORE).index("by_character").getAll(characterId));
        return rows.map(({ characterId: _omit, ...entry }) => entry);
    } finally {
        db.close();
    }
}

/** 新增/更新单条索引记录（自主写入一条新记忆、或唤醒更新 accessCount 时用，不必整批替换）。 */
export async function upsertMemoryIndexEntry(characterId: string, entry: FloatmarkIndexEntry): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        const tx = db.transaction(INDEX_STORE, "readwrite");
        tx.objectStore(INDEX_STORE).put({ ...entry, characterId } as IndexRow);
        await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    } finally {
        db.close();
    }
}

export async function deleteMemoryIndexEntry(id: string): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        const tx = db.transaction(INDEX_STORE, "readwrite");
        tx.objectStore(INDEX_STORE).delete(id);
        await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    } finally {
        db.close();
    }
}

// ── 正文（按需缓存，不要求全量常驻） ──

export async function saveMemoryBody(characterId: string, memory: FloatmarkMemory): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        const tx = db.transaction(BODY_STORE, "readwrite");
        tx.objectStore(BODY_STORE).put({ ...memory, characterId } as BodyRow);
        await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    } finally {
        db.close();
    }
}

export async function loadMemoryBody(id: string): Promise<FloatmarkMemory | null> {
    const db = await openDb();
    if (!db) return null;
    try {
        const tx = db.transaction(BODY_STORE, "readonly");
        const row: BodyRow | undefined = await runRequest(tx.objectStore(BODY_STORE).get(id));
        if (!row) return null;
        const { characterId: _omit, ...memory } = row;
        return memory;
    } finally {
        db.close();
    }
}

/** 角色关闭浮痕、或需要清理测试数据时，整体清空该角色在本机的缓存（不影响 GitHub 仓库本身）。 */
export async function clearCharacterFloatmarkCache(characterId: string): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        const indexTx = db.transaction(INDEX_STORE, "readwrite");
        const indexStore = indexTx.objectStore(INDEX_STORE);
        const indexRows: IndexRow[] = await runRequest(indexStore.index("by_character").getAll(characterId));
        for (const row of indexRows) indexStore.delete(row.id);
        await new Promise<void>((res, rej) => {
            indexTx.oncomplete = () => res();
            indexTx.onerror = () => rej(indexTx.error);
        });

        const bodyTx = db.transaction(BODY_STORE, "readwrite");
        const bodyStore = bodyTx.objectStore(BODY_STORE);
        const bodyRows: BodyRow[] = await runRequest(bodyStore.index("by_character").getAll(characterId));
        for (const row of bodyRows) bodyStore.delete(row.id);
        await new Promise<void>((res, rej) => {
            bodyTx.oncomplete = () => res();
            bodyTx.onerror = () => rej(bodyTx.error);
        });
    } finally {
        db.close();
    }
}
