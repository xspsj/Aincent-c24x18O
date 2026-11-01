import { kvGet, kvGetFresh, kvKeysWithPrefix, kvRemove, kvSet, registerDynamicPrefix } from "./kv-db";
import type { Letter, LetterInput, LetterMailConfig, LetterMailStatus, LetterReply, LetterTrigger } from "./letter-types";

// ── 信件：按角色分开存，一个角色一个键 ──
export const LETTERS_KEY_PREFIX = "ai_phone_letters_v1:";
export const LETTERS_UPDATED_EVENT = "letters-updated";
const MAX_LETTERS_PER_CHARACTER = 300;

registerDynamicPrefix(LETTERS_KEY_PREFIX);

// ── QQ 邮箱配置 ──
// 故意不调用 registerKvMigration：未登记的键不会镜像到 localStorage，
// 授权码只留在 IndexedDB。备份同样排除这个键（见 data-management/modules.ts）。
export const LETTER_MAIL_CONFIG_KEY = "ai_phone_letter_mail_config_v1";
export const LETTER_MAIL_CONFIG_UPDATED_EVENT = "letter-mail-config-updated";

/** QQ 邮箱（含 foxmail / vip.qq.com）。后端发信接口用同一条规则校验。 */
export const QQ_MAIL_ADDRESS_PATTERN = /^[a-z0-9._-]{1,64}@(qq\.com|vip\.qq\.com|foxmail\.com)$/i;
/** QQ 邮箱 SMTP 授权码是 16 位字母。 */
export const QQ_MAIL_AUTH_CODE_PATTERN = /^[a-z]{16}$/i;

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function cleanMultilineText(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength)
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function storageKey(characterId: string): string {
  return `${LETTERS_KEY_PREFIX}${characterId}`;
}

function dispatchLettersUpdated(characterId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LETTERS_UPDATED_EVENT, { detail: { characterId } }));
}

const MAIL_STATUSES: LetterMailStatus[] = ["none", "pending", "sending", "sent", "uncertain", "failed"];
const TRIGGERS: LetterTrigger[] = ["self", "timer", "manual"];

function normalizeReplies(value: unknown): LetterReply[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): LetterReply | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = cleanText(record.id, 120);
      const body = cleanMultilineText(record.body, 6000);
      const createdAt = validIso(record.createdAt);
      return id && body && createdAt ? { id, body, createdAt } : null;
    })
    .filter((item): item is LetterReply => Boolean(item));
}

export function normalizeLetter(raw: unknown): Letter | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const characterId = cleanText(record.characterId, 120);
  const body = cleanMultilineText(record.body, 8000);
  if (!id || !characterId || !body) return null;

  const createdAt = validIso(record.createdAt) ?? new Date().toISOString();
  const deliveryMode = record.deliveryMode === "scheduled" ? "scheduled" : "immediate";
  const unlockAt = deliveryMode === "scheduled" ? (validIso(record.unlockAt) ?? createdAt) : createdAt;
  const mailStatus = MAIL_STATUSES.includes(record.mailStatus as LetterMailStatus)
    ? record.mailStatus as LetterMailStatus
    : "none";
  const trigger = TRIGGERS.includes(record.trigger as LetterTrigger) ? record.trigger as LetterTrigger : "self";

  return {
    id,
    characterId,
    characterName: cleanText(record.characterName, 80) || "角色",
    title: cleanText(record.title, 80) || body.slice(0, 16),
    body,
    signature: cleanText(record.signature, 80),
    deliveryMode,
    unlockAt,
    trigger,
    openedAt: validIso(record.openedAt),
    mailStatus,
    mailSentAt: validIso(record.mailSentAt),
    mailError: cleanText(record.mailError, 300) || undefined,
    mailAttempts: Math.max(0, Math.floor(Number(record.mailAttempts) || 0)),
    mailLastAttemptAt: validIso(record.mailLastAttemptAt),
    replies: normalizeReplies(record.replies),
    createdAt,
    updatedAt: validIso(record.updatedAt) ?? createdAt,
  };
}

/** 定时信是否还没到拆封时间。 */
export function isLetterSealed(letter: Letter, now = Date.now()): boolean {
  return letter.deliveryMode === "scheduled" && Date.parse(letter.unlockAt) > now;
}

function parseLetters(raw: string | null, characterId: string): Letter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeLetter)
      .filter((letter): letter is Letter => Boolean(letter) && letter!.characterId === characterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** 某个角色的全部信件，新的在前。 */
export function loadLetters(characterId: string): Letter[] {
  if (typeof window === "undefined" || !characterId) return [];
  return parseLetters(kvGet(storageKey(characterId)), characterId);
}

/**
 * 绕过本标签页内存缓存、直接读 IndexedDB。投递前用它确认状态，
 * 避免另一个标签页刚寄出的信在这里因为缓存过期又寄一次。
 */
export async function loadLettersFresh(characterId: string): Promise<Letter[]> {
  if (typeof window === "undefined" || !characterId) return [];
  return parseLetters(await kvGetFresh(storageKey(characterId)), characterId);
}

/** 有信件的角色 id 列表。 */
export function listLetterCharacterIds(): string[] {
  return kvKeysWithPrefix(LETTERS_KEY_PREFIX)
    .map(key => key.slice(LETTERS_KEY_PREFIX.length))
    .filter(characterId => loadLetters(characterId).length > 0);
}

function saveLetters(characterId: string, letters: Letter[]): void {
  if (typeof window === "undefined" || !characterId) return;
  const normalized = letters
    .map(normalizeLetter)
    .filter((letter): letter is Letter => Boolean(letter) && letter!.characterId === characterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_LETTERS_PER_CHARACTER);
  if (normalized.length === 0) {
    kvRemove(storageKey(characterId));
  } else {
    kvSet(storageKey(characterId), JSON.stringify(normalized));
  }
  dispatchLettersUpdated(characterId);
}

export function createLetter(input: LetterInput, options: { mailConfigured: boolean }): Letter {
  const now = new Date().toISOString();
  const body = cleanMultilineText(input.body, 8000);
  const scheduled = input.deliveryMode === "scheduled" && Boolean(validIso(input.unlockAt))
    && Date.parse(input.unlockAt!) > Date.now();
  const letter: Letter = {
    id: generateId("letter"),
    characterId: cleanText(input.characterId, 120),
    characterName: cleanText(input.characterName, 80) || "角色",
    title: cleanText(input.title, 80) || body.slice(0, 16),
    body,
    signature: cleanText(input.signature, 80),
    deliveryMode: scheduled ? "scheduled" : "immediate",
    unlockAt: scheduled ? new Date(input.unlockAt!).toISOString() : now,
    trigger: input.trigger ?? "self",
    mailStatus: options.mailConfigured ? "pending" : "none",
    mailAttempts: 0,
    replies: [],
    createdAt: now,
    updatedAt: now,
  };
  saveLetters(letter.characterId, [letter, ...loadLetters(letter.characterId)]);
  return letter;
}

export function updateLetter(characterId: string, id: string, patch: Partial<Omit<Letter, "id" | "characterId">>): Letter | null {
  const letters = loadLetters(characterId);
  const index = letters.findIndex(letter => letter.id === id);
  if (index < 0) return null;
  const next = { ...letters[index], ...patch, updatedAt: new Date().toISOString() };
  letters[index] = next;
  saveLetters(characterId, letters);
  return next;
}

/** 第一次拆开时记下时间。待拆封的信不会被标记。 */
export function markLetterOpened(letter: Letter): void {
  if (letter.openedAt || isLetterSealed(letter)) return;
  updateLetter(letter.characterId, letter.id, { openedAt: new Date().toISOString() });
}

/** 删除一封信。第 4 步会在这里同时删掉它对应的短期记忆事件。 */
export function deleteLetter(characterId: string, id: string): void {
  if (!characterId || !id) return;
  saveLetters(characterId, loadLetters(characterId).filter(letter => letter.id !== id));
}

// ── QQ 邮箱配置读写 ──

export function loadLetterMailConfig(): LetterMailConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = kvGet(LETTER_MAIL_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LetterMailConfig>;
    const address = cleanText(parsed.address, 254).toLowerCase();
    const authCode = cleanText(parsed.authCode, 64);
    if (!address || !authCode) return null;
    return {
      address,
      authCode,
      verifiedAt: validIso(parsed.verifiedAt),
      updatedAt: validIso(parsed.updatedAt) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function isLetterMailConfigured(): boolean {
  return Boolean(loadLetterMailConfig());
}

export function saveLetterMailConfig(input: { address: string; authCode: string; verifiedAt?: string }): LetterMailConfig {
  const config: LetterMailConfig = {
    address: cleanText(input.address, 254).toLowerCase(),
    authCode: cleanText(input.authCode, 64).replace(/\s+/g, ""),
    verifiedAt: input.verifiedAt,
    updatedAt: new Date().toISOString(),
  };
  kvSet(LETTER_MAIL_CONFIG_KEY, JSON.stringify(config));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LETTER_MAIL_CONFIG_UPDATED_EVENT));
  return config;
}

export function clearLetterMailConfig(): void {
  kvRemove(LETTER_MAIL_CONFIG_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LETTER_MAIL_CONFIG_UPDATED_EVENT));
}
