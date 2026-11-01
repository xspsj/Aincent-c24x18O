"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronLeft, Mail, Settings2, Trash2, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { confirmLetterMailReceived, requeueLetterMail } from "@/lib/letter-delivery-service";
import {
  LETTERS_UPDATED_EVENT,
  LETTER_MAIL_CONFIG_UPDATED_EVENT,
  createLetter,
  deleteLetter,
  isLetterMailConfigured,
  isLetterSealed,
  listLetterCharacterIds,
  loadLetters,
  markLetterOpened,
} from "@/lib/letter-storage";
import type { Letter } from "@/lib/letter-types";

import { LetterDrawer, formatUnlockTime } from "./letter-drawer";
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
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [pulled, setPulled] = useState<Pulled | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Letter | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  // 每 30 秒刷新一次「现在」，定时信到点后自动变成可拆
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = usePrefersReducedMotion();

  const notify = useCallback((message: string) => onNotice?.(message), [onNotice]);

  const refresh = useCallback(() => {
    setLetterCharacterIds(listLetterCharacterIds());
    setLetters(activeCharacterId ? loadLetters(activeCharacterId) : []);
    setMailConfigured(isLetterMailConfigured());
  }, [activeCharacterId]);

  useEffect(() => {
    const loaded = loadCharacters();
    setCharacters(loaded);
    const withLetters = listLetterCharacterIds();
    setActiveCharacterId(withLetters[0] ?? loaded[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(LETTERS_UPDATED_EVENT, refresh);
    window.addEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(LETTERS_UPDATED_EVENT, refresh);
      window.removeEventListener(LETTER_MAIL_CONFIG_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 顶部角色：有信的角色在前，其余角色在后（没信也能切过去看空抽屉）
  const tabs = useMemo(() => {
    const byId = new Map(characters.map(character => [character.id, character]));
    const first = letterCharacterIds
      .map(id => byId.get(id) ?? { id, name: loadLetters(id)[0]?.characterName ?? "角色", avatar: null } as Character);
    const rest = characters.filter(character => !letterCharacterIds.includes(character.id));
    return [...first, ...rest];
  }, [characters, letterCharacterIds]);

  const activeCharacter = tabs.find(item => item.id === activeCharacterId) ?? null;
  const pulledLetter = pulled ? letters.find(letter => letter.id === pulled.letterId) ?? null : null;
  const readingLetter = readingId ? letters.find(letter => letter.id === readingId) ?? null : null;
  // 抽出来、正在读的信，抽屉里都留着空位
  const hiddenLetterId = pulled?.letterId ?? readingId;

  // 抽出来的那封信不在了（被别处删掉/切了角色），收起舞台，免得卡住后续操作
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
    notify("信已删除。");
  };

  const switchCharacter = (characterId: string) => {
    if (pulled) return;
    setActiveCharacterId(characterId);
    setReadingId(null);
  };

  const addSampleLetter = (scheduled: boolean) => {
    if (!activeCharacter) return;
    const name = activeCharacter.name || "我";
    const letter = createLetter({
      characterId: activeCharacter.id,
      characterName: name,
      title: scheduled ? "等一会儿再拆" : "一封试试看的信",
      body: scheduled
        ? "这封信我想让你过两分钟再看。\n\n不是什么大事，只是想试试，让你等一等的感觉。到时间了，它会自己落到你的邮箱里。"
        : "这是一封测试用的信。\n\n如果你在手机里和邮箱里都看到了它，说明信箱已经能用了。之后我想说的话，会这样寄给你。",
      signature: name,
      deliveryMode: scheduled ? "scheduled" : "immediate",
      unlockAt: scheduled ? new Date(Date.now() + 2 * 60_000).toISOString() : undefined,
      trigger: "manual",
    }, { mailConfigured: isLetterMailConfigured() });
    setSettingsOpen(false);
    notify(scheduled ? `已放入一封定时信，${formatUnlockTime(letter.unlockAt)} 可拆。` : "已放入一封示例信。");
  };

  return (
    <section className="diary-app lt-app">
      <header className="diary-app-header">
        <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回手记">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1>信件</h1>
          <p>{activeCharacter ? `${activeCharacter.name} 寄给你的信` : "角色寄给你的信"}</p>
        </div>
        <button type="button" className="diary-icon-btn lt-header-action" onClick={() => setSettingsOpen(true)} aria-label="信件设置">
          <Settings2 size={19} />
        </button>
      </header>

      {tabs.length > 0 ? (
        <nav className="lt-tabs" aria-label="选择角色">
          {tabs.map(character => (
            <button
              key={character.id}
              type="button"
              className={`lt-tab ${character.id === activeCharacterId ? "is-active" : ""}`}
              aria-pressed={character.id === activeCharacterId}
              onClick={() => switchCharacter(character.id)}
            >
              <span className="lt-tab-avatar">
                {character.avatar ? <img src={character.avatar} alt="" /> : <Bot size={16} />}
              </span>
              <span className="lt-tab-name">{character.name}</span>
              {letterCharacterIds.includes(character.id) ? <span className="lt-tab-dot" aria-hidden="true" /> : null}
            </button>
          ))}
        </nav>
      ) : null}

      {!mailConfigured ? (
        <button type="button" className="lt-banner" onClick={() => setSettingsOpen(true)}>
          还没配置 QQ 邮箱，信只会留在手机里。点这里去设置。
        </button>
      ) : null}

      <main className="lt-drawer-area">
        {activeCharacter ? (
          <LetterDrawer
            key={activeCharacter.id}
            letters={letters}
            characterName={activeCharacter.name}
            avatar={activeCharacter.avatar}
            now={now}
            hiddenLetterId={hiddenLetterId}
            onPull={handlePull}
          />
        ) : (
          <div className="lt-drawer-none">
            <Mail size={30} strokeWidth={1.4} />
            <p>还没有角色。</p>
          </div>
        )}
      </main>

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

      {readingLetter ? (
        <LetterReader
          letter={readingLetter}
          onClose={() => setReadingId(null)}
          onDelete={() => setDeleteCandidate(readingLetter)}
          onConfirmReceived={() => { confirmLetterMailReceived(readingLetter); notify("已标记为收到。"); }}
          onResend={() => { requeueLetterMail(readingLetter); notify("正在重新投递…"); }}
        />
      ) : null}

      {settingsOpen ? (
        <LettersSettingsSheet
          activeCharacterName={activeCharacter?.name ?? null}
          onNotice={notify}
          onAddSample={addSampleLetter}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {deleteCandidate ? (
        <ConfirmDialog
          title="删除这封信？"
          message="删除后手机里就找不到这封信了。已经投递到 QQ 邮箱的那一份不受影响。"
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

function LettersSettingsSheet({ activeCharacterName, onNotice, onAddSample, onClose }: {
  activeCharacterName: string | null;
  onNotice: (message: string) => void;
  onAddSample: (scheduled: boolean) => void;
  onClose: () => void;
}) {
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
            <h3>测试工具</h3>
            <p>
              角色还不会自己写信（第 4 步接上）。先用这里给
              {activeCharacterName ? `「${activeCharacterName}」` : "当前角色"}
              放一封示例信，试试抽屉、拆信和投递。做完第 4 步后这里会移除。
            </p>
            <div className="lt-mail-actions">
              <button type="button" className="lt-mail-btn" disabled={!activeCharacterName} onClick={() => onAddSample(false)}>
                立即送达
              </button>
              <button type="button" className="lt-mail-btn" disabled={!activeCharacterName} onClick={() => onAddSample(true)}>
                2 分钟后启封
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
