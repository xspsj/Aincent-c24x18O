// lib/floatmark-fallback-settlement.ts
// 兜底结算触发后真正要做的事：取这段时间的短期记忆事件流，喂给核心生成函数，
// 判断是否值得记住；值得就推送到仓库，不值得也算正常完成（平淡的时间段不强求
// 一定要生成）。两种情况下计数器都要清零重新计时——"已经检查过一次"这件事
// 本身，和"是否真的产生了新记忆"是两件独立的事。

import type { Character } from "./character-types";
import type { FloatmarkRepoConfig, FloatmarkFallbackConfig, FloatmarkIndexEntry, FloatmarkMemory } from "./floatmark-types";
import { loadNativeTimeline, filterTimelineByAllowedSources, formatTimelineForSummarization } from "./short-term-assembler";
import { loadMemoryConfig } from "./memory-storage";
import { generateFloatmarkMemory } from "./floatmark-generator";
import { pushNewMemory } from "./floatmark-sync";
import { loadMemoryIndex } from "./floatmark-storage";
import { resetFallbackCounters } from "./floatmark-fallback";
import { saveFloatmarkFallbackConfig } from "./floatmark-config-storage";

export type SettlementResult = {
    ok: boolean;
    error?: string;
    recorded: boolean;      // 这次结算是否真的产生了一条新记忆
    reason?: string;        // 没记录时的说明（事件太少 / 模型判断不值得记）
};

const MIN_EVENTS_TO_CONSIDER = 2;

function generateMemoryId(): string {
    return "mem_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/**
 * 执行一次兜底结算。无论是否真的产生新记忆，成功执行完都会清零 fallbackConfig 的计数器
 * （失败时不清零，保留现场方便重试）。
 */
export async function runFallbackSettlement(
    character: Character,
    repoConfig: FloatmarkRepoConfig,
    fallbackConfig: FloatmarkFallbackConfig,
): Promise<SettlementResult> {
    const memoryConfig = loadMemoryConfig();
    const timeline = filterTimelineByAllowedSources(
        loadNativeTimeline(character.id, { afterTimestamp: new Date(fallbackConfig.lastSettlementAt).toISOString() }),
        memoryConfig.shortTermAllowedSources,
    );

    if (timeline.length < MIN_EVENTS_TO_CONSIDER) {
        // 这段时间确实很平淡，没什么可结算的——不是失败，是正常情况。
        // 仍然清零计数器：不然下次又会立刻因为时间/轮次阈值被判定该触发，陷入空转。
        saveFloatmarkFallbackConfig(resetFallbackCounters(fallbackConfig));
        return { ok: true, recorded: false, reason: "这段时间事件太少，判定无需结算" };
    }

    const formatted = formatTimelineForSummarization(timeline);
    if (!formatted) {
        saveFloatmarkFallbackConfig(resetFallbackCounters(fallbackConfig));
        return { ok: true, recorded: false, reason: "事件格式化为空，判定无需结算" };
    }

    const allEntries = await loadMemoryIndex(character.id);
    const genResult = await generateFloatmarkMemory({
        character,
        newContent: formatted.eventsText,
        allEntries,
    });

    if (!genResult.ok) {
        // 生成本身失败（API 没配好、网络问题等）——不清零计数器，下次检查时会重试。
        return { ok: false, error: genResult.error, recorded: false };
    }

    if (!genResult.memory.shouldRecord) {
        saveFloatmarkFallbackConfig(resetFallbackCounters(fallbackConfig));
        return { ok: true, recorded: false, reason: "模型判断这段时间没有值得记住的事" };
    }

    const now = Date.now();
    const id = generateMemoryId();
    const indexEntry: FloatmarkIndexEntry = {
        id,
        createdAt: now,
        type: "long_term",
        importance: genResult.memory.importance ?? 0,
        emotionIntensity: genResult.memory.emotionIntensity ?? 0,
        emotionLock: (genResult.memory.emotionIntensity ?? 0) >= 7.5,
        accessCount: 0,
        lastRecalledAt: now,
        tags: genResult.memory.tags ?? [],
        relatedTo: genResult.memory.relatedMemoryIds ?? [],
        trigger: "fallback",
        summary: (genResult.memory.content ?? "").slice(0, 40) + ((genResult.memory.content ?? "").length > 40 ? "…" : ""),
    };
    const memory: FloatmarkMemory = {
        id,
        createdAt: now,
        type: "long_term",
        content: genResult.memory.content ?? "",
        reflection: genResult.memory.reflection ?? "",
        trigger: "fallback",
        sourceEvent: "fallback_settlement",
    };

    const pushResult = await pushNewMemory(repoConfig, indexEntry, memory, "浮痕兜底结算");
    if (!pushResult.ok) {
        // 推送失败同样不清零——这条记忆还没真正落地，下次重试时事件流会重新拉一遍
        // （afterTimestamp 还是旧的 lastSettlementAt，不会漏掉这段内容）。
        return { ok: false, error: pushResult.error, recorded: false };
    }

    saveFloatmarkFallbackConfig(resetFallbackCounters(fallbackConfig, now));
    return { ok: true, recorded: true };
}
