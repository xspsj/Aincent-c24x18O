// lib/floatmark-fallback.ts
// 兜底结算的判断逻辑：轮次 / 时间两个独立开关，谁先达到阈值就判定该触发。
//
// 这一步只负责"判断要不要触发、触发后把计数器清零"，不含真正的生成逻辑——
// 触发后调 LLM 产出总结、写入记忆，这部分和自主冲动判断共用同一套
// "角色生成一条新记忆"的核心机制，留给第 6 步统一做。

import type { FloatmarkFallbackConfig } from "./floatmark-types";

export type FallbackCheckResult = {
    shouldTrigger: boolean;
    reason?: "turn" | "time";
};

/** 每轮对话结束后调用：判断是否该触发兜底结算（不改动配置本身，纯判断）。 */
export function checkFallbackTrigger(config: FloatmarkFallbackConfig, now: number = Date.now()): FallbackCheckResult {
    if (config.turnEnabled && config.turnsSinceLastSettlement >= config.turnThreshold) {
        return { shouldTrigger: true, reason: "turn" };
    }
    if (config.timeEnabled && now - config.lastSettlementAt >= config.timeThresholdMs) {
        return { shouldTrigger: true, reason: "time" };
    }
    return { shouldTrigger: false };
}

/** 每发生一轮对话时调用，推进轮次计数（不涉及是否触发判断）。 */
export function incrementTurnCount(config: FloatmarkFallbackConfig): FloatmarkFallbackConfig {
    return { ...config, turnsSinceLastSettlement: config.turnsSinceLastSettlement + 1 };
}

/**
 * 兜底结算真正执行完毕后调用：两个计数器一起清零重新计时，
 * 不区分是哪个原因触发的——触发一次，两边都重新起跑。
 */
export function resetFallbackCounters(config: FloatmarkFallbackConfig, now: number = Date.now()): FloatmarkFallbackConfig {
    return {
        ...config,
        turnsSinceLastSettlement: 0,
        lastSettlementAt: now,
    };
}
