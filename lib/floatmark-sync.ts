// lib/floatmark-sync.ts
// 把 floatmark-github-client（远端）和 floatmark-storage（本机缓存）串起来的同步层。
//
// 原则：聊天时的 Prompt 组装只读本机缓存，绝不在那条热路径上等网络。
// 真正触发"去 GitHub 拉一次"的时机只有：写入新记忆之后、App 冷启动时、或用户手动同步。

import type { FloatmarkIndex, FloatmarkIndexEntry, FloatmarkMemory, FloatmarkRepoConfig } from "./floatmark-types";
import { readFile, putFile } from "./floatmark-github-client";
import { replaceMemoryIndex, loadMemoryIndex, saveMemoryBody, loadMemoryBody } from "./floatmark-storage";

const INDEX_PATH = "index.json";

function memoryPath(id: string): string {
    return `memories/${id}.json`;
}

export type SyncResult = {
    ok: boolean;
    error?: string;
    pulledCount?: number;
};

/**
 * 从仓库拉取最新 index.json，与本机缓存的 updatedAt 比对；仓库更新时才整批覆盖本机索引缓存。
 * 仓库里还没有 index.json（全新角色、尚未迁移过）时，返回 ok:true、pulledCount:0，不报错。
 */
export async function pullIndexIfNewer(config: FloatmarkRepoConfig, localUpdatedAt: number): Promise<SyncResult> {
    const result = await readFile(config, INDEX_PATH);
    if (!result.ok) {
        if (result.status === 404) return { ok: true, pulledCount: 0 };
        return { ok: false, error: result.error };
    }
    try {
        const remoteIndex: FloatmarkIndex = JSON.parse(result.content || "{}");
        if (!remoteIndex.updatedAt || remoteIndex.updatedAt <= localUpdatedAt) {
            return { ok: true, pulledCount: 0 };
        }
        await replaceMemoryIndex(config.characterId, remoteIndex.memories || []);
        return { ok: true, pulledCount: remoteIndex.memories?.length || 0 };
    } catch (e) {
        return { ok: false, error: "index.json 解析失败: " + (e instanceof Error ? e.message : String(e)) };
    }
}

/** 按需拉取单条记忆正文：先查本机缓存，没有才去仓库取并顺手缓存下来。 */
export async function getMemoryBody(config: FloatmarkRepoConfig, id: string): Promise<FloatmarkMemory | null> {
    const cached = await loadMemoryBody(id);
    if (cached) return cached;

    const result = await readFile(config, memoryPath(id));
    if (!result.ok || !result.content) return null;
    try {
        const memory: FloatmarkMemory = JSON.parse(result.content);
        await saveMemoryBody(config.characterId, memory);
        return memory;
    } catch {
        return null;
    }
}

/**
 * 写入一条新记忆：先写 memories/{id}.json 正文，再把 index.json 整体更新（本地索引追加这一条后推送）。
 * 两步都成功才算成功；第二步失败时正文已经落在仓库里，下次同步会重新尝试补齐索引
 * （调用方应在失败时提示用户重试，而不是静默丢弃这条记忆）。
 */
export async function pushNewMemory(
    config: FloatmarkRepoConfig,
    entry: FloatmarkIndexEntry,
    memory: FloatmarkMemory,
    commitMessagePrefix: string,
): Promise<SyncResult> {
    const bodyResult = await putFile(
        config,
        memoryPath(memory.id),
        JSON.stringify(memory, null, 2),
        `${commitMessagePrefix} · ${memory.id}`,
    );
    if (!bodyResult.ok) return { ok: false, error: "写入记忆正文失败: " + bodyResult.error };

    const localEntries = await loadMemoryIndex(config.characterId);
    const nextEntries = [...localEntries.filter(e => e.id !== entry.id), entry];
    const nextIndex: FloatmarkIndex = {
        characterId: config.characterId,
        updatedAt: Date.now(),
        memories: nextEntries,
    };
    const indexResult = await putFile(
        config,
        INDEX_PATH,
        JSON.stringify(nextIndex, null, 2),
        `${commitMessagePrefix} · 更新索引`,
    );
    if (!indexResult.ok) return { ok: false, error: "写入索引失败: " + indexResult.error };

    await replaceMemoryIndex(config.characterId, nextEntries);
    await saveMemoryBody(config.characterId, memory);
    return { ok: true, pulledCount: nextEntries.length };
}
