"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Lock, TriangleAlert } from "lucide-react";

import { isLetterSealed } from "@/lib/letter-storage";
import type { Letter } from "@/lib/letter-types";

// 抽屉：信竖着一封封插在里面，只露出上沿。越新的信越靠前（越靠下、越完整）。

export function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** 每封信固定的信封纸色，由 id 决定，刷新后不会变。 */
export const ENVELOPE_TONES = 5;

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function formatUnlockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function sealInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "信";
}

export function LetterStamp({ avatar, name, size, postmarkDate }: {
  avatar?: string | null;
  name: string;
  size: "sm" | "lg";
  postmarkDate?: string;
}) {
  return (
    <span className={`lt-stamp lt-stamp-${size}`} aria-hidden="true">
      <span className="lt-stamp-face">
        {avatar ? <img src={avatar} alt="" /> : <span className="lt-stamp-initial">{sealInitial(name)}</span>}
      </span>
      {size === "lg" && postmarkDate ? (
        <span className="lt-postmark">
          <span>{postmarkDate}</span>
          <span>AIR MAIL</span>
        </span>
      ) : null}
    </span>
  );
}

type LetterDrawerProps = {
  /** 新的在前（与 loadLetters 一致）。 */
  letters: Letter[];
  characterName: string;
  avatar?: string | null;
  now: number;
  /** 正被抽出来的信：在抽屉里留出空位。 */
  hiddenLetterId: string | null;
  onPull: (letter: Letter, slot: HTMLButtonElement) => void;
};

export function LetterDrawer({ letters, characterName, avatar, now, hiddenLetterId, onPull }: LetterDrawerProps) {
  const wellRef = useRef<HTMLDivElement | null>(null);
  // 旧的在后、新的在前：DOM 顺序从旧到新，后面的盖住前面的
  const ordered = [...letters].reverse();
  const sealedCount = letters.filter(letter => isLetterSealed(letter, now)).length;

  // 打开抽屉时停在最前面（最新的那封）
  useLayoutEffect(() => {
    const well = wellRef.current;
    if (well) well.scrollTop = well.scrollHeight;
  }, [letters.length]);

  return (
    <div className="lt-drawer">
      <div className="lt-drawer-well" ref={wellRef}>
        {ordered.length === 0 ? (
          <p className="lt-drawer-empty">
            抽屉还是空的。<br />
            {characterName} 想写的时候，会自己提笔。
          </p>
        ) : (
          ordered.map((letter, index) => (
            <LetterSlot
              key={letter.id}
              letter={letter}
              avatar={avatar}
              sealed={isLetterSealed(letter, now)}
              hidden={letter.id === hiddenLetterId}
              isFront={index === ordered.length - 1}
              onPull={onPull}
            />
          ))
        )}
      </div>
      <div className="lt-drawer-front" data-drawer-front="">
        <span className="lt-drawer-label">
          <strong>{characterName}</strong>
          <em>{letters.length} 封{sealedCount ? ` · ${sealedCount} 封待拆` : ""}</em>
        </span>
        <span className="lt-drawer-handle" aria-hidden="true" />
      </div>
    </div>
  );
}

type LetterSlotProps = {
  letter: Letter;
  avatar?: string | null;
  sealed: boolean;
  hidden: boolean;
  isFront: boolean;
  onPull: (letter: Letter, slot: HTMLButtonElement) => void;
};

function LetterSlot({ letter, avatar, sealed, hidden, isFront, onPull }: LetterSlotProps) {
  const hash = hashText(letter.id);
  const style = {
    "--lt-tilt": `${((hash % 7) - 3) * 0.35}deg`,
    "--lt-shift": `${((hash >> 3) % 9) - 4}px`,
  } as CSSProperties;
  const needsAttention = letter.mailStatus === "failed" || letter.mailStatus === "uncertain";
  const label = sealed
    ? `待拆封的信，${formatUnlockTime(letter.unlockAt)} 启封`
    : `${letter.title}，${formatShortDate(letter.unlockAt)}${letter.openedAt ? "" : "，未读"}`;

  return (
    <button
      type="button"
      className={`lt-slot ${sealed ? "is-sealed" : ""} ${hidden ? "is-hidden" : ""} ${isFront ? "is-front" : ""}`}
      data-tone={hash % ENVELOPE_TONES}
      style={style}
      aria-label={label}
      onClick={event => onPull(letter, event.currentTarget)}
    >
      <span className="lt-slot-flap" aria-hidden="true" />
      <span className="lt-slot-top">
        <span className="lt-slot-date">{formatShortDate(letter.createdAt)}</span>
        <span className="lt-slot-title">
          {sealed ? (
            <><Lock size={12} strokeWidth={2} /> {formatUnlockTime(letter.unlockAt)} 启封</>
          ) : letter.title}
        </span>
        {needsAttention ? <TriangleAlert size={13} className="lt-slot-warn" aria-hidden="true" /> : null}
        {!sealed && !letter.openedAt ? <span className="lt-slot-unread" aria-hidden="true" /> : null}
        <LetterStamp avatar={avatar} name={letter.characterName} size="sm" />
      </span>
      <span className="lt-slot-seal" aria-hidden="true">{sealInitial(letter.characterName)}</span>
    </button>
  );
}
