// lib/floatmark-migration.ts
// 开启浮痕时的存量记忆迁移：把角色原生的 core / long_term 记忆（memory-storage.ts）
// 搬进浮痕的仓库 + 本机缓存，避免"开启浮痕 = 角色瞬间失忆"。
//
// 原则：
// - 原生数据只读不删（迁移不等于清空），即使迁移中途失败，原生记忆依然完好，
//   用户随时可以放弃浮痕、退回原生记忆。
// - 迁移产生的记忆 trigger 统一标为 "migrated"，和真正在浮痕里新长出来的记忆
//   区分开，方便以后在 3D 视图/列表里分辨"搬家搬过来的旧记忆"。
// - 这一步只负责"搬数据"，不负责切换预设坑位的数据来源、不关闭原生自动总结开关
//   ——那是接入预设坑位那一步的职责，两件事分开做、分开测。

import type { MemoryEntry } from "./memory-types";
import { loadMemoryEntriesByType } from "./memory-storage";
import type { FloatmarkIndexEntry, FloatmarkMemory, FloatmarkRepoConfig, FloatmarkIndex } from "./floatmark-types";
import { putFile } from "./floatmark-github-client";
import { replaceMemoryIndex, saveMemoryBody, loadMemoryIndex } from "./floatmark-storage";

/** 原生 importance 是 0-1 浮点，浮痕是 0-10，做一次线性换算并保留一位小数。 */
function scaleImportance(nativeImportance: number): number {
    const scaled = Math.round(nativeImportance * 10 * 10) / 10;
    return Math.min(10, Math.max(0, scaled));
}

function toEpochMs(createdAt: string): number {
    const parsed = Date.parse(createdAt);
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function convertEntry(entry: MemoryEntry): { indexEntry: FloatmarkIndexEntry; memory: FloatmarkMemory } {
    const createdAtMs = toEpochMs(entry.createdAt);
    const importance = scaleImportance(entry.importance);
    const summary = entry.content.length > 40 ? entry.content.slice(0, 40) + "…" : entry.content;

    const indexEntry: FloatmarkIndexEntry = {
        id: entry.id,
        createdAt: createdAtMs,
        type: entry.type,
        importance,
        emotionIntensity: 0,          // 迁移数据没有情绪烈度记录，默认 0，不触发情绪锁
        emotionLock: false,
        accessCount: 0,
        lastRecalledAt: createdAtMs,
        tags: [],
        relatedTo: [],
        trigger: "migrated",
        summary,
    };

    const memory: FloatmarkMemory = {
        id: entry.id,
        createdAt: createdAtMs,
        type: entry.type,
        content: entry.content,
        reflection: "（迁移前的记忆，没有留下当时的心境）",
        trigger: "migrated",
        sourceEvent: "migrated_from_native",
    };

    return { indexEntry, memory };
}

export type MigrationPreview = {
    coreCount: number;
    longTermCount: number;
    totalCount: number;
};

/** 迁移前先预览一下有多少条，供确认环节展示给用户（不做任何写入）。 */
export async function previewMigration(characterId: string): Promise<MigrationPreview> {
    const [core, longTerm] = await Promise.all([
        loadMemoryEntriesByType(characterId, "core"),
        loadMemoryEntriesByType(characterId, "long_term"),
    ]);
    return {
        coreCount: core.length,
        longTermCount: longTerm.length,
        totalCount: core.length + longTerm.length,
    };
}

export type MigrationResult = {
    ok: boolean;
    error?: string;
    migratedCount?: number;
};

/**
 * 执行迁移：读出该角色全部原生 core/long_term 记忆，转换格式，
 * 逐条写入仓库 memories/{id}.json，再整体更新 index.json，最后同步本机缓存。
 *
 * 原生记忆不会被删除。调用方应在迁移成功后再决定是否正式切换该角色的数据来源
 * （这一步不做那个切换）。
 */
export async function migrateNativeMemoriesToFloatmark(
    config: FloatmarkRepoConfig,
    onProgress?: (done: number, total: number) => void,
): Promise<MigrationResult> {
    const [coreEntries, longTermEntries] = await Promise.all([
        loadMemoryEntriesByType(config.characterId, "core"),
        loadMemoryEntriesByType(config.characterId, "long_term"),
    ]);
    const nativeEntries = [...coreEntries, ...longTermEntries];

    if (nativeEntries.length === 0) {
        // 没有存量数据也算成功：新角色开启浮痕本来就该是空仓库起步。
        return { ok: true, migratedCount: 0 };
    }

    const converted = nativeEntries.map(convertEntry);
    const total = converted.length;
    let done = 0;

    // 已有的（可能是之前测试推送过的）索引也保留，迁移是"追加"不是"覆盖"。
    const existingEntries = await loadMemoryIndex(config.characterId);
    const existingIds = new Set(existingEntries.map(e => e.id));

    for (const { memory } of converted) {
        if (existingIds.has(memory.id)) {
            done += 1;
            onProgress?.(done, total);
            continue; // 已经迁移过这一条，跳过，避免重复 commit
        }
        const result = await putFile(
            config,
            `memories/${memory.id}.json`,
            JSON.stringify(memory, null, 2),
            `浮痕迁移存量记忆 · ${memory.id}`,
        );
        if (!result.ok) {
            return {
                ok: false,
                error: `迁移中断（已完成 ${done}/${total} 条）：写入 ${memory.id} 失败: ${result.error}`,
                migratedCount: done,
            };
        }
        await saveMemoryBody(config.characterId, memory);
        done += 1;
        onProgress?.(done, total);
    }

    const nextEntries = [
        ...existingEntries,
        ...converted.filter(c => !existingIds.has(c.indexEntry.id)).map(c => c.indexEntry),
    ];
    const nextIndex: FloatmarkIndex = {
        characterId: config.characterId,
        updatedAt: Date.now(),
        memories: nextEntries,
    };
    const indexResult = await putFile(
        config,
        "index.json",
        JSON.stringify(nextIndex, null, 2),
        `浮痕迁移存量记忆 · 更新索引（共 ${nextEntries.length} 条）`,
    );
    if (!indexResult.ok) {
        return {
            ok: false,
            error: `记忆正文已全部写入仓库，但更新索引失败: ${indexResult.error}（下次重新迁移会补齐索引）`,
            migratedCount: done,
        };
    }

    await replaceMemoryIndex(config.characterId, nextEntries);
    return { ok: true, migratedCount: done };
}
