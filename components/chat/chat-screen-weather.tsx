"use client";

// 天气类全屏特效 Canvas 渲染器：落雪 / 细雨 / 雷雨。
// 共享同一套「粒子 + 全局时间轴淡入淡出包络」架构，播完或组件卸载时自动清理 rAF。

import { useEffect, useRef } from "react";

// ── 共用时间包络 ────────────────────────────────────────────────────
function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 落雪（Snow） ────────────────────────────────────────────────────
const SNOW_COUNT = 52;

type Snowflake = {
    x: number; y: number;
    r: number;      // 半径
    vy: number;     // 下落速度
    phase: number;  // 正弦波初相（微风漂移）
    amp: number;    // 漂移幅度
    freq: number;   // 微风频率
    maxAlpha: number;
};

export function SnowCanvas({ duration }: { duration: number }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const W = Math.max(1, rect.width);
        const H = Math.max(1, rect.height);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.scale(dpr, dpr);
        const scale = H / 800;

        const flakes: Snowflake[] = Array.from({ length: SNOW_COUNT }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            r: (1.6 + Math.random() * 2.8) * scale,
            vy: (0.55 + Math.random() * 0.9) * scale,
            phase: Math.random() * Math.PI * 2,
            amp: (16 + Math.random() * 26) * scale,
            freq: 0.35 + Math.random() * 0.55,
            maxAlpha: 0.55 + Math.random() * 0.45,
        }));

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 700;
        const FADE_OUT = 1000;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);

            ctx.clearRect(0, 0, W, H);
            const t = elapsed / 1000;

            for (const f of flakes) {
                // 正弦微风漂移 + 匀速下落
                f.x += Math.sin(t * f.freq + f.phase) * 0.38 * scale * dt;
                f.y += f.vy * dt;

                // 底部融化：进入底部 15% 区域后线性淡出
                let meltA = 1;
                const meltStart = H * 0.84;
                if (f.y > meltStart) meltA = Math.max(0, 1 - (f.y - meltStart) / (H * 0.17));

                // 超出边界后重置到顶部
                if (f.y > H + f.r * 2) { f.y = -f.r * 2; f.x = Math.random() * W; }
                if (f.x < -f.r * 5) f.x = W + f.r;
                if (f.x > W + f.r * 5) f.x = -f.r;

                const alpha = f.maxAlpha * env * meltA;
                if (alpha <= 0.015) continue;

                // 外圈柔光晕（两倍半径、极淡）
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 2.4, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.11})`;
                ctx.fill();

                // 内核雪绒圆
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(238, 248, 255, ${alpha * 0.92})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}

// ── 细雨（Rain） ────────────────────────────────────────────────────
const RAIN_COUNT = 88;
// 倾斜角：15° 偏右（从垂直方向），细雨感
const RAIN_TILT = (15 * Math.PI) / 180;
const RAIN_DX = Math.sin(RAIN_TILT);  // ~0.259
const RAIN_DY = Math.cos(RAIN_TILT);  // ~0.966

type Raindrop = {
    x: number; y: number;
    len: number;    // 雨丝视觉长度
    speed: number;  // 每帧移动速度
    maxAlpha: number;
};

function makeDrops(W: number, H: number, count: number, scale: number): Raindrop[] {
    return Array.from({ length: count }, () => ({
        x: Math.random() * (W + 80) - 40,
        y: Math.random() * H,
        len: (16 + Math.random() * 22) * scale,
        speed: (6.5 + Math.random() * 7.5) * scale,
        maxAlpha: 0.14 + Math.random() * 0.32,
    }));
}

export function RainCanvas({ duration }: { duration: number }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const W = Math.max(1, rect.width);
        const H = Math.max(1, rect.height);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.scale(dpr, dpr);
        const scale = H / 800;

        const drops = makeDrops(W, H, RAIN_COUNT, scale);

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 500;
        const FADE_OUT = 700;
        let bgPhase = 0;

        ctx.lineCap = "round";

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);

            ctx.clearRect(0, 0, W, H);
            bgPhase += 0.01 * dt;

            // 极轻微的背景暗色律动（阴雨天光线感）
            const bgA = (0.016 + Math.sin(bgPhase) * 0.007) * env;
            ctx.fillStyle = `rgba(18, 26, 48, ${bgA})`;
            ctx.fillRect(0, 0, W, H);

            for (const d of drops) {
                d.x += RAIN_DX * d.speed * dt;
                d.y += RAIN_DY * d.speed * dt;

                if (d.y > H + 12 || d.x > W + 60) {
                    d.y = -d.len;
                    d.x = Math.random() * (W + 80) - 40;
                }

                const alpha = d.maxAlpha * env;
                if (alpha <= 0.01) continue;

                const x0 = d.x - RAIN_DX * d.len;
                const y0 = d.y - RAIN_DY * d.len;

                // 外圈运动模糊（宽线、极淡）
                ctx.strokeStyle = `rgba(200, 222, 255, ${alpha * 0.18})`;
                ctx.lineWidth = 2.6;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(d.x, d.y);
                ctx.stroke();

                // 内核雨丝（细线、清晰）
                ctx.strokeStyle = `rgba(218, 234, 255, ${alpha})`;
                ctx.lineWidth = 0.9;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(d.x, d.y);
                ctx.stroke();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}

// ── 雷雨（Thunderstorm） ────────────────────────────────────────────
const STORM_COUNT = 118;
// 稍微更大的倾斜角（22°），暴雨感
const STORM_TILT = (22 * Math.PI) / 180;
const STORM_DX = Math.sin(STORM_TILT);  // ~0.374
const STORM_DY = Math.cos(STORM_TILT);  // ~0.927

type LightningFlash = {
    alpha: number;
    life: number;
    maxLife: number;
};

export function ThunderstormCanvas({ duration }: { duration: number }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const W = Math.max(1, rect.width);
        const H = Math.max(1, rect.height);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.scale(dpr, dpr);
        const scale = H / 800;

        // 暴雨粒子：更多、更快、更长
        const drops = Array.from({ length: STORM_COUNT }, (): Raindrop => ({
            x: Math.random() * (W + 120) - 60,
            y: Math.random() * H,
            len: (22 + Math.random() * 28) * scale,
            speed: (9.5 + Math.random() * 9) * scale,
            maxAlpha: 0.18 + Math.random() * 0.36,
        }));

        const flashes: LightningFlash[] = [];
        let nextFlash = 700 + Math.random() * 1000;

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 400;
        const FADE_OUT = 700;

        ctx.lineCap = "round";

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);

            // 在动效中段才触发闪电
            if (elapsed > nextFlash && elapsed < duration - 900) {
                flashes.push({ alpha: 0.07 + Math.random() * 0.05, life: 9, maxLife: 9 });
                nextFlash = elapsed + 850 + Math.random() * 1300;
            }

            ctx.clearRect(0, 0, W, H);

            // 暴雨背景底色（更深）
            ctx.fillStyle = `rgba(10, 16, 36, ${0.042 * env})`;
            ctx.fillRect(0, 0, W, H);

            // 闪电全屏冷蓝柔光（先快入、后缓出）
            for (let i = flashes.length - 1; i >= 0; i--) {
                const f = flashes[i];
                f.life -= dt;
                if (f.life <= 0) { flashes.splice(i, 1); continue; }
                const t = f.life / f.maxLife;
                const flashA = f.alpha * (t > 0.5 ? 1 : t * 2) * env;
                ctx.fillStyle = `rgba(195, 218, 255, ${flashA})`;
                ctx.fillRect(0, 0, W, H);
            }

            for (const d of drops) {
                d.x += STORM_DX * d.speed * dt;
                d.y += STORM_DY * d.speed * dt;

                if (d.y > H + 14 || d.x > W + 90) {
                    d.y = -d.len;
                    d.x = Math.random() * (W + 100) - 50;
                }

                const alpha = d.maxAlpha * env;
                if (alpha <= 0.01) continue;

                const x0 = d.x - STORM_DX * d.len;
                const y0 = d.y - STORM_DY * d.len;

                // 运动模糊外圈
                ctx.strokeStyle = `rgba(200, 222, 255, ${alpha * 0.2})`;
                ctx.lineWidth = 2.8;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(d.x, d.y);
                ctx.stroke();

                // 内核雨丝
                ctx.strokeStyle = `rgba(218, 234, 255, ${alpha})`;
                ctx.lineWidth = 1.1;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(d.x, d.y);
                ctx.stroke();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}
