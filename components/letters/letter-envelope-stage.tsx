"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Letter } from "@/lib/letter-types";

import { LetterStamp, formatShortDate, formatUnlockTime, hashText, ENVELOPE_TONES, sealInitial } from "./letter-drawer";

// 抽出来的信：从抽屉的位置飞到屏幕中央、横放，带火漆和邮票。
//   第一次点（在抽屉里）：抽出来
//   再点信封：火漆裂开、封口翻开、信纸升起 → 进入阅读
//   待拆封的信：点了只会晃一下

type Phase = "arriving" | "idle" | "opening" | "leaving";

type EnvelopeStageProps = {
  letter: Letter;
  avatar?: string | null;
  sealed: boolean;
  /** 抽屉里那封信的元素。用来算飞出来的起点和放回去的终点。 */
  sourceEl: HTMLElement | null;
  reducedMotion: boolean;
  /** 放回抽屉的动画结束。 */
  onClosed: () => void;
  /** 拆信动画结束，该进入阅读了。 */
  onOpened: () => void;
  onSealedTap: () => void;
};

const ARRIVE_MS = 520;
const LEAVE_MS = 420;
const OPEN_MS = 1150;

/** 抽屉里那封信露出来的高度占整封信的比例（其余被前面的信挡住）。 */
function visibleFraction(slot: HTMLElement): number {
  const rect = slot.getBoundingClientRect();
  if (rect.height <= 0) return 1;
  const next = slot.nextElementSibling as HTMLElement | null;
  const front = slot.closest(".lt-drawer")?.querySelector<HTMLElement>("[data-drawer-front]") ?? null;
  const cover = next ?? front;
  if (!cover) return 1;
  const visible = cover.getBoundingClientRect().top - rect.top;
  return Math.min(1, Math.max(0.12, visible / rect.height));
}

/** 从抽屉位置到屏幕中央的关键帧（抽出：先往上提一点再展平）。 */
function flightKeyframes(source: HTMLElement, target: HTMLElement): Keyframe[] | null {
  if (!source.isConnected) return null;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width <= 0 || to.width <= 0) return null;
  const scale = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const hidden = Math.round((1 - visibleFraction(source)) * 100);
  const lift = Math.min(70, from.height * 0.45);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, clipPath: `inset(0 0 ${hidden}% 0)`, offset: 0 },
    { transform: `translate(${dx}px, ${dy - lift}px) scale(${scale * 1.02})`, clipPath: "inset(0 0 0% 0)", offset: 0.32 },
    { transform: "translate(0px, 0px) scale(1) rotate(-1.2deg)", clipPath: "inset(0 0 0% 0)", offset: 0.82 },
    { transform: "translate(0px, 0px) scale(1) rotate(0deg)", clipPath: "inset(0 0 0% 0)", offset: 1 },
  ];
}

export function LetterEnvelopeStage({
  letter,
  avatar,
  sealed,
  sourceEl,
  reducedMotion,
  onClosed,
  onOpened,
  onSealedTap,
}: EnvelopeStageProps) {
  const envRef = useRef<HTMLButtonElement | null>(null);
  const [phase, setPhase] = useState<Phase>(reducedMotion ? "idle" : "arriving");
  const [shaking, setShaking] = useState(false);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => () => {
    timers.current.forEach(id => window.clearTimeout(id));
    timers.current = [];
  }, []);

  // 抽出来
  useLayoutEffect(() => {
    const env = envRef.current;
    if (reducedMotion || !env || !sourceEl) {
      setPhase("idle");
      return;
    }
    const frames = flightKeyframes(sourceEl, env);
    if (!frames || typeof env.animate !== "function") {
      setPhase("idle");
      return;
    }
    const animation = env.animate(frames, { duration: ARRIVE_MS, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)", fill: "backwards" });
    animation.onfinish = () => setPhase("idle");
    return () => animation.cancel();
    // 只在挂载时飞一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 放回去：同一条路径倒着飞
  const close = useCallback(() => {
    if (phase === "leaving" || phase === "opening") return;
    setPhase("leaving");
    const env = envRef.current;
    const frames = !reducedMotion && env && sourceEl ? flightKeyframes(sourceEl, env) : null;
    if (!env || !frames || typeof env.animate !== "function") {
      onClosed();
      return;
    }
    const reversed = frames.slice().reverse().map(frame => ({ ...frame, offset: 1 - Number(frame.offset) }));
    const animation = env.animate(reversed, { duration: LEAVE_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0.2)", fill: "forwards" });
    animation.onfinish = onClosed;
  }, [onClosed, phase, reducedMotion, sourceEl]);

  const handleEnvelopeTap = () => {
    if (phase !== "idle") return;
    if (sealed) {
      setShaking(false);
      // 下一帧再加上，连点时动画能重新播
      requestAnimationFrame(() => setShaking(true));
      later(() => setShaking(false), 500);
      onSealedTap();
      return;
    }
    setPhase("opening");
    later(onOpened, reducedMotion ? 0 : OPEN_MS);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const tone = hashText(letter.id) % ENVELOPE_TONES;
  const initial = sealInitial(letter.characterName);
  const hint = sealed
    ? `${formatUnlockTime(letter.unlockAt)} 才能拆开`
    : "点一下信封，拆开它";

  return (
    <div
      className={`lt-stage is-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={sealed ? "待拆封的信" : `${letter.characterName} 的信`}
      onClick={close}
    >
      <div className="lt-stage-center" onClick={event => event.stopPropagation()}>
        <button
          ref={envRef}
          type="button"
          className={`lt-env ${phase === "opening" ? "is-open" : ""} ${sealed ? "is-locked" : ""} ${shaking ? "is-shaking" : ""}`}
          data-tone={tone}
          onClick={handleEnvelopeTap}
          aria-label={sealed ? `还不能拆，${formatUnlockTime(letter.unlockAt)} 启封` : "拆开这封信"}
        >
          <span className="lt-env-back" aria-hidden="true" />
          <span className="lt-env-paper" aria-hidden="true">
            <span className="lt-env-paper-title">{sealed ? "" : letter.title}</span>
          </span>
          <span className="lt-env-pocket" aria-hidden="true" />
          <span className="lt-env-flap" aria-hidden="true" />
          <span className="lt-env-meta" aria-hidden="true">
            <span className="lt-env-from">From · {letter.characterName}</span>
            <span className="lt-env-date">{formatShortDate(letter.createdAt)}</span>
          </span>
          <span className="lt-env-stamp" aria-hidden="true">
            <LetterStamp avatar={avatar} name={letter.characterName} size="lg" postmarkDate={formatShortDate(letter.createdAt)} />
          </span>
          <span className="lt-env-seal" aria-hidden="true">
            <span className="lt-env-seal-half is-left"><span>{initial}</span></span>
            <span className="lt-env-seal-half is-right"><span>{initial}</span></span>
          </span>
          {sealed ? (
            <span className="lt-env-ribbon" aria-hidden="true">{formatUnlockTime(letter.unlockAt)} 启封</span>
          ) : null}
        </button>
        <p className="lt-stage-hint" aria-live="polite">{hint}</p>
        <button type="button" className="lt-stage-back" onClick={close}>放回抽屉</button>
      </div>
    </div>
  );
}
