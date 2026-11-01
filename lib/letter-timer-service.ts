import { bgSetInterval } from "./bg-timer";
import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { generateLetterForCharacter } from "./letter-engine";
import {
  LETTER_TIMER_SETTINGS_UPDATED_EVENT,
  loadLetterTimerSettings,
  saveLetterTimerSettings,
} from "./letter-storage";
import type { LetterTimerSettings } from "./letter-types";

// ── 信件定时节奏巡检服务 ──
//
// 1. 每 60 秒检查一次是否到达设定节奏（如 72 小时）；
// 2. 到达时唤起角色评估，角色自主判定是否提笔写信（情绪/羁绊驱动）；
// 3. 用户关闭节奏开关时，本服务不自动发起写信，完全由用户聊天推动或手动发起。

const CHECK_INTERVAL_MS = 60_000;

let stopInterval: (() => void) | null = null;
let running = false;

function dispatchGlobalNotice(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("global-notice", { detail: message }));
}

function resolveTimerTargets(settings: LetterTimerSettings, characters: Character[]): Character[] {
  const scheduledIds = settings.characterIds.length > 0
    ? settings.characterIds
    : characters.map(c => c.id);
  const uniqueIds = Array.from(new Set(scheduledIds.filter(Boolean)));
  return uniqueIds
    .map(id => characters.find(c => c.id === id))
    .filter(Boolean) as Character[];
}

function getDueTargets(settings: LetterTimerSettings): Character[] {
  if (!settings.enabled) return [];
  const characters = loadCharacters();
  const targets = resolveTimerTargets(settings, characters);
  if (targets.length === 0) return [];

  const now = Date.now();
  const intervalMs = Math.max(1, settings.intervalHours) * 3600_000;
  return targets.filter(character => {
    const last = settings.lastRunAtByCharacter[character.id];
    const lastTime = last ? new Date(last).getTime() : 0;
    return !lastTime || now - lastTime >= intervalMs;
  });
}

function stampAttemptedCharacters(characterIds: string[], stamp: string): void {
  if (characterIds.length === 0) return;
  const latest = loadLetterTimerSettings();
  saveLetterTimerSettings({
    ...latest,
    lastRunAtByCharacter: {
      ...latest.lastRunAtByCharacter,
      ...Object.fromEntries(characterIds.map(id => [id, stamp])),
    },
  });
}

export async function runLetterTimerCheck(): Promise<void> {
  if (typeof window === "undefined" || running) return;

  const settings = loadLetterTimerSettings();
  const dueTargets = getDueTargets(settings);
  if (dueTargets.length === 0) return;

  running = true;
  const attemptedIds = dueTargets.map(c => c.id);
  const stamp = new Date().toISOString();
  let createdCount = 0;
  const createdNames: string[] = [];

  try {
    for (const character of dueTargets) {
      try {
        const result = await generateLetterForCharacter(character.id, "timer", false);
        if (result.shouldWrite) {
          createdCount += 1;
          createdNames.push(character.name);
        }
      } catch (err) {
        console.warn("[LetterTimerService] failed check for", character.name, err);
      }
    }

    stampAttemptedCharacters(attemptedIds, stamp);

    if (createdCount === 1) {
      dispatchGlobalNotice(`${createdNames[0]} 给你寄来了一封信。`);
    } else if (createdCount > 1) {
      dispatchGlobalNotice(`收到了来自 ${createdNames.join("、")} 的来信。`);
    }
  } finally {
    running = false;
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") {
    void runLetterTimerCheck();
  }
}

function handleSettingsUpdated(): void {
  void runLetterTimerCheck();
}

export function startLetterTimerService(): () => void {
  if (typeof window === "undefined" || stopInterval) return () => {};
  stopInterval = bgSetInterval(() => {
    void runLetterTimerCheck();
  }, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener(LETTER_TIMER_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
  void runLetterTimerCheck();
  return stopLetterTimerService;
}

export function stopLetterTimerService(): void {
  if (stopInterval) {
    stopInterval();
    stopInterval = null;
  }
  if (typeof window === "undefined") return;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener(LETTER_TIMER_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
}
