"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronLeft, Clock3, Mail, PenTool, Settings2, Trash2, WandSparkles, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { confirmLetterMailReceived, requeueLetterMail } from "@/lib/letter-delivery-service";
import { generateLetterForCharacter } from "@/lib/letter-engine";
import {
  LETTERS_UPDATED_EVENT,
  LETTER_MAIL_CONFIG_UPDATED_EVENT,
  LETTER_TIMER_SETTINGS_UPDATED_EVENT,
  deleteLetter,
  isLetterMailConfigured,
  isLetterSealed,
  listLetterCharacterIds,
  loadLetterTimerSettings,
  loadLetters,
  markLetterOpened,
  saveLetterTimerSettings,
} from "@/lib/letter-storage";
import type { Letter, LetterTimerSettings } from "@/lib/letter-types";

import { LetterDrawer, formatUnlockTime, hashText } from "./letter-drawer";
import { LetterEnvelopeStage } from "./letter-envelope-stage";
import { LetterMailSettings } from "./letter-mail-settings";

type LettersAppProps = {
  onBack: () => void;
  onNotice?: (message: string) => void;
};

type Pulled = { letterId: string; sourceEl: HTMLElement };

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function mailStatusLabel(letter: Letter): string {
  switch (letter.mailStatus) {
    case "none": return "未投递到邮箱";
    case "pending": return isLetterSealed(letter) ? "到拆封时间后投递到邮箱" : "等待投递到邮箱";
    case "sending": return "正在投递到邮箱…";
    case "sent": return letter.mailSentAt ? `已投递到邮箱 · ${formatUnlockTime(letter.mailSentAt)}` : "已投递到邮箱";
    case "uncertain": return "可能已投递到邮箱，未收到确认";
    case "failed": return "投递到邮箱失败";
    default: return "";
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function LettersApp({ onBack, onNotice }: LettersAppProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [letterCharacterIds, setLetterCharacterIds] = useState<string[]>([]);
  // activeCharacterId 为 null 时，表示停留在「第一层：角色信盒列表」（同日记第一层书架）
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [pulled, setPulled] = useState<Pulled | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Letter | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [timerSettings, setTimerSettings] = useState<LetterTimerSettings>(() => loadLetterTimerSettings());
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = usePrefersReducedMotion();

  const notify = useCallback((message: string) => onNotice?.(message), [onNotice]);

  const refresh = useCallback(() => {
    setLetterCharacterIds(listLetterCharacterIds());
    setLetters(activeCharacterId ? loadLetters(activeCharacterId) : []);
    setMailConfigured(isLetterMailConfigured());
    setTimerSettings(loadLetterTimerSettings());
  }, [activeCharacterId]);

  useEffect(() => {
    const loaded = loadCharacters();
    setCharacters(loaded);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(LETTERS_UPDATED_EVENT, refresh);
    window.addEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, refresh);
    window.addEventListener(LETTER_TIMER_SETTINGS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(LETTERS_UPDATED_EVENT, refresh);
      window.removeEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, refresh);
      window.removeEventListener(LETTER_TIMER_SETTINGS_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCharacter = useMemo(
    () => (activeCharacterId ? characters.find(c => c.id === activeCharacterId) ?? null : null),
    [characters, activeCharacterId],
  );

  const pulledLetter = pulled ? letters.find(letter => letter.id === pulled.letterId) ?? null : null;
  const readingLetter = readingId ? letters.find(letter => letter.id === readingId) ?? null : null;
  const hiddenLetterId = pulled?.letterId ?? readingId;

  useEffect(() => {
    if (pulled && !pulledLetter) setPulled(null);
  }, [pulled, pulledLetter]);

  const handlePull = (letter: Letter, slot: HTMLButtonElement) => {
    if (pulled || readingId) return;
    setPulled({ letterId: letter.id, sourceEl: slot });
  };

  const handleOpened = () => {
    if (!pulledLetter) return;
    markLetterOpened(pulledLetter);
    setReadingId(pulledLetter.id);
    setPulled(null);
  };

  const handleDelete = (letter: Letter) => {
    deleteLetter(letter.characterId, letter.id);
    setDeleteCandidate(null);
    setReadingId(current => current === letter.id ? null : current);
    setPulled(current => current?.letterId === letter.id ? null : current);
    notify("信已删除，相关短期记忆已清除。");
  };

  const handleManualTrigger = async () => {
    if (!activeCharacter || generating) return;
    setGenerating(true);
    notify(`正在呼唤 ${activeCharacter.name} 提笔写信…`);
    try {
      const result = await generateLetterForCharacter(activeCharacter.id, "manual", true);
      if (result.shouldWrite) {
        notify(
          result.deliveryMode === "scheduled"
            ? `${activeCharacter.name} 寄来了一封定时信（${formatUnlockTime(result.unlockAt || "")} 启封）。`
            : `${activeCharacter.name} 的信已落入抽屉。`,
        );
      } else {
        notify(result.reason || `${activeCharacter.name} 觉得此刻时机未到，暂未写信。`);
      }
    } catch (err) {
      notify(`写信失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="diary-app diary-entry-app lt-app">
      {/* 顶部栏：严格对齐日记组件结构，原生右侧放置设置按钮 */}
      <header className="diary-app-header diary-entry-header">
        <button
          type="button"
          className="diary-icon-btn"
          onClick={() => (activeCharacter ? setActiveCharacterId(null) : onBack())}
          aria-label="返回"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1>{activeCharacter ? `${activeCharacter.name} 的信箱` : "信件"}</h1>
          <p>{activeCharacter ? `共 ${letters.length} 封信件` : "每个角色一个抽屉，点开翻阅"}</p>
        </div>
        <span className="diary-entry-header-actions">
          <button
            type="button"
            className="note-wall-menu-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="信件设置"
            title="信件设置"
          >
            <Settings2 size={20} />
          </button>
        </span>
      </header>

      {!mailConfigured ? (
        <button type="button" className="lt-banner" onClick={() => setSettingsOpen(true)}>
          还没配置 QQ 邮箱，信件仅保存在手机中。点此配置现实邮箱 →
        </button>
      ) : null}

      {/* 主视图 */}
      {!activeCharacter ? (
        // 第一层：角色抽屉书架（图二同款展示）
        <main className="diary-entry-main">
          {characters.length === 0 ? (
            <div className="diary-entry-empty">
              <Mail size={34} strokeWidth={1.5} />
              <h2>暂无角色</h2>
              <p>请先在手机中创建或导入角色卡。</p>
            </div>
          ) : (
            <div className="diary-shelf">
              {[0, 1].map(column => (
                <div className="diary-shelf-column" key={column}>
                  {characters
                    .filter((_, index) => index % 2 === column)
                    .map(char => {
                      const count = loadLetters(char.id).length;
                      const hash = hashText(char.id);
                      return (
                        <button
                          key={char.id}
                          type="button"
                          className="diary-book lt-box-cover"
                          data-cover={hash % 6}
                          onClick={() => setActiveCharacterId(char.id)}
                        >
                          <span className="diary-book-spine" aria-hidden="true" />
                          <span className="diary-book-frame" aria-hidden="true" />
                          <span className="diary-book-label">
                            <span className="diary-book-avatar">
                              {char.avatar ? <img src={char.avatar} alt="" /> : <Bot size={20} />}
                            </span>
                            <strong>{char.name}</strong>
                            <em>的信箱抽屉</em>
                          </span>
                          <span className="diary-book-meta">
                            <span>{count} 封信</span>
                            {letterCharacterIds.includes(char.id) ? (
                              <span className="lt-shelf-dot" aria-label="有信件" />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        // 第二层：点入具体角色的专属木质抽屉
        <main className="lt-drawer-area">
          <LetterDrawer
            key={activeCharacter.id}
            letters={letters}
            characterName={activeCharacter.name}
            avatar={activeCharacter.avatar}
            now={now}
            hiddenLetterId={hiddenLetterId}
            onPull={handlePull}
          />

          {/* 右下角圆形悬浮“让TA写”按钮（与图三一致） */}
          <button
            type="button"
            className="diary-entry-write-btn"
            disabled={generating}
            aria-busy={generating}
            onClick={handleManualTrigger}
            aria-label="让TA写一封信"
            title="让TA写一封信"
          >
            <PenTool size={20} strokeWidth={1.7} className={generating ? "animate-pulse" : ""} />
            <span>{generating ? "撰写中…" : "让TA写"}</span>
          </button>
        </main>
      )}

      {/* 拆信与大信封交互舞台 */}
      {pulled && pulledLetter ? (
        <LetterEnvelopeStage
          key={pulledLetter.id}
          letter={pulledLetter}
          avatar={activeCharacter?.avatar}
          sealed={isLetterSealed(pulledLetter, now)}
          sourceEl={pulled.sourceEl}
          reducedMotion={reducedMotion}
          onClosed={() => setPulled(null)}
          onOpened={handleOpened}
          onSealedTap={() => notify(`这封信要到 ${formatUnlockTime(pulledLetter.unlockAt)} 才能拆开。`)}
        />
      ) : null}

      {/* 信件阅读大纸页 */}
      {readingLetter ? (
        <LetterReader
          letter={readingLetter}
          onClose={() => setReadingId(null)}
          onDelete={() => setDeleteCandidate(readingLetter)}
          onConfirmReceived={() => { confirmLetterMailReceived(readingLetter); notify("已标记为收到。"); }}
          onResend={() => { requeueLetterMail(readingLetter); notify("正在重新投递…"); }}
        />
      ) : null}

      {/* 偏好与节奏设置抽屉 */}
      {settingsOpen ? (
        <LettersSettingsSheet
          characters={characters}
          timerSettings={timerSettings}
          onNotice={notify}
          onSaveTimer={saveLetterTimerSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {/* 确认删除对话框 */}
      {deleteCandidate ? (
        <ConfirmDialog
          title="删除这封信？"
          message="删除后手机里就找不到这封信了，短期记忆也会一并抹除。已经投递到 QQ 邮箱的那一份不受影响。"
          variant="danger"
          confirmLabel="删除"
          cancelLabel="取消"
          onConfirm={() => handleDelete(deleteCandidate)}
          onCancel={() => setDeleteCandidate(null)}
        />
      ) : null}
    </section>
  );
}

function LetterReader({ letter, onClose, onDelete, onConfirmReceived, onResend }: {
  letter: Letter;
  onClose: () => void;
  onDelete: () => void;
  onConfirmReceived: () => void;
  onResend: () => void;
}) {
  const paragraphs = letter.body.split(/\n{2,}/);
  return (
    <div className="lt-overlay" role="dialog" aria-modal="true" aria-labelledby="lt-reader-title" onClick={onClose}>
      <article className="lt-paper is-unfolding" onClick={event => event.stopPropagation()}>
        <header className="lt-paper-bar">
          <button type="button" className="diary-icon-btn" onClick={onDelete} aria-label="删除这封信">
            <Trash2 size={18} />
          </button>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="lt-paper-scroll">
          <h2 id="lt-reader-title" className="lt-paper-title">{letter.title}</h2>
          {paragraphs.map((part, index) => (
            <p key={index} className="lt-paper-text">{part}</p>
          ))}
          <p className="lt-paper-sign">—— {letter.signature || letter.characterName}</p>
          <p className="lt-paper-date">{formatDate(letter.unlockAt)}</p>

          <footer className="lt-paper-mail">
            <span className={`lt-mail-state lt-mail-state-${letter.mailStatus}`}>{mailStatusLabel(letter)}</span>
            {letter.mailError && (letter.mailStatus === "failed" || letter.mailStatus === "uncertain") ? (
              <span className="lt-mail-state-detail">{letter.mailError}</span>
            ) : null}
            {letter.mailStatus === "uncertain" ? (
              <span className="lt-mail-state-actions">
                <button type="button" onClick={onConfirmReceived}>我收到了</button>
                <button type="button" onClick={onResend}>重新投递</button>
              </span>
            ) : letter.mailStatus === "failed" ? (
              <span className="lt-mail-state-actions">
                <button type="button" onClick={onResend}>重新投递</button>
              </span>
            ) : null}
          </footer>
        </div>
      </article>
    </div>
  );
}

function LettersSettingsSheet({ characters, timerSettings, onNotice, onSaveTimer, onClose }: {
  characters: Character[];
  timerSettings: LetterTimerSettings;
  onNotice: (message: string) => void;
  onSaveTimer: (settings: LetterTimerSettings) => void;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(timerSettings.enabled);
  const [intervalDays, setIntervalDays] = useState(Math.round(timerSettings.intervalHours / 24) || 3);
  const [characterIds, setCharacterIds] = useState<string[]>(timerSettings.characterIds);

  const toggleCharacter = (id: string) => {
    setCharacterIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  const handleSaveTimer = () => {
    const next: LetterTimerSettings = {
      ...timerSettings,
      enabled,
      intervalHours: Math.max(1, intervalDays * 24),
      characterIds,
    };
    onSaveTimer(next);
    onNotice(enabled ? `写信节奏已开启（每 ${intervalDays} 天巡检）` : "写信节奏区间已关闭，完全由角色自主提笔");
  };

  return (
    <div className="lt-overlay lt-overlay-bottom" role="dialog" aria-modal="true" aria-label="信件设置" onClick={onClose}>
      <section className="lt-sheet" onClick={event => event.stopPropagation()}>
        <header className="lt-sheet-head">
          <h2>信件设置</h2>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="lt-sheet-body">
          <LetterMailSettings onNotice={onNotice} />

          <section className="lt-sheet-section">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-1.5">
                  <Clock3 size={15} />
                  写信节奏区间（可选）
                </h3>
                <p className="mt-1">
                  控制每隔几天让角色评估一次是否写信。关闭时完全由角色自主意愿驱动。
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 mt-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
              />
              <span>开启时间区间节奏限制</span>
            </label>

            {enabled ? (
              <div className="flex flex-col gap-3 mt-2 pt-2 border-t border-black/5">
                <label className="flex items-center justify-between text-xs text-gray-600">
                  <span>巡检周期（天）</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={intervalDays}
                    onChange={e => setIntervalDays(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 px-2 py-1 border border-black/15 text-center text-sm"
                  />
                </label>

                <div>
                  <span className="text-xs text-gray-500 block mb-1.5">生效角色（默认全部）</span>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {characters.map(char => {
                      const selected = characterIds.includes(char.id);
                      return (
                        <button
                          key={char.id}
                          type="button"
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            selected
                              ? "bg-black text-white border-black"
                              : "bg-white text-gray-700 border-black/15 hover:border-black/30"
                          }`}
                          onClick={() => toggleCharacter(char.id)}
                        >
                          {char.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className="lt-mail-btn mt-2 w-full text-xs"
              onClick={handleSaveTimer}
            >
              保存节奏设置
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}
