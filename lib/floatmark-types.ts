// lib/floatmark-types.ts
// 浮痕（Afterglow）：基于角色独立 GitHub 仓库的外部长期记忆系统。
// 心智模型：
// - 短期记忆（shortTermMemory）不受影响，仍走宿主原生事件流。
// - 开启浮痕的角色，memoryCore / memoryLongTerm 两个预设坑位的内容来源
//   从本地 memory-service 切换为本模块的仓库缓存数据。
// - GitHub 仓库是权威数据源（source of truth），本机 Dexie 缓存是运行时工作副本，
//   聊天时的 Prompt 组装只读本机缓存，不实时请求网络。

export type FloatmarkTrigger =
    | "spontaneous"   // 角色在一次正常回复中顺带判定为值得记住，触发二次详细生成
    | "emotional"      // 情绪强度达到阈值，强制写入（不要求重要度也达标）
    | "fallback"        // 兜底结算（轮次或时间阈值触发的后台整理）
    | "migrated";      // 开启浮痕时，从原生长期/核心记忆迁移过来的存量数据

// 浮痕不再区分"核心记忆/长期记忆"两种运行时类别——是否常驻在活跃度顶端完全由
// 活跃度分数自然决定（见 floatmark-activation.ts），不存在写入时钉死、之后不变的分类。
// FloatmarkMemoryType 仅作为历史出身标记保留：迁移存量数据时记录它在原生系统里
// 曾经是 core 还是 long_term，可用于给迁移时的初始 importance 一个参考，
// 不参与任何运行时的衰减/排序逻辑。
export type FloatmarkMemoryType = "core" | "long_term";

/**
 * index.json 里每条记忆的轻量元数据。
 * 只放算法和 3D 视图需要的字段，不放完整正文/向量，保证索引文件小、加载快。
 */
export type FloatmarkIndexEntry = {
    id: string;                    // 对应 memories/{id}.json
    createdAt: number;             // 首次写入时间（ms epoch）
    type: FloatmarkMemoryType;
    importance: number;            // 0-10，写入时打的初始重要度
    emotionIntensity: number;      // 0-10，情绪烈度（杏仁核权重）
    emotionLock: boolean;          // true 时衰减速度按极长半衰期处理，不受一般衰减公式影响
    accessCount: number;           // 被唤醒/命中的次数，用于频率强化
    lastRecalledAt: number;        // 最近一次被唤醒的时间（ms epoch），初始等于 createdAt
    tags: string[];                // 用于关键词唤醒命中 + 3D 视图里的同标签连线
    relatedTo: string[];           // 显式关联的其它记忆 id，用于 3D 视图连线
    trigger: FloatmarkTrigger;
    summary: string;               // 一句话摘要，列表/3D 视图悬浮展示用，不需要拉完整文件
};

/**
 * memories/{id}.json 单条记忆的完整内容。
 */
export type FloatmarkMemory = {
    id: string;
    createdAt: number;
    type: FloatmarkMemoryType;
    content: string;               // 发生了什么（海马体式的事件记录）
    reflection: string;             // 角色对这件事的主观认知/心境（可为空，迁移数据常为空）
    trigger: FloatmarkTrigger;
    sourceEvent?: string;           // 可选：来源场景，如 "chat" / "moments" / "offline"
    embedding?: number[];           // 可选：语义向量，按需加载，不进 index.json
};

/**
 * index.json 整体结构。
 */
export type FloatmarkIndex = {
    characterId: string;
    updatedAt: number;             // 仓库侧最后一次更新时间，用于和本机缓存比对版本
    memories: FloatmarkIndexEntry[];
};

/**
 * 单个角色的浮痕仓库连接配置。
 * token 只读写、不展示明文、不提供复制；会随整体数据备份一起导出（见产品侧说明）。
 */
export type FloatmarkRepoConfig = {
    characterId: string;
    owner: string;
    repo: string;
    branch: string;                // 默认 "main"
    token: string;
    enabled: boolean;              // 是否已对该角色启用浮痕接管
    migratedAt?: number;            // 存量迁移完成的时间；未迁移过为 undefined
    createdAt: number;
    updatedAt: number;
};

/**
 * 兜底结算配置（按角色），对应产品侧"轮次结算 / 时间结算"两个独立开关。
 */
export type FloatmarkFallbackConfig = {
    characterId: string;
    turnEnabled: boolean;
    turnThreshold: number;          // 默认 45
    timeEnabled: boolean;
    timeThresholdMs: number;        // 默认 3 小时 = 3 * 60 * 60 * 1000
    // 计数器状态：触发一次后清零重新计时
    turnsSinceLastSettlement: number;
    lastSettlementAt: number;       // ms epoch
};

export const DEFAULT_FALLBACK_TURN_THRESHOLD = 45;
export const DEFAULT_FALLBACK_TIME_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function createDefaultFallbackConfig(characterId: string, now = Date.now()): FloatmarkFallbackConfig {
    return {
        characterId,
        turnEnabled: true,
        turnThreshold: DEFAULT_FALLBACK_TURN_THRESHOLD,
        timeEnabled: true,
        timeThresholdMs: DEFAULT_FALLBACK_TIME_THRESHOLD_MS,
        turnsSinceLastSettlement: 0,
        lastSettlementAt: now,
    };
}

/**
 * 自主写入的重要度/情绪强度门槛（可在角色配置页调整，这里是默认值）。
 */
export const DEFAULT_IMPORTANCE_THRESHOLD = 7.5;
export const DEFAULT_EMOTION_THRESHOLD = 7.5;

/**
 * 本机缓存里，某个角色浮痕数据的整体快照（供缓存层存取使用）。
 */
export type FloatmarkCacheSnapshot = {
    characterId: string;
    index: FloatmarkIndex;
    memories: Record<string, FloatmarkMemory>; // 按 id 索引，按需填充（不要求全量常驻）
    cachedAt: number;              // 本机缓存最后一次与仓库同步的时间
};
