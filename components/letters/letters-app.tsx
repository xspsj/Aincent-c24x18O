"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bot, ChevronLeft, Clock3, Mail, PenTool, Settings2, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { confirmLetterMailReceived, requeueLetterMail } from "@/lib/letter-delivery-service";
import { generateLetterForCharacter } from "@/lib/letter-engine";
import {
  LETTERS_UPDATED_EVENT,
  LETTER_MAIL_CONFIG_UPDATED_EVENT,
  LETTER_CHAR_MAIL_CONFIG_UPDATED_EVENT,
  LETTER_TIMER_SETTINGS_UPDATED_EVENT,
  deleteLetter,
  isLetterMailConfigured,
  isLetterSealed,
  listConfiguredMailCharacterIds,
  listLetterCharacterIds,
  loadLetterTimerSettings,
  loadLetters,
  markLetterOpened,
  saveLetterTimerSettings,
} from "@/lib/letter-storage";
import type { Letter, LetterTimerSettings } from "@/lib/letter-types";
import {
  loadDiaryEntryFontAssetId,
  loadDiaryEntryFontScale,
  saveDiaryEntryFontAssetId,
  saveDiaryEntryFontScale,
} from "@/lib/diary-entry-storage";
import { getThemeAssetDataUrl, saveThemeAssetFromBlob } from "@/lib/theme-storage";

import { LetterDrawer, formatUnlockTime } from "./letter-drawer";
import { LetterEnvelopeStage } from "./letter-envelope-stage";

const DIARY_USER_FONT_FAMILY = "AIPhoneDiaryEntryUserFont";
const DIARY_USER_FONT_STYLE_ID = "ai-phone-diary-entry-user-font-face";

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
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [pulled, setPulled] = useState<Pulled | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Letter | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [configuredCharIds, setConfiguredCharIds] = useState<Set<string>>(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [writeModalOpen, setWriteModalOpen] = useState(false);
  const [timerSettings, setTimerSettings] = useState<LetterTimerSettings>(() => loadLetterTimerSettings());
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = usePrefersReducedMotion();

  const [diaryFontAssetId, setDiaryFontAssetId] = useState<string | null>(() => loadDiaryEntryFontAssetId());
  const [diaryFontDataUrl, setDiaryFontDataUrl] = useState<string | null>(null);
  const [diaryFontScale, setDiaryFontScale] = useState<number>(() => loadDiaryEntryFontScale());
  const fontFileRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((message: string) => onNotice?.(message), [onNotice]);

  useEffect(() => {
    if (!diaryFontAssetId) { setDiaryFontDataUrl(null); return; }
    let cancelled = false;
    void getThemeAssetDataUrl(diaryFontAssetId).then(dataUrl => {
      if (cancelled) return;
      if (dataUrl) { setDiaryFontDataUrl(dataUrl); return; }
      saveDiaryEntryFontAssetId(null);
      setDiaryFontAssetId(null);
      setDiaryFontDataUrl(null);
    }).catch(() => { if (!cancelled) setDiaryFontDataUrl(null); });
    return () => { cancelled = true; };
  }, [diaryFontAssetId]);

  useEffect(() => {
    let node = document.getElementById(DIARY_USER_FONT_STYLE_ID) as HTMLStyleElement | null;
    if (!node) { node = document.createElement("style"); node.id = DIARY_USER_FONT_STYLE_ID; document.head.append(node); }
    node.textContent = diaryFontDataUrl
      ? `@font-face{font-family:"${DIARY_USER_FONT_FAMILY}";src:url("${diaryFontDataUrl}");font-display:swap;}`
      : "";
  }, [diaryFontDataUrl]);

  const handleDiaryFontUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const assetId = await saveThemeAssetFromBlob(file, "font");
      const dataUrl = await getThemeAssetDataUrl(assetId);
      if (!dataUrl) throw new Error("字体资源未成功存入数据库");
      saveDiaryEntryFontAssetId(assetId);
      setDiaryFontAssetId(assetId);
      setDiaryFontDataUrl(dataUrl);
      notify(`信件字体已更新：${file.name}`);
    } catch (error) { notify("字体上传失败：" + String(error)); }
  }, [notify]);

  const handleDiaryFontScaleChange = useCallback((scale: number) => {
    const normalized = Math.min(1.25, Math.max(0.85, scale));
    setDiaryFontScale(normalized);
    saveDiaryEntryFontScale(normalized);
  }, []);

  const handleDiaryFontReset = useCallback(() => {
    saveDiaryEntryFontAssetId(null);
    saveDiaryEntryFontScale(1);
    setDiaryFontAssetId(null);
    setDiaryFontDataUrl(null);
    setDiaryFontScale(1);
    notify("已恢复默认手写字体");
  }, [notify]);

  const fontStyle = useMemo(() => ({
    ...(diaryFontDataUrl ? { "--diary-entry-font-family": `"${DIARY_USER_FONT_FAMILY}", "NoteWall Ximai", var(--app-font-family)` } : {}),
    "--diary-entry-font-scale": String(diaryFontScale),
  } as CSSProperties), [diaryFontDataUrl, diaryFontScale]);

  const refresh = useCallback(() => {
    setLetterCharacterIds(listLetterCharacterIds());
    setMailConfigured(isLetterMailConfigured(activeCharacterId ?? ""));
    setConfiguredCharIds(new Set(listConfiguredMailCharacterIds()));
    setTimerSettings(loadLetterTimerSettings());
  }, [activeCharacterId]);

  useEffect(() => { setCharacters(loadCharacters()); }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(LETTERS_UPDATED_EVENT, refresh);
    window.addEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, refresh);
    window.addEventListener(LETTER_CHAR_MAIL_CONFIG_UPDATED_EVENT, refresh);
    window.addEventListener(LETTER_TIMER_SETTINGS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(LETTERS_UPDATED_EVENT, refresh);
      window.removeEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, refresh);
      window.removeEventListener(LETTER_CHAR_MAIL_CONFIG_UPDATED_EVENT, refresh);
      window.removeEventListener(LETTER_TIMER_SETTINGS_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const hiddenLetterId = pulled?.letterId ?? readingId;

  const pulledLetter = pulled
    ? letterCharacterIds.flatMap(id => loadLetters(id)).find(l => l.id === pulled.letterId) ?? null
    : null;
  const readingLetter = readingId
    ? letterCharacterIds.flatMap(id => loadLetters(id)).find(l => l.id === readingId) ?? null
    : null;

  useEffect(() => { if (pulled && !pulledLetter) setPulled(null); }, [pulled, pulledLetter]);

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
    setReadingId(current => (current === letter.id ? null : current));
    setPulled(current => (current?.letterId === letter.id ? null : current));
    notify("信已丢弃入碎纸箱，相关短期记忆已清除。");
  };

  const handleManualTrigger = async (charId: string) => {
    if (generating) return;
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    setWriteModalOpen(false);
    setGenerating(true);
    setActiveCharacterId(charId);
    notify(`正在呼唤 ${char.name} 提笔写信…`);
    try {
      const result = await generateLetterForCharacter(charId, "manual", true);
      if (result.shouldWrite) {
        notify(result.deliveryMode === "scheduled"
          ? `${char.name} 寄来了一封定时信（${formatUnlockTime(result.unlockAt || "")} 启封）。`
          : `${char.name} 的信已落入抽屉。`);
      } else {
        notify(result.reason || `${char.name} 觉得此刻时机未到，暂未写信。`);
      }
    } catch (err) {
      notify(`写信失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="diary-app diary-entry-app lt-app" style={fontStyle}>
      <header className="diary-app-header diary-entry-header">
        <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1>信件</h1>
          <p>每个角色一个抽屉，点开翻阅</p>
        </div>
        <span className="diary-entry-header-actions">
          <button type="button" className="note-wall-menu-btn diary-font-upload-btn" onClick={() => setFontPanelOpen(true)} aria-label="信件字体设置" title="信件字体设置">
            <span className="diary-font-upload-mark" aria-hidden="true">Aa</span>
          </button>
          <button type="button" className="note-wall-menu-btn" onClick={() => setSettingsOpen(true)} aria-label="信件设置" title="信件设置">
            <Settings2 size={20} />
          </button>
        </span>
      </header>

      <input ref={fontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*,application/font-woff,application/font-woff2" className="hidden" onChange={handleDiaryFontUpload} />

      {/* 手风琴式角色信箱：铭牌条在下方（像真实抽屉前板），展开内容向上展开 */}
      <main className="lt-accordion-main">
        {letterCharacterIds.length === 0 ? (
          <div className="diary-entry-empty">
            <Mail size={34} strokeWidth={1.5} />
            <h2>还没有信件</h2>
            <p>点右下角「让TA写」，邀请角色寄来第一封信。</p>
          </div>
        ) : (
          <div className="lt-accordion-list">
            {letterCharacterIds.map(charId => {
              const char = characters.find(c => c.id === charId);
              const charLetters = loadLetters(charId);
              const isOpen = activeCharacterId === charId;
              const hasUnread = charLetters.some(l => !l.openedAt && !isLetterSealed(l, now));
              return (
                <div key={charId} className={`lt-accordion-item${isOpen ? " is-open" : ""}`}>
                  {/* 展开内容在铭牌条上方 */}
                  {isOpen ? (
                    <div className="lt-accordion-drawer">
                      <LetterDrawer
                        key={charId}
                        letters={charLetters}
                        characterName={char?.name ?? charId}
                        avatar={char?.avatar}
                        now={now}
                        hiddenLetterId={hiddenLetterId}
                        onPull={handlePull}
                        onRequestDelete={letter => setDeleteCandidate(letter)}
                      />
                    </div>
                  ) : null}
                  {/* 铭牌条（抽屉前板）在底部 */}
                  <button
                    type="button"
                    className="lt-accordion-handle"
                    onClick={() => setActiveCharacterId(isOpen ? null : charId)}
                    aria-expanded={isOpen}
                  >
                    <span className="lt-accordion-label-plate">
                      <span className="lt-accordion-name">{char?.name ?? charId}</span>
                      <span className="lt-accordion-count">{charLetters.length} 封</span>
                    </span>
                    {hasUnread && <span className="lt-shelf-dot" aria-label="有未读信件" />}
                    <span className="lt-accordion-handle-bar" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 右下角悬浮「让TA写」圆圈，固定在页面右下角，与抽屉无关 */}
      <button
        type="button"
        className="lt-write-fab"
        disabled={generating}
        aria-busy={generating}
        onClick={() => setWriteModalOpen(true)}
        aria-label="让角色写一封信"
        title="让角色写一封信"
      >
        <PenTool size={18} strokeWidth={1.9} className={generating ? "animate-pulse" : ""} />
        <span>{generating ? "写信中…" : "让TA写"}</span>
      </button>

      {/* 角色选择弹窗 */}
      {writeModalOpen ? (
        <div className="lt-overlay lt-overlay-center" role="dialog" aria-modal="true" aria-label="选择写信角色" onClick={() => setWriteModalOpen(false)}>
          <section className="lt-dialog" onClick={e => e.stopPropagation()}>
            <header className="lt-sheet-head">
              <h2>让谁写信？</h2>
              <button type="button" className="diary-icon-btn" onClick={() => setWriteModalOpen(false)} aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="lt-write-modal-list">
              {characters.map(char => (
                <button key={char.id} type="button" className="lt-write-modal-item" onClick={() => void handleManualTrigger(char.id)} disabled={generating}>
                  <span className="lt-write-modal-avatar">
                    {char.avatar ? <img src={char.avatar} alt="" /> : <Bot size={20} />}
                  </span>
                  <span className="lt-write-modal-name">{char.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {pulled && pulledLetter ? (
        <LetterEnvelopeStage
          key={pulledLetter.id}
          letter={pulledLetter}
          avatar={characters.find(c => c.id === pulledLetter.characterId)?.avatar}
          sealed={isLetterSealed(pulledLetter, now)}
          sourceEl={pulled.sourceEl}
          reducedMotion={reducedMotion}
          onClosed={() => setPulled(null)}
          onOpened={handleOpened}
          onSealedTap={() => notify(`这封信要到 ${formatUnlockTime(pulledLetter.unlockAt)} 才能拆开。`)}
        />
      ) : null}

      {readingLetter ? (
        <LetterReader
          letter={readingLetter}
          onClose={() => setReadingId(null)}
          onConfirmReceived={() => { confirmLetterMailReceived(readingLetter); notify("已标记为收到。"); }}
          onResend={() => { requeueLetterMail(readingLetter); notify("正在重新投递…"); }}
        />
      ) : null}

      {fontPanelOpen ? (
        <div className="nw-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setFontPanelOpen(false)}>
          <section className="diary-font-panel" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <h2>信件字体</h2>
                <p>{diaryFontDataUrl ? "已使用自定义手写字体" : "当前使用默认手写字体"}</p>
              </div>
              <button type="button" className="diary-icon-btn" onClick={() => setFontPanelOpen(false)} aria-label="关闭">
                <X size={18} />
              </button>
            </header>
            <button type="button" className="diary-font-upload-action" onClick={() => fontFileRef.current?.click()}>
              <span className="diary-font-upload-mark" aria-hidden="true">Aa</span>
              <span>上传字体文件 (.ttf / .woff2)</span>
            </button>
            <label className="diary-font-size-control">
              <span><strong>信纸字号</strong><em>{Math.round(diaryFontScale * 100)}%</em></span>
              <input type="range" min="0.85" max="1.25" step="any" value={diaryFontScale} onChange={event => handleDiaryFontScaleChange(Number(event.target.value))} />
            </label>
            <button type="button" className="diary-font-reset-btn" onClick={handleDiaryFontReset}>
              恢复默认手写字体
            </button>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <LettersSettingsSheet
          characters={characters}
          configuredCharIds={configuredCharIds}
          timerSettings={timerSettings}
          onNotice={notify}
          onSaveTimer={saveLetterTimerSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {deleteCandidate ? (
        <ConfirmDialog
          title="丢弃这封信？"
          message="确认后信件将从抽屉中彻底销毁，相关短期记忆也会一并抹除。已经投递到 QQ 邮箱的那一份不受影响。"
          variant="danger"
          confirmLabel="丢入废纸篓"
          cancelLabel="留着"
          onConfirm={() => handleDelete(deleteCandidate)}
          onCancel={() => setDeleteCandidate(null)}
        />
      ) : null}
    </section>
  );
}

function LetterReader({
  letter, onClose, onConfirmReceived, onResend,
}: {
  letter: Letter;
  onClose: () => void;
  onConfirmReceived: () => void;
  onResend: () => void;
}) {
  const paragraphs = letter.body.split(/\n{2,}/);
  return (
    <div className="lt-overlay" role="dialog" aria-modal="true" aria-labelledby="lt-reader-title" onClick={onClose}>
      <article className="lt-paper is-unfolding" onClick={event => event.stopPropagation()}>
        <header className="lt-paper-bar">
          <span style={{ width: 40 }} />
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="收起信纸">
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
            {letter.mailError && (letter.mailStatus === "failed" || letter.mailStatus === "uncertain") && !letter.mailError.startsWith("__to__:") ? (
              <span className="lt-mail-state-detail">{letter.mailError}</span>
            ) : null}
            {letter.mailError?.startsWith("__to__:") && (letter.mailStatus === "sent" || letter.mailStatus === "pending" || letter.mailStatus === "sending") ? (
              <span className="lt-mail-state-detail">
                {"寄往 " + (letter.mailError.slice(7).split(":")[1]?.trim() || letter.mailError.slice(7).split(":")[0]?.trim())}
              </span>
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

function LettersSettingsSheet({
  characters, configuredCharIds, timerSettings, onNotice, onSaveTimer, onClose,
}: {
  characters: Character[];
  configuredCharIds: Set<string>;
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
    <div className="lt-overlay lt-overlay-center" role="dialog" aria-modal="true" aria-label="信件设置" onClick={onClose}>
      <section className="lt-dialog" onClick={event => event.stopPropagation()}>
        <header className="lt-sheet-head">
          <h2>信件设置</h2>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="lt-sheet-body">
          <section className="lt-sheet-section">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-1.5">
                  <Clock3 size={15} />
                  写信节奏区间（可选）
                </h3>
                <p className="mt-1">控制每隔几天让角色评估一次是否写信。关闭时完全由角色自主意愿驱动。</p>
              </div>
            </div>
            <label className="flex items-center gap-2 mt-2 text-sm cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              <span>开启时间区间节奏限制</span>
            </label>
            {enabled ? (
              <div className="flex flex-col gap-3 mt-2 pt-2 border-t border-black/5">
                <label className="flex items-center justify-between text-xs text-gray-600">
                  <span>巡检周期（天）</span>
                  <input type="number" min={1} max={30} value={intervalDays} onChange={e => setIntervalDays(Math.max(1, Number(e.target.value) || 1))} className="w-16 px-2 py-1 border border-black/15 text-center text-sm" />
                </label>
                <div>
                  <span className="text-xs text-gray-500 block mb-1.5">生效角色（默认全部）</span>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {characters.map(char => {
                      const selected = characterIds.includes(char.id);
                      const hasMail = configuredCharIds.has(char.id);
                      return (
                        <button
                          key={char.id}
                          type="button"
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selected ? "bg-black text-white border-black" : "bg-white text-gray-700 border-black/15 hover:border-black/30"}`}
                          onClick={() => toggleCharacter(char.id)}
                        >
                          {char.name}{hasMail ? " ✔" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
            <button type="button" className="lt-mail-btn mt-2 w-full text-xs" onClick={handleSaveTimer}>
              保存节奏设置
            </button>
          </section>
          <p className="lt-settings-nav-hint">
            <button type="button" onClick={onClose}>
              前往「设置 → 角色邮箱」配置发信凭证 →
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
