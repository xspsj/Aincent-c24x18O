// lib/floatmark-activation.ts
// 活跃度算法：决定一条记忆当前"有多容易被想起来"。
//
// 心智模型（和产品侧讨论对齐）：浮痕不区分固定的"核心记忆/长期记忆"类别，
// 只有一条连续的活跃度分数——分数高的记忆自然呈现在球心附近（平时会想到的），
// 分数低的飘向外围（平时不会想到的）。这个状态是动态的、会随时间和唤醒变化，
// 但不存在"写入时钉死分类、之后不变"的东西。
//
// 公式：
//   活跃度 = 基础重要度 × 时间衰减系数 + 唤醒加成
//   基础重要度 = importance + emotionIntensity × 0.3
//   时间衰减系数 = 0.5 ^ (距今天数 / 半衰期天数)
//     - 半衰期：emotionLock=true 时 90 天，否则 14 天
//   唤醒加成 = min(accessCount × 0.3, 3)
//
// "绝不沉底"不是靠硬编码下限实现的：指数衰减永远不会真正归零，只要历史 importance
// 和 accessCount 足够高，分数会自然稳定在比"只被记过一次"的普通记忆高得多的水平。
// 真正趋近于 0 的，是那些从未被重新唤醒过的记忆——这是预期行为，不是 bug。

import type { FloatmarkIndexEntry } from "./floatmark-types";

const NORMAL_HALFLIFE_DAYS = 14;
const EMOTION_LOCK_HALFLIFE_DAYS = 90;
const WAKE_BONUS_PER_ACCESS = 0.3;
const WAKE_BONUS_CAP = 3;
const EMOTION_WEIGHT_IN_BASE = 0.3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(timestampMs: number, now: number): number {
    return Math.max(0, (now - timestampMs) / MS_PER_DAY);
}

/** 单条记忆当前的活跃度分数。分数没有固定上限，正常范围大致在 0~13 左右。 */
export function computeActivationScore(entry: FloatmarkIndexEntry, now: number = Date.now()): number {
    const baseImportance = entry.importance + entry.emotionIntensity * EMOTION_WEIGHT_IN_BASE;
    const halfLifeDays = entry.emotionLock ? EMOTION_LOCK_HALFLIFE_DAYS : NORMAL_HALFLIFE_DAYS;
    const elapsedDays = daysSince(entry.lastRecalledAt, now);
    const decayFactor = Math.pow(0.5, elapsedDays / halfLifeDays);
    const wakeBonus = Math.min(entry.accessCount * WAKE_BONUS_PER_ACCESS, WAKE_BONUS_CAP);
    return baseImportance * decayFactor + wakeBonus;
}

export type RankedMemory = {
    entry: FloatmarkIndexEntry;
    score: number;
};

/** 按活跃度从高到低排序，供注入预设坑位（取前 N 条）和 3D 视图（离中心距离）共用。 */
export function rankByActivation(entries: FloatmarkIndexEntry[], now: number = Date.now()): RankedMemory[] {
    return entries
        .map(entry => ({ entry, score: computeActivationScore(entry, now) }))
        .sort((a, b) => b.score - a.score);
}

/**
 * 记忆被唤醒命中时调用：accessCount+1、lastRecalledAt 刷新为当前时间。
 * 返回更新后的副本，调用方负责落盘（upsertMemoryIndexEntry + 推送仓库）。
 */
export function applyRecall(entry: FloatmarkIndexEntry, now: number = Date.now()): FloatmarkIndexEntry {
    return {
        ...entry,
        accessCount: entry.accessCount + 1,
        lastRecalledAt: now,
    };
}
