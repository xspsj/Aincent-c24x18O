import { jsonrepair } from "jsonrepair";
import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { previewMessagesForApi, sendLLMRequest, ChatEngineError } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadBindingConfig, loadApiConfigs, loadPresets, loadWorldBooks, loadRegexes, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { prepareShortTermContext } from "./short-term-assembler";
import { loadLetters, isLetterMailConfigured, createLetter } from "./letter-storage";
import type { Letter, LetterDeliveryMode, LetterTrigger } from "./letter-types";

// ── 角色写信 AI 引擎 ──
//
// 1. 写信动机与意愿判断：
//    结合人设、近期羁绊/聊天记忆与情绪状态，角色自己决定「想不想写信」；
//    若觉得此刻没有足够的话要说或情绪未到，输出 { shouldWrite: false }，系统不强行催产。
//
// 2. 避免重复与保持叙事连贯：
//    向模型注入该角色此前写过的最近几封信的标题与摘要，避免千篇一律，还能承接前情。
//
// 3. 立即送达 vs 定时送达：
//    由角色根据信件题材自拟 deliveryMode。若是定时送达，自拟未来多少小时后启封（unlockAfterHours）。

export type LetterGenerationResult =
  | { shouldWrite: false; reason?: string }
  | {
      shouldWrite: true;
      title: string;
      body: string;
      signature?: string;
      deliveryMode: LetterDeliveryMode;
      unlockAt?: string;
      letter: Letter;
    };

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanMultilineText(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength)
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function parseJsonLike(content: string): unknown | null {
  const jsonCandidate = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(jsonCandidate));
    } catch {
      return null;
    }
  }
}

function formatPastLettersContext(letters: Letter[]): string {
  const recent = [...letters]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  if (recent.length === 0) return "你此前尚未给对方写过信，这是第一封。";

  return recent.map((item, index) => {
    const snippet = cleanMultilineText(item.body, 140);
    return `[历史信件 #${index + 1}] 标题：《${item.title}》，日期：${item.createdAt.slice(0, 10)}，正文摘要：“${snippet}”`;
  }).join("\n");
}

type ResolvedLetterGeneration = {
  character: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  messages: LLMMessage[];
  userName: string;
};

async function resolveLetterGeneration(
  characterId: string,
  trigger: LetterTrigger,
): Promise<ResolvedLetterGeneration> {
  const character = loadCharacters().find(entry => entry.id === characterId);
  if (!character) throw new ChatEngineError("找不到要写信的角色。");

  const bindings = loadBindingConfig();
  // 绑定槽位回退：优先取专门的「信件」或「手记」绑定，缺失时继承全局聊天
  const slot = resolveBinding(bindings, character.id, "diary");
  if (!slot.apiConfigId) {
    throw new ChatEngineError(`未给「手记」或「信件」绑定 ${character.name} 的 API 配置。`);
  }

  const apiConfig = loadApiConfigs().find(entry => entry.id === slot.apiConfigId);
  if (!apiConfig) throw new ChatEngineError(`找不到 ${character.name} 的 API 配置。`);

  const presets = loadPresets();
  let preset = slot.presetId ? presets.find(entry => entry.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find(entry => entry.builtIn) ?? null;

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (slot.worldBookIds || [])
    .map(id => allWorldBooks.find(entry => entry.id === id))
    .filter(Boolean) as WorldBookConfig[];

  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || [])
    .map(id => allRegexes.find(entry => entry.id === id))
    .filter(Boolean) as RegexConfig[];

  const userIdentity = resolveUserIdentity(character.id, "diary");
  const userName = userIdentity?.name ?? "你";
  const memConfig = loadMemoryConfig();
  const prepared = prepareShortTermContext(character.id, "diary", { history: [] });

  const [memories, coreMemories] = await Promise.all([
    retrieveMemoriesForPrompt(character.id, prepared.wbActivationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);

  const pastLetters = loadLetters(character.id);
  const pastLettersText = formatPastLettersContext(pastLetters);

  const writeSystemInstruction = `【重要任务：书信创作】
你正在以角色「${character.name}」的真实口吻，决定是否给「${userName}」写一封信。

这不同于即时聊天，而是一封会落入对方实体信箱（现实 QQ 邮箱与手机信箱抽屉）的真挚信件。
请综合考量：你们近期的经历、你当前的心境与羁绊。

【写信意愿判断】
- 若当前没有明确的情感触发点、觉得日常对话已经足够、或角色性格此时不适宜提笔，可选择不写；
- 若触发方式是用户强制或节奏巡检（当前触发方式: ${trigger}），但在角色眼里时机完全不妥，同样可以不写；
- 只有当你确有心绪、誓言、思念、倾诉、分享或特殊的问候想凝固在纸上时，才选择写。

【既往信件承接】
以下是你此前给对方写过的信件摘要，请避免陈词滥调与无意义的重复，可自然呼应前文：
${pastLettersText}

【投递模式决策】
- "immediate"（立即送达）：此刻写就即可让对方读到；
- "scheduled"（定时送达）：例如约定在深夜、清晨或特定小时后（unlockAfterHours 必须为正整数，如 2、8、24 等）才能拆开封漆。

请严格仅输出如下 JSON 格式，绝不要包含 Markdown 代码块标记（\`\`\`json）以外的多余闲聊：
{
  "shouldWrite": true 或 false,
  "reason": "不写时的简述",
  "title": "信件标题（8-20字，文雅或具角色特色）",
  "body": "信纸正文（完整书信体，保留换行，300-1200字，倾注真实情感与具体的细节）",
  "signature": "落款（如：想你的 某某 / 你的 某某）",
  "deliveryMode": "immediate" 或 "scheduled",
  "unlockAfterHours": 定时送达时自拟的小时数（如 8、12、24），立即送达时填 0
}`;

  const messages = assemblePromptPayload({
    character,
    history: [],
    preset,
    worldBooks,
    regexes,
    userIdentity,
    appId: "diary",
    appTags: ["diary", "letters"],
    longTermMemories: formatLongTermMemories(memories),
    coreMemories: formatCoreMemories(coreMemories),
    worldBookActivationContext: prepared.wbActivationContext,
    recentBlocks: prepared.recentBlocks,
    unifiedRecentItems: prepared.unifiedRecentItems,
  });

  // 在组装好的上下文末尾追加本次写信指导
  messages.push({
    role: "user",
    content: writeSystemInstruction,
  });

  return { character, apiConfig, preset, regexes, messages, userName };
}

/** 触发一次角色写信（支持自主想写、定时巡检与手动让TA写）。 */
export async function generateLetterForCharacter(
  characterId: string,
  trigger: LetterTrigger = "self",
  forceWrite = false,
): Promise<LetterGenerationResult> {
  const resolved = await resolveLetterGeneration(characterId, trigger);

  // 若为手动「让TA写」，修改提示让其尽量提笔创作
  if (forceWrite && resolved.messages.length > 0) {
    const last = resolved.messages[resolved.messages.length - 1];
    if (typeof last.content === "string") {
      last.content += "\n\n【注意】对方此刻非常期待你的来信，请务必提笔创作，将 shouldWrite 设为 true。";
    }
  }

  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    resolved.messages,
    resolved.regexes,
    { characterName: `信件:${resolved.character.name}`, userName: resolved.userName },
    { appId: "diary", appTags: ["diary", "letters"] },
  );

  const parsed = parseJsonLike(raw) as Record<string, unknown> | null;
  if (!parsed || parsed.shouldWrite === false) {
    return {
      shouldWrite: false,
      reason: cleanText(parsed?.reason, 200) || "角色当前觉得时机未到，暂未提笔。",
    };
  }

  const title = cleanText(parsed.title, 80) || "见字如面";
  const body = cleanMultilineText(parsed.body, 8000);
  if (!body) {
    return { shouldWrite: false, reason: "信件生成内容为空。" };
  }

  const signature = cleanText(parsed.signature, 80) || resolved.character.name;
  const isScheduled = parsed.deliveryMode === "scheduled";
  const unlockHours = Math.max(1, Math.min(168, Number(parsed.unlockAfterHours) || 8));
  const unlockAt = isScheduled ? new Date(Date.now() + unlockHours * 3600_000).toISOString() : undefined;

  const letter = createLetter(
    {
      characterId: resolved.character.id,
      characterName: resolved.character.name,
      title,
      body,
      signature,
      deliveryMode: isScheduled ? "scheduled" : "immediate",
      unlockAt,
      trigger,
    },
    {
      mailConfigured: isLetterMailConfigured(),
      userName: resolved.userName,
    },
  );

  return {
    shouldWrite: true,
    title,
    body,
    signature,
    deliveryMode: letter.deliveryMode,
    unlockAt: letter.unlockAt,
    letter,
  };
}
