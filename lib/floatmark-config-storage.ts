// lib/floatmark-config-storage.ts
// 按角色存储浮痕的仓库配置与兜底结算配置。
// 体量小、读写频繁，走 kv-db.ts（和 memory-storage.ts 里 MemoryConfig 的存法一致），
// 不占用原生 indexedDB 索引记忆数据的那套存储。

import type { FloatmarkRepoConfig, FloatmarkFallbackConfig } from "./floatmark-types";
import { createDefaultFallbackConfig } from "./floatmark-types";
import { kvGet, kvSet, kvRemove, kvKeysWithPrefix, registerDynamicPrefix } from "./kv-db";

const REPO_CONFIG_PREFIX = "ai_phone_floatmark_repo_";
const FALLBACK_CONFIG_PREFIX = "ai_phone_floatmark_fallback_";
registerDynamicPrefix(REPO_CONFIG_PREFIX);
registerDynamicPrefix(FALLBACK_CONFIG_PREFIX);

function repoKeyFor(characterId: string): string {
    return REPO_CONFIG_PREFIX + characterId;
}
function fallbackKeyFor(characterId: string): string {
    return FALLBACK_CONFIG_PREFIX + characterId;
}

// ── 仓库连接配置（owner/repo/branch/token/enabled） ──

export function loadFloatmarkRepoConfig(characterId: string): FloatmarkRepoConfig | null {
    const raw = kvGet(repoKeyFor(characterId));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as FloatmarkRepoConfig;
    } catch {
        return null;
    }
}

export function saveFloatmarkRepoConfig(config: FloatmarkRepoConfig): void {
    kvSet(repoKeyFor(config.characterId), JSON.stringify(config));
}

export function deleteFloatmarkRepoConfig(characterId: string): void {
    kvRemove(repoKeyFor(characterId));
}

/** 列出所有已经配置过浮痕仓库的角色 id（不区分是否 enabled），用于设置页/选择页。 */
export function listFloatmarkConfiguredCharacterIds(): string[] {
    return kvKeysWithPrefix(REPO_CONFIG_PREFIX).map(k => k.slice(REPO_CONFIG_PREFIX.length));
}

/** 列出所有已启用浮痕接管的角色 id，用于预设坑位路由判断「这个角色要不要换数据源」。 */
export function listFloatmarkEnabledCharacterIds(): string[] {
    return listFloatmarkConfiguredCharacterIds().filter(id => {
        const config = loadFloatmarkRepoConfig(id);
        return !!config?.enabled;
    });
}

// ── 兜底结算配置（轮次/时间阈值 + 计数器状态） ──

export function loadFloatmarkFallbackConfig(characterId: string): FloatmarkFallbackConfig {
    const raw = kvGet(fallbackKeyFor(characterId));
    if (!raw) return createDefaultFallbackConfig(characterId);
    try {
        const parsed = JSON.parse(raw) as Partial<FloatmarkFallbackConfig>;
        return { ...createDefaultFallbackConfig(characterId), ...parsed, characterId };
    } catch {
        return createDefaultFallbackConfig(characterId);
    }
}

export function saveFloatmarkFallbackConfig(config: FloatmarkFallbackConfig): void {
    kvSet(fallbackKeyFor(config.characterId), JSON.stringify(config));
}

export function deleteFloatmarkFallbackConfig(characterId: string): void {
    kvRemove(fallbackKeyFor(characterId));
}
