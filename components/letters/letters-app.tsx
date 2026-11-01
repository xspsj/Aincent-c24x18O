"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronLeft, Lock, Mail, Settings2, Trash2, X } from "lucide-react";

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

import { LetterMailSettings } from "./letter-mail-settings";

// 第 2 步：功能完整的基础版信箱（角色切换 / 列表 / 阅读 / 删除 / 设置）。
// 第 3 步会把列表换成抽屉与拆信动画，数据和操作逻辑沿用这里。

type LettersAppProps = {
  onBack: () => void;
  onNotice?: (message: string) => void;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function mailStatusLabel(letter: Letter): string {
  switch (letter.mailStatus) {
    case "none": return "未投递到邮箱";
    case "pending": return isLetterSealed(letter) ? "到拆封时间后投递到邮箱" : "等待投递到邮箱";
    case "sending": return "正在投递到邮箱…";
    case "sent": return letter.mailSentAt ? `已投递到邮箱 · ${formatDateTime(letter.mailSentAt)}` : "已投递到邮箱";
    case "uncertain": return "可能已投递到邮箱，未收到确认";
    case "failed": return "投递到邮箱失败";
    default: return "";
  }
}

export function LettersApp({ onBack, onNotice }: LettersAppProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [letterCharacterIds, setLetterCharacterIds] = useState<string[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Letter | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  // 每 30 秒刷新一次「现在」，定时信到点后自动变成可拆
  const [now, setNow] = useState(() => Date.now());

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

  // 顶部角色：有信的角色在前，其余角色在后（没信也能切过去看「还没有信」）
  const tabs = useMemo(() => {
    const byId = new Map(characters.map(character => [character.id, character]));
    const first = letterCharacterIds
      .map(id => byId.get(id) ?? { id, name: loadLetters(id)[0]?.characterName ?? "角色", avatar: "" } as Character);
    const rest = characters.filter(character => !letterCharacterIds.includes(character.id));
    return [...first, ...rest];
  }, [characters, letterCharacterIds]);

  const activeCharacter = tabs.find(item => item.id === activeCharacterId) ?? null;
  const delivered = letters.filter(letter => !isLetterSealed(letter, now));
  const sealed = letters.filter(letter => isLetterSealed(letter, now)).sort((a, b) => a.unlockAt.localeCompare(b.unlockAt));
  const readingLetter = readingId ? letters.find(letter => letter.id === readingId) ?? null : null;

  const openLetter = (letter: Letter) => {
    if (isLetterSealed(letter, now)) {
      notify(`这封信要到 ${formatDateTime(letter.unlockAt)} 才能拆开。`);
      return;
    }
    markLetterOpened(letter);
    setReadingId(letter.id);
  };

  const handleDelete = (letter: Letter) => {
    deleteLetter(letter.characterId, letter.id);
    setDeleteCandidate(null);
    setReadingId(current => current === letter.id ? null : current);
    notify("信已删除。");
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
    notify(scheduled ? `已放入一封定时信，${formatDateTime(letter.unlockAt)} 可拆。` : "已放入一封示例信。");
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
              onClick={() => { setActiveCharacterId(character.id); setReadingId(null); }}
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

      <main className="lt-body">
        {!mailConfigured ? (
          <button type="button" className="lt-banner" onClick={() => setSettingsOpen(true)}>
            还没配置 QQ 邮箱，信只会留在手机里。点这里去设置。
          </button>
        ) : null}

        {!activeCharacter ? (
          <div className="lt-empty">
            <Mail size={30} strokeWidth={1.4} />
            <p>还没有角色。</p>
          </div>
        ) : letters.length === 0 ? (
          <div className="lt-empty">
            <Mail size={30} strokeWidth={1.4} />
            <p>{activeCharacter.name} 还没有给你写过信。</p>
            <span>想写的时候，TA 会自己提笔。</span>
          </div>
        ) : (
          <>
            {sealed.length > 0 ? (
              <section className="lt-section">
                <h2 className="lt-section-title">待拆封 · {sealed.length}</h2>
                {sealed.map(letter => (
                  <LetterCard key={letter.id} letter={letter} sealed onOpen={() => openLetter(letter)} />
                ))}
              </section>
            ) : null}
            {delivered.length > 0 ? (
              <section className="lt-section">
                <h2 className="lt-section-title">已送达 · {delivered.length}</h2>
                {delivered.map(letter => (
                  <LetterCard key={letter.id} letter={letter} sealed={false} onOpen={() => openLetter(letter)} />
                ))}
              </section>
            ) : null}
          </>
        )}
      </main>

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

function LetterCard({ letter, sealed, onOpen }: { letter: Letter; sealed: boolean; onOpen: () => void }) {
  if (sealed) {
    return (
      <button type="button" className="lt-card is-sealed" onClick={onOpen}>
        <span className="lt-card-icon"><Lock size={16} strokeWidth={1.8} /></span>
        <span className="lt-card-main">
          <strong>一封还不能拆的信</strong>
          <em>{formatDateTime(letter.unlockAt)} 启封</em>
        </span>
      </button>
    );
  }
  const preview = letter.body.replace(/\s+/g, " ").trim();
  return (
    <button type="button" className={`lt-card ${letter.openedAt ? "" : "is-unread"}`} onClick={onOpen}>
      <span className="lt-card-icon"><Mail size={16} strokeWidth={1.8} /></span>
      <span className="lt-card-main">
        <strong>{letter.title}</strong>
        <span className="lt-card-preview">{preview.length > 48 ? `${preview.slice(0, 48)}…` : preview}</span>
        <em>
          {formatDate(letter.unlockAt)}
          {letter.mailStatus === "failed" || letter.mailStatus === "uncertain" ? <span className="lt-card-warn"> · 邮箱投递需处理</span> : null}
        </em>
      </span>
      {!letter.openedAt ? <span className="lt-unread-dot" aria-label="未读" /> : null}
    </button>
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
      <article className="lt-paper" onClick={event => event.stopPropagation()}>
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
              放一封示例信，试试列表、阅读和投递。做完第 4 步后这里会移除。
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
