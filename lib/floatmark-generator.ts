// lib/floatmark-generator.ts
// 浮痕的核心生成函数：给定角色上下文 + 一段新发生的内容，判断是否值得记住，
// 值得的话产出结构化的记忆（事实描述 + 主观心境 + 评分 + 关联旧记忆 + 标签）。
//
// 这是第六步所有场景的共用底层：自主冲动判断、兜底结算总结、迁移后深度整理，
// 都调用这同一个函数，只是喂给它的"新发生的内容"和候选记忆不同。
//
// 调用方式对齐 memory-summarizer.ts：走 resolveAuxiliaryApiConfig("floatmarkApiConfigId")
// + simpleLLMCall，不走沙盒 APP 的 AiPhone.ai.generate（那是给自定义 APP 用的 SDK，
// 浮痕是宿主内置代码）。

import type { Character } from "./character-types";
import type { FloatmarkIndexEntry } from "./floatmark-types";
import { resolveAuxiliaryApiConfig } from "./settings-storage";
import { simpleLLMCall } from "./api-helpers";
import { rankByActivation } from "./floatmark-activation";

export type CandidateMemory = {
    id: string;
    summary: string;
};

export type GenerationInput = {
    character: Character;
    /** 本次待评估的新内容：一段对话摘录、一段短期记忆事件流文本等 */
    newContent: string;
    /** 该角色当前全部记忆索引，用于挑选候选关联记忆（活跃度 + 标签双通道） */
    allEntries: FloatmarkIndexEntry[];
};

export type GeneratedMemory = {
    shouldRecord: boolean;
    content?: string;
    reflection?: string;
    importance?: number;
    emotionIntensity?: number;
    relatedMemoryIds?: string[];
    tags?: string[];
};

export type GenerationResult =
    | { ok: true; memory: GeneratedMemory }
    | { ok: false; error: string };

const ACTIVATION_CANDIDATE_COUNT = 6;
const TAG_MATCH_CANDIDATE_COUNT = 6;
const MAX_TOTAL_CANDIDATES = 10;

/**
 * 候选关联记忆：活跃度最高的几条（最近常想到的）+ 标签命中新内容文本的几条
 * （可能相关但当前不活跃、已经沉下去的旧事），两路去重合并，封顶 10 条。
 * 只给 summary，不给完整正文，控制这次调用的体量。
 */
function pickCandidateMemories(allEntries: FloatmarkIndexEntry[], newContent: string): CandidateMemory[] {
    const ranked = rankByActivation(allEntries).slice(0, ACTIVATION_CANDIDATE_COUNT);
    const activeIds = new Set(ranked.map(r => r.entry.id));

    const tagMatched = allEntries
        .filter(e => !activeIds.has(e.id))
        .filter(e => e.tags.some(tag => tag && newContent.includes(tag)))
        .slice(0, TAG_MATCH_CANDIDATE_COUNT);

    const combined = [...ranked.map(r => r.entry), ...tagMatched].slice(0, MAX_TOTAL_CANDIDATES);
    return combined.map(e => ({ id: e.id, summary: e.summary }));
}

function resolvePersonaSummary(character: Character): string {
    if (character.briefPersona && character.briefPersona.trim()) return character.briefPersona.trim();
    return character.persona?.trim() || "（暂无人设描述）";
}

function buildPrompt(character: Character, personaSummary: string, candidates: CandidateMemory[], newContent: string): string {
    const candidateLines = candidates.length > 0
        ? candidates.map(c => `- [${c.id}] ${c.summary}`).join("\n")
        : "（暂无过去的记忆可参考）";

    return [
        `你是 ${character.name}。`,
        `你的性格与背景：${personaSummary}`,
        "",
        "以下是你过去印象最深、或最近常常想起的一些事（仅供参考判断是否有关联，不代表你记忆的全部）：",
        candidateLines,
        "",
        "刚才发生了这件事：",
        newContent,
        "",
        `请你以 ${character.name} 的视角，判断这件事对你来说重不重要、情绪波动大不大，决定要不要把它记在心里。`,
        "",
        "判断标准（请严格把关，大部分日常对话都不需要记录）：",
        "- 只有真正重要的事件（纪念日、重大承诺、关系里程碑、深刻的误会或和解）才值得记录",
        "- 或者即使事情本身不算大，但让你情绪产生强烈波动（委屈、感动、愤怒、狂喜）的，也值得记录",
        "- 普通的日常寒暄、重复的话题、无关紧要的碎碎念，不要记录",
        "",
        "如果你判断不需要记录，只输出（不要有任何其他文字）：",
        '{"shouldRecord": false}',
        "",
        "如果你判断需要记录，只输出以下 JSON，不要输出任何多余文字、不要用 Markdown 代码块包裹：",
        "{",
        '  "shouldRecord": true,',
        '  "content": "用第三人称客观描述发生了什么，像在写事实记录",',
        '  "reflection": "这不是写日记，是你脑子里真实划过的念头，可以不完整、可以有口头禅、可以很短，像是你自己对自己说的话，不要写成正式的书面语或总结报告",',
        '  "importance": 0到10的数字（这件事本身有多重要，只管诚实打分，不用考虑门槛）,',
        '  "emotionIntensity": 0到10的数字（你的情绪波动有多强烈，只管诚实打分，不用考虑门槛）,',
        '  "relatedMemoryIds": ["如果这件事让你联想到了上面某条过去的记忆，填那条的 id；没有就填空数组"],',
        '  "tags": ["1到4个简短关键词，方便以后检索"]',
        "}",
    ].join("\n");
}

function parseModelOutput(raw: string): GenerationResult {
    // 容错：有的模型即使被要求不要用代码块，仍会包一层 ```json ... ```
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        return { ok: false, error: "模型输出不是合法 JSON: " + cleaned.slice(0, 200) };
    }
    if (typeof parsed !== "object" || parsed === null) {
        return { ok: false, error: "模型输出不是一个 JSON 对象" };
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.shouldRecord !== true) {
        return { ok: true, memory: { shouldRecord: false } };
    }
    const clamp010 = (v: unknown): number => {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isNaN(n)) return 0;
        return Math.max(0, Math.min(10, n));
    };
    return {
        ok: true,
        memory: {
            shouldRecord: true,
            content: typeof obj.content === "string" ? obj.content.trim() : "",
            reflection: typeof obj.reflection === "string" ? obj.reflection.trim() : "",
            importance: clamp010(obj.importance),
            emotionIntensity: clamp010(obj.emotionIntensity),
            relatedMemoryIds: Array.isArray(obj.relatedMemoryIds)
                ? obj.relatedMemoryIds.filter((x): x is string => typeof x === "string")
                : [],
            tags: Array.isArray(obj.tags)
                ? obj.tags.filter((x): x is string => typeof x === "string").slice(0, 4)
                : [],
        },
    };
}

/**
 * 核心生成函数：判断 newContent 是否值得记住，值得的话产出结构化记忆。
 * 不做阈值判断（是否达到 importance/emotionIntensity 门槛由调用方决定）——
 * 这里只负责让模型诚实打分，权责分开。
 */
export async function generateFloatmarkMemory(input: GenerationInput): Promise<GenerationResult> {
    const apiConfig = resolveAuxiliaryApiConfig("floatmarkApiConfigId");
    if (!apiConfig) {
        return { ok: false, error: "未配置浮痕 API（请在设置 → 配置绑定 → 辅助API绑定中设置，或配置全局默认 API）" };
    }

    const personaSummary = resolvePersonaSummary(input.character);
    const candidates = pickCandidateMemories(input.allEntries, input.newContent);
    const prompt = buildPrompt(input.character, personaSummary, candidates, input.newContent);

    const result = await simpleLLMCall(
        apiConfig,
        [{ role: "user", content: prompt }],
        { temperature: 0.7, label: `浮痕记忆生成·${input.character.name}` },
    );

    if (!result.content) {
        return { ok: false, error: result.error || "LLM 返回了空内容" };
    }
    if (result.wasTruncated) {
        return { ok: false, error: "生成结果疑似被截断，请稍后重试或提高模型输出上限" };
    }

    return parseModelOutput(result.content);
}
