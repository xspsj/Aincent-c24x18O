import { kvGet, kvKeysWithPrefix, kvSet, registerDynamicPrefix } from "./kv-db";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import type { Letter } from "./letter-types";

// ── 信件投影事件：写进角色的短期记忆时间线 ──
//
// 对应关系：每封信对应一条事件，id = letter_event_<letter.id>。
// 删信时根据 letterId 精确删除这一条，短期记忆里便不再包含这封信。
//
// 待拆封的信（scheduled 且当前时间 < unlockAt）：
//   - 角色自己提笔写的，所以角色知道信的标题和为什么写；
//   - 但用户尚未拆开，事件文本中明确标出「信已封存待启封、用户尚未读到、请勿提前剧透」；
//   - 用户拆开后，文本更新为已读状态。

const LETTER_EVENT_PREFIX = "ai_phone_letter_events_";
const MAX_EVENTS_PER_CHARACTER = 120;

registerDynamicPrefix(LETTER_EVENT_PREFIX);

export type LetterProjectionEntry = {
  id: string;
  letterId: string;
  characterId: string;
  timestamp: string;
  content: string;
};

function storageKey(characterId: string): string {
  return `${LETTER_EVENT_PREFIX}${characterId}`;
}

function cleanEventText(value: string, maxLength: number): string {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function loadLetterProjectionEntries(characterId: string, options?: { afterTimestamp?: string }): LetterProjectionEntry[] {
  if (typeof window === "undefined" || !characterId) return [];
  try {
    const raw = kvGet(storageKey(characterId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is LetterProjectionEntry =>
        Boolean(entry)
        && typeof entry.id === "string"
        && typeof entry.letterId === "string"
        && typeof entry.timestamp === "string"
        && typeof entry.content === "string"
        && (!options?.afterTimestamp || entry.timestamp > options.afterTimestamp)
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function saveEvents(characterId: string, events: LetterProjectionEntry[]): void {
  if (typeof window === "undefined" || !characterId) return;
  const compacted = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_EVENTS_PER_CHARACTER);
  kvSet(storageKey(characterId), JSON.stringify(compacted));
}

export function buildLetterProjectionContent(letter: Letter, userName = "用户", now = Date.now()): string {
  const time = formatChatTimestamp(letter.createdAt);
  const char = cleanEventText(letter.characterName, 80) || "角色";
  const title = cleanEventText(letter.title, 80) || "一封信";
  const snippet = cleanEventText(letter.body, 360);
  const isSealed = letter.deliveryMode === "scheduled" && Date.parse(letter.unlockAt) > now;

  if (isSealed) {
    const unlockTime = formatChatTimestamp(letter.unlockAt);
    return `[信件 ${time}] ${char}给${userName}写了一封定时信《${title}》，约定在 ${unlockTime} 拆封。信件当前仍处于密封状态，${userName}尚未看到正文。请注意：在约定时间之前，不要在聊天中主动剧透这封信的具体内容。信件大意：“${snippet}”`;
  }

  const openedHint = letter.openedAt ? "（已被拆阅）" : "（已送达待拆阅）";
  return `[信件 ${time}] ${char}给${userName}写了一封信《${title}》${openedHint}。正文摘录：“${snippet}”`;
}

/** 录入或更新一封信对应的短期记忆事件。 */
export function recordLetterEvent(letter: Letter, userName = "用户"): void {
  if (!letter.characterId || !letter.id) return;
  const entries = loadLetterProjectionEntries(letter.characterId);
  const eventId = `letter_event_${letter.id}`;
  const next = entries.filter(entry => entry.id !== eventId && entry.letterId !== letter.id);
  next.push({
    id: eventId,
    letterId: letter.id,
    characterId: letter.characterId,
    timestamp: letter.createdAt,
    content: buildLetterProjectionContent(letter, userName),
  });
  saveEvents(letter.characterId, next);
}

/** 删除一封信时，同时抹除它对应的短期记忆事件。 */
export function removeLetterEvent(characterId: string, letterId: string): void {
  if (!characterId || !letterId) return;
  const entries = loadLetterProjectionEntries(characterId);
  const next = entries.filter(entry => entry.letterId !== letterId && entry.id !== `letter_event_${letterId}`);
  saveEvents(characterId, next);
}
