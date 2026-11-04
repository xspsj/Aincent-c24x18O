"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Lock, Trash2, TriangleAlert } from "lucide-react";

import { isLetterSealed } from "@/lib/letter-storage";
import type { Letter } from "@/lib/letter-types";

export function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

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

export function LetterStamp({
  avatar,
  name,
  size,
  postmarkDate,
}: {
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

type LetterDragState = {
  letter: Letter;
  x: number;
  y: number;
  width: number;
  height: number;
  isOverTrash: boolean;
};

type LetterDragSession = {
  letter: Letter;
  pointerId: number;
  target: HTMLButtonElement;
  startX: number;
  startY: number;
  width: number;
  height: number;
  timer: number | null;
  dragging: boolean;
};

type LetterDrawerProps = {
  letters: Letter[];
  characterName: string;
  avatar?: string | null;
  now: number;
  hiddenLetterId: string | null;
  onPull: (letter: Letter, slot: HTMLButtonElement) => void;
  onRequestDelete: (letter: Letter) => void;
};

export function LetterDrawer({
  letters,
  characterName,
  avatar,
  now,
  hiddenLetterId,
  onPull,
  onRequestDelete,
}: LetterDrawerProps) {
  const wellRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<LetterDragState | null>(null);

  const dragSessionRef = useRef<LetterDragSession | null>(null);
  const clickSuppressedRef = useRef(false);
  const clickSuppressTimerRef = useRef<number | null>(null);

  const ordered = [...letters].reverse();
  const sealedCount = letters.filter(letter => isLetterSealed(letter, now)).length;

  useLayoutEffect(() => {
    const well = wellRef.current;
    if (well) well.scrollTop = well.scrollHeight;
  }, [letters.length]);

  const clearDragTimer = useCallback(() => {
    if (dragSessionRef.current?.timer != null) {
      window.clearTimeout(dragSessionRef.current.timer);
      dragSessionRef.current.timer = null;
    }
  }, []);

  const suppressClick = useCallback((duration = 700) => {
    if (clickSuppressTimerRef.current != null) {
      window.clearTimeout(clickSuppressTimerRef.current);
    }
    clickSuppressedRef.current = true;
    clickSuppressTimerRef.current = window.setTimeout(() => {
      clickSuppressedRef.current = false;
      clickSuppressTimerRef.current = null;
    }, duration);
  }, []);

  const checkIsOverTrash = useCallback((clientX: number, clientY: number, width: number, height: number) => {
    const trashRect = trashRef.current?.getBoundingClientRect();
    if (!trashRect) return false;
    const rect = {
      left: clientX - width / 2,
      right: clientX + width / 2,
      top: clientY - height / 2,
      bottom: clientY + height / 2,
    };
    return (
      rect.left < trashRect.right &&
      rect.right > trashRect.left &&
      rect.top < trashRect.bottom &&
      rect.bottom > trashRect.top
    );
  }, []);

  const resetDrag = useCallback(() => {
    clearDragTimer();
    const session = dragSessionRef.current;
    if (session?.dragging) {
      suppressClick();
    }
    if (session) {
      try {
        session.target.releasePointerCapture(session.pointerId);
      } catch {
        // Pointer capture may already be released
      }
    }
    dragSessionRef.current = null;
    setDragState(null);
  }, [clearDragTimer, suppressClick]);

  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      const session = dragSessionRef.current;
      if (!session) return;
      const shouldDelete =
        session.dragging && checkIsOverTrash(clientX, clientY, session.width, session.height);
      const letter = session.letter;
      resetDrag();
      if (shouldDelete) {
        onRequestDelete(letter);
      }
    },
    [checkIsOverTrash, onRequestDelete, resetDrag],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>, letter: Letter) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // 阻止 iOS Safari 把长按手势当成外层可滚动容器的滚动行为
      event.preventDefault();
      clearDragTimer();
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();

      dragSessionRef.current = {
        letter,
        pointerId: event.pointerId,
        target,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width,
        height: rect.height,
        timer: window.setTimeout(() => {
          const session = dragSessionRef.current;
          if (!session || session.pointerId !== event.pointerId || session.dragging) return;
          session.dragging = true;
          session.timer = null;
          suppressClick(900);
          try {
            session.target.setPointerCapture(session.pointerId);
          } catch {
            // Touch capture fallback
          }
          setDragState({
            letter: session.letter,
            x: event.clientX,
            y: event.clientY,
            width: session.width,
            height: session.height,
            isOverTrash: checkIsOverTrash(event.clientX, event.clientY, session.width, session.height),
          });
        }, 380),
        dragging: false,
      };
    },
    [checkIsOverTrash, clearDragTimer, suppressClick],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (!session.dragging) {
        if (Math.hypot(dx, dy) > 8) {
          clearDragTimer();
          dragSessionRef.current = null;
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDragState({
        letter: session.letter,
        x: event.clientX,
        y: event.clientY,
        width: session.width,
        height: session.height,
        isOverTrash: checkIsOverTrash(event.clientX, event.clientY, session.width, session.height),
      });
    },
    [checkIsOverTrash, clearDragTimer],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      finishDrag(event.clientX, event.clientY);
    },
    [finishDrag],
  );

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      resetDrag();
    },
    [resetDrag],
  );

  useEffect(() => {
    if (!dragState) return;
    const onWinMove = (e: globalThis.PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s?.dragging || s.pointerId !== e.pointerId) return;
      e.preventDefault();
      setDragState({
        letter: s.letter,
        x: e.clientX,
        y: e.clientY,
        width: s.width,
        height: s.height,
        isOverTrash: checkIsOverTrash(e.clientX, e.clientY, s.width, s.height),
      });
    };
    const onWinUp = (e: globalThis.PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      e.preventDefault();
      finishDrag(e.clientX, e.clientY);
    };
    const onWinCancel = (e: globalThis.PointerEvent) => {
      const s = dragSessionRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      resetDrag();
    };
    window.addEventListener("pointermove", onWinMove, { passive: false });
    window.addEventListener("pointerup", onWinUp, { passive: false });
    window.addEventListener("pointercancel", onWinCancel);
    return () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinCancel);
    };
  }, [checkIsOverTrash, dragState, finishDrag, resetDrag]);

  return (
    <div className={`lt-drawer ${dragState ? "is-dragging" : ""}`}>
      <div className="lt-drawer-well" ref={wellRef}>
        {ordered.length === 0 ? (
          <p className="lt-drawer-empty">
            抽屉还是空的。<br />
            {characterName} 想写的时候，会自己提笔。
          </p>
        ) : (
          ordered.map((letter, index) => {
            const isDragSource = dragState?.letter.id === letter.id;
            return (
              <LetterSlot
                key={letter.id}
                letter={letter}
                avatar={avatar}
                sealed={isLetterSealed(letter, now)}
                hidden={letter.id === hiddenLetterId}
                isFront={index === ordered.length - 1}
                isDragSource={isDragSource}
                onPointerDown={e => handlePointerDown(e, letter)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onClick={slotEl => {
                  if (clickSuppressedRef.current) return;
                  onPull(letter, slotEl);
                }}
              />
            );
          })
        )}
      </div>

      <div className="lt-drawer-front" data-drawer-front="">
        <span className="lt-drawer-label">
          <strong>{characterName}</strong>
          <em>
            {letters.length} 封{sealedCount ? ` · ${sealedCount} 封待拆` : ""}
          </em>
        </span>
        <span className="lt-drawer-handle" aria-hidden="true" />
      </div>

      {/* 底部升起的红色垃圾桶（拖拽时显示） */}
      <div
        ref={trashRef}
        className={`lt-drawer-trash ${dragState ? "is-visible" : ""} ${dragState?.isOverTrash ? "is-over" : ""}`}
        aria-hidden={!dragState}
      >
        <Trash2 size={28} strokeWidth={1.8} />
      </div>

      {/* 随手指滑动的半透明虚影信封 */}
      {dragState ? (
        <div
          className="lt-slot lt-drag-ghost"
          style={{
            left: dragState.x,
            top: dragState.y,
            width: dragState.width,
            height: dragState.height,
          }}
        >
          <span className="lt-slot-flap" aria-hidden="true" />
          <span className="lt-slot-top">
            <span className="lt-slot-date">{formatShortDate(dragState.letter.createdAt)}</span>
            <span className="lt-slot-title">{dragState.letter.title}</span>
          </span>
          <span className="lt-slot-seal" aria-hidden="true">
            {sealInitial(dragState.letter.characterName)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type LetterSlotProps = {
  letter: Letter;
  avatar?: string | null;
  sealed: boolean;
  hidden: boolean;
  isFront: boolean;
  isDragSource?: boolean;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => void;
  onClick: (slot: HTMLButtonElement) => void;
};

function LetterSlot({
  letter,
  avatar,
  sealed,
  hidden,
  isFront,
  isDragSource,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
}: LetterSlotProps) {
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
      className={`lt-slot ${sealed ? "is-sealed" : ""} ${hidden ? "is-hidden" : ""} ${isFront ? "is-front" : ""} ${
        isDragSource ? "is-drag-source" : ""
      }`}
      data-tone={hash % ENVELOPE_TONES}
      style={style}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={e => onClick(e.currentTarget)}
      onContextMenu={e => e.preventDefault()}
    >
      <span className="lt-slot-flap" aria-hidden="true" />
      <span className="lt-slot-top">
        <span className="lt-slot-date">{formatShortDate(letter.createdAt)}</span>
        <span className="lt-slot-title">
          {sealed ? (
            <>
              <Lock size={12} strokeWidth={2} /> {formatUnlockTime(letter.unlockAt)} 启封
            </>
          ) : (
            letter.title
          )}
        </span>
        {needsAttention ? <TriangleAlert size={13} className="lt-slot-warn" aria-hidden="true" /> : null}
        {!sealed && !letter.openedAt ? <span className="lt-slot-unread" aria-hidden="true" /> : null}
        <LetterStamp avatar={avatar} name={letter.characterName} size="sm" />
      </span>
      <span className="lt-slot-seal" aria-hidden="true">
        {sealInitial(letter.characterName)}
      </span>
    </button>
  );
}
