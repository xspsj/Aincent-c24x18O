import { bgSetInterval } from "./bg-timer";
import { buildLetterMail, sendLetterMail } from "./letter-mail-client";
import {
  LETTERS_UPDATED_EVENT,
  LETTER_MAIL_CONFIG_UPDATED_EVENT,
  isLetterSealed,
  listLetterCharacterIds,
  loadLetterMailConfig,
  loadLetters,
  loadLettersFresh,
  updateLetter,
} from "./letter-storage";
import type { Letter } from "./letter-types";

// 把到点的信投递到 QQ 邮箱。在浏览器里运行：网页开着（或开着后台保活）时
// 每 30 秒检查一次；网页关着时不会投递，下次打开时补发。

const CHECK_INTERVAL_MS = 30_000;
/** 确定没寄出的信最多自动重试几次。 */
const MAX_AUTO_ATTEMPTS = 5;
/** 第 n 次失败后等 n 分钟再试。 */
const RETRY_STEP_MS = 60_000;
/** 「投递中」超过这么久还没结果，说明投递途中网页被关了：结果不明。 */
const STALE_SENDING_MS = 2 * 60_000;
const LOCK_NAME = "ai-phone-letter-delivery";

let stopInterval: (() => void) | null = null;
let running = false;
let rerunRequested = false;

function dispatchGlobalNotice(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("global-notice", { detail: message }));
}

function isDue(letter: Letter, now: number): boolean {
  if (isLetterSealed(letter, now)) return false;
  if (letter.mailStatus === "pending") return true;
  if (letter.mailStatus !== "failed" || letter.mailAttempts >= MAX_AUTO_ATTEMPTS) return false;
  const last = Date.parse(letter.mailLastAttemptAt ?? "");
  return !Number.isFinite(last) || now - last >= RETRY_STEP_MS * letter.mailAttempts;
}

function isStaleSending(letter: Letter, now: number): boolean {
  if (letter.mailStatus !== "sending") return false;
  const last = Date.parse(letter.mailLastAttemptAt ?? "");
  return !Number.isFinite(last) || now - last >= STALE_SENDING_MS;
}

/** 多个标签页同时开着时，只让一个去投递。不支持 Web Locks 的浏览器直接执行。 */
async function withDeliveryLock(task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) {
    await task();
    return;
  }
  await locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
    if (lock) await task();
  });
}

async function deliverOne(letter: Letter): Promise<"sent" | "uncertain" | "failed" | "skipped"> {
  // 以 IndexedDB 里的最新状态为准：别的标签页可能刚刚寄过这封信。
  // 本标签页刚写入的信可能还没落盘，IndexedDB 里找不到时退回内存里的版本。
  // 两份都要「到期」才寄：任何一边显示已在投递/已寄出，都不重复投递。
  const cached = loadLetters(letter.characterId).find(item => item.id === letter.id);
  const stored = (await loadLettersFresh(letter.characterId)).find(item => item.id === letter.id);
  const now = Date.now();
  if (!cached || !isDue(cached, now)) return "skipped";
  if (stored && !isDue(stored, now)) {
    if (stored.mailStatus === "sent" || stored.mailStatus === "uncertain") {
      // 别的标签页已经处理过了，把结果同步到本标签页
      updateLetter(letter.characterId, letter.id, {
        mailStatus: stored.mailStatus,
        mailSentAt: stored.mailSentAt,
        mailError: stored.mailError,
        mailAttempts: stored.mailAttempts,
        mailLastAttemptAt: stored.mailLastAttemptAt,
      });
    }
    return "skipped";
  }
  const fresh = cached;

  const config = loadLetterMailConfig();
  if (!config) return "skipped";

  const startedAt = new Date().toISOString();
  updateLetter(letter.characterId, letter.id, {
    mailStatus: "sending",
    mailLastAttemptAt: startedAt,
    mailAttempts: fresh.mailAttempts + 1,
    mailError: undefined,
  });

  const result = await sendLetterMail(config, buildLetterMail(fresh));
  if (result.status === "ok") {
    updateLetter(letter.characterId, letter.id, { mailStatus: "sent", mailSentAt: new Date().toISOString(), mailError: undefined });
    return "sent";
  }
  updateLetter(letter.characterId, letter.id, { mailStatus: result.status, mailError: result.error });
  return result.status;
}

export async function runLetterDeliveryCheck(): Promise<void> {
  if (typeof window === "undefined") return;
  if (running) {
    // 正在投递时又来了新信：本轮结束后再跑一次，不用等下一个 30 秒
    rerunRequested = true;
    return;
  }
  if (!loadLetterMailConfig()) return;
  running = true;
  rerunRequested = false;
  try {
    await withDeliveryLock(async () => {
      const now = Date.now();
      let sent = 0;
      let uncertain = 0;
      let failed = 0;
      for (const characterId of listLetterCharacterIds()) {
        for (const letter of loadLetters(characterId)) {
          if (isStaleSending(letter, now)) {
            updateLetter(characterId, letter.id, {
              mailStatus: "uncertain",
              mailError: "投递途中网页被关闭了，不确定有没有寄到。请先去 QQ 邮箱看看。",
            });
            continue;
          }
          if (!isDue(letter, now)) continue;
          const outcome = await deliverOne(letter);
          if (outcome === "sent") sent += 1;
          else if (outcome === "uncertain") uncertain += 1;
          else if (outcome === "failed") failed += 1;
        }
      }
      if (sent > 0) dispatchGlobalNotice(sent === 1 ? "一封信已投递到你的 QQ 邮箱。" : `${sent} 封信已投递到你的 QQ 邮箱。`);
      if (uncertain > 0) dispatchGlobalNotice(`${uncertain} 封信可能已投递，但没等到确认，请去邮箱看看。`);
      if (failed > 0) dispatchGlobalNotice(`${failed} 封信投递失败，稍后会自动重试。`);
    });
  } catch (error) {
    console.warn("[LetterDelivery] check failed:", error);
  } finally {
    running = false;
  }
  // 本轮自己写回状态也会触发 rerunRequested；重跑时这些信已不再到期，空转一轮就停
  if (rerunRequested) {
    rerunRequested = false;
    void runLetterDeliveryCheck();
  }
}

/** 用户在阅读页点「重新投递」。 */
export function requeueLetterMail(letter: Letter): void {
  updateLetter(letter.characterId, letter.id, { mailStatus: "pending", mailAttempts: 0, mailError: undefined });
  void runLetterDeliveryCheck();
}

/** 用户确认「我收到了」。 */
export function confirmLetterMailReceived(letter: Letter): void {
  updateLetter(letter.characterId, letter.id, {
    mailStatus: "sent",
    mailSentAt: letter.mailSentAt ?? letter.mailLastAttemptAt ?? new Date().toISOString(),
    mailError: undefined,
  });
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") void runLetterDeliveryCheck();
}

function handleTrigger(): void {
  void runLetterDeliveryCheck();
}

export function startLetterDeliveryService(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!stopInterval) {
    stopInterval = bgSetInterval(() => { void runLetterDeliveryCheck(); }, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, handleTrigger);
    window.addEventListener(LETTERS_UPDATED_EVENT, handleTrigger);
    void runLetterDeliveryCheck();
  }
  return stopLetterDeliveryService;
}

export function stopLetterDeliveryService(): void {
  if (stopInterval) {
    stopInterval();
    stopInterval = null;
  }
  if (typeof window === "undefined") return;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, handleTrigger);
  window.removeEventListener(LETTERS_UPDATED_EVENT, handleTrigger);
}
