"use client";

// 天气类全屏特效 Canvas 渲染器：落雪 / 细雨 / 雷雨。
// 共享「大气覆盖层 + 粒子 + 全局时间轴淡入淡出包络」架构，
// 大气覆盖层确保在浅色/深色背景下均清晰可见，播完或组件卸载时自动清理 rAF。

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
    r: number;
    vy: number;
    phase: number;
    amp: number;
    freq: number;
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
            r: (1.8 + Math.random() * 2.8) * scale,
            vy: (0.55 + Math.random() * 0.9) * scale,
            phase: Math.random() * Math.PI * 2,
            amp: (16 + Math.random() * 26) * scale,
            freq: 0.35 + Math.random() * 0.55,
            maxAlpha: 0.75 + Math.random() * 0.25,
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

            // 大气覆盖层：阴天冷调，浅色/深色背景均清晰
            ctx.fillStyle = `rgba(130, 170, 210, ${0.22 * env})`;
            ctx.fillRect(0, 0, W, H);

            for (const f of flakes) {
                f.x += Math.sin(t * f.freq + f.phase) * 0.38 * scale * dt;
                f.y += f.vy * dt;

                // 底部融化：进入底部 15% 后线性淡出
                let meltA = 1;
                const meltStart = H * 0.84;
                if (f.y > meltStart) meltA = Math.max(0, 1 - (f.y - meltStart) / (H * 0.17));

                if (f.y > H + f.r * 2) { f.y = -f.r * 2; f.x = Math.random() * W; }
                if (f.x < -f.r * 5) f.x = W + f.r;
                if (f.x > W + f.r * 5) f.x = -f.r;

                const alpha = f.maxAlpha * env * meltA;
                if (alpha <= 0.015) continue;

                // 外圈柔光晕
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 2.4, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.18})`;
                ctx.fill();

                // 内核：白色实体 + 浅灰描边（浅色背景上也可辨认）
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(140, 180, 215, ${alpha * 0.6})`;
                ctx.lineWidth = 0.7;
                ctx.stroke();
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
const RAIN_TILT = (15 * Math.PI) / 180;
const RAIN_DX = Math.sin(RAIN_TILT);
const RAIN_DY = Math.cos(RAIN_TILT);

type Raindrop = {
    x: number; y: number;
    len: number;
    speed: number;
    maxAlpha: number;
};

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

        const drops: Raindrop[] = Array.from({ length: RAIN_COUNT }, () => ({
            x: Math.random() * (W + 80) - 40,
            y: Math.random() * H,
            len: (16 + Math.random() * 22) * scale,
            speed: (6.5 + Math.random() * 7.5) * scale,
            maxAlpha: 0.42 + Math.random() * 0.38,
        }));

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

            // 大气覆盖层：阴雨深蓝灰，让雨丝在浅色背景下清晰
            const bgA = (0.26 + Math.sin(bgPhase) * 0.025) * env;
            ctx.fillStyle = `rgba(28, 44, 80, ${bgA})`;
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

                // 外圈运动模糊
                ctx.strokeStyle = `rgba(200, 222, 255, ${alpha * 0.25})`;
                ctx.lineWidth = 2.6;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(d.x, d.y);
                ctx.stroke();

                // 内核雨丝
                ctx.strokeStyle = `rgba(210, 232, 255, ${alpha})`;
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
const STORM_TILT = (22 * Math.PI) / 180;
const STORM_DX = Math.sin(STORM_TILT);
const STORM_DY = Math.cos(STORM_TILT);

// 双段式闪电：mainLife=主闪（极亮极短）；glowLife=余光（稍弱缓退）
type LightningFlash = {
    mainAlpha: number;
    mainLife: number;
    mainMaxLife: number;
    glowAlpha: number;
    glowLife: number;
    glowMaxLife: number;
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

        const drops: Raindrop[] = Array.from({ length: STORM_COUNT }, () => ({
            x: Math.random() * (W + 120) - 60,
            y: Math.random() * H,
            len: (22 + Math.random() * 28) * scale,
            speed: (9.5 + Math.random() * 9) * scale,
            maxAlpha: 0.45 + Math.random() * 0.35,
        }));

        const flashes: LightningFlash[] = [];
        // 第一道闪电 500~900ms 内触发，确保 4.2s 动效内用户一定能看到
        let nextFlash = 500 + Math.random() * 400;

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

            // 在 FADE_IN 结束后到 FADE_OUT 开始前触发闪电
            if (elapsed > nextFlash && elapsed < duration - FADE_OUT) {
                flashes.push({
                    mainAlpha: 0.32 + Math.random() * 0.14,  // 主闪：0.32~0.46，浅色背景也显眼
                    mainLife: 5,
                    mainMaxLife: 5,
                    glowAlpha: 0.15 + Math.random() * 0.10,  // 余光：0.15~0.25
                    glowLife: 16,
                    glowMaxLife: 16,
                });
                // 本次动效 4.2s 内至少能看到 2~3 次闪电
                nextFlash = elapsed + 700 + Math.random() * 900;
            }

            ctx.clearRect(0, 0, W, H);

            // 大气覆盖层：深暗暴雨压抑感，浅色背景下也能营造氛围
            ctx.fillStyle = `rgba(12, 20, 48, ${0.42 * env})`;
            ctx.fillRect(0, 0, W, H);

            // 双段式闪电渲染：先画闪光再画雨丝，让雨丝在闪光上面
            for (let i = flashes.length - 1; i >= 0; i--) {
                const f = flashes[i];
                f.mainLife -= dt;
                f.glowLife -= dt;
                if (f.glowLife <= 0) { flashes.splice(i, 1); continue; }

                // 主闪：纯白极亮，极短促（5帧约 83ms）
                if (f.mainLife > 0) {
                    const mt = f.mainLife / f.mainMaxLife;
                    ctx.fillStyle = `rgba(245, 250, 255, ${f.mainAlpha * mt * env})`;
                    ctx.fillRect(0, 0, W, H);
                }

                // 余光：冷蓝紫，二次衰退曲线，更自然
                const gt = f.glowLife / f.glowMaxLife;
                ctx.fillStyle = `rgba(175, 210, 255, ${f.glowAlpha * gt * gt * env})`;
                ctx.fillRect(0, 0, W, H);
            }

            // 暴雨粒子
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
                ctx.strokeStyle = `rgba(200, 222, 255, ${alpha * 0.25})`;
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
