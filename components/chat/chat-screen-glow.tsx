"use client";

// 上浮发光系全屏特效 Canvas 渲染器：浮光气泡 / 夏夜萤火。
// 两者共享「粒子从底部向上浮游 + 呼吸律动 + 时间包络」架构。

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 浮光气泡（Bubbles） ────────────────────────────────────────────
const BUBBLE_COUNT = 22;

type Bubble = {
    x: number; y: number;
    r: number;           // 半径
    vy: number;          // 上浮速度（负方向）
    vx: number;          // 横向漂移
    swayPhase: number;
    swayFreq: number;
    swayAmp: number;
    hueShift: number;    // 虹彩色相偏移（每个泡颜色略不同）
    maxAlpha: number;
    popped: boolean;     // 是否已触发破裂
    popLife: number;     // 破裂粒子剩余帧
    popX: number; popY: number;
};

type PopDrop = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number };

export function BubblesCanvas({ duration }: { duration: number }) {
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

        // 气泡从屏幕底部各位置出发，大小不一
        const bubbles: Bubble[] = Array.from({ length: BUBBLE_COUNT }, () => {
            const r = (10 + Math.random() * 22) * scale;
            return {
                x: Math.random() * W,
                y: H + r + Math.random() * H * 0.4,  // 从底部以下入场，错落时机
                r,
                vy: -(0.55 + Math.random() * 0.7) * scale,   // 大泡慢小泡快（下面按 r 调整）
                vx: (Math.random() - 0.5) * 0.3 * scale,
                swayPhase: Math.random() * Math.PI * 2,
                swayFreq: 0.4 + Math.random() * 0.5,
                swayAmp: (8 + Math.random() * 14) * scale,
                hueShift: Math.random() * 360,
                maxAlpha: 0.55 + Math.random() * 0.3,
                popped: false,
                popLife: 0,
                popX: 0, popY: 0,
            };
        });

        // 大泡速度更慢（反比于半径）
        for (const b of bubbles) {
            b.vy = -(0.4 + 0.7 * (1 - (b.r / (32 * scale)))) * scale;
        }

        const popDrops: PopDrop[] = [];

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 600;
        const FADE_OUT = 900;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);
            const t = elapsed / 1000;

            ctx.clearRect(0, 0, W, H);

            // ── 气泡 ──
            for (const b of bubbles) {
                b.x += Math.sin(t * b.swayFreq + b.swayPhase) * b.swayAmp * 0.02 * dt + b.vx * dt;
                b.y += b.vy * dt;

                // 触顶破裂（进入顶部 10% 区域时）
                if (!b.popped && b.y < H * 0.1) {
                    b.popped = true;
                    b.popX = b.x; b.popY = b.y;
                    // 生成 5~7 颗水滴
                    const dropCount = 5 + Math.floor(Math.random() * 3);
                    for (let i = 0; i < dropCount; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = (0.8 + Math.random() * 1.4) * scale;
                        const life = 18 + Math.random() * 14;
                        popDrops.push({
                            x: b.popX, y: b.popY,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed - 0.5 * scale,
                            life, maxLife: life,
                        });
                    }
                }

                // 破裂后或飞出侧边后重置
                if (b.popped || b.x < -b.r * 3 || b.x > W + b.r * 3) {
                    b.popped = false;
                    b.x = Math.random() * W;
                    b.y = H + b.r + Math.random() * H * 0.3;
                }

                if (b.popped) continue;

                const alpha = b.maxAlpha * env;
                if (alpha <= 0.01) continue;

                // ── 泡泡渲染：3 层叠加 ──

                // 第 1 层：半透明泡体（极淡蓝白）
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(220, 235, 255, ${alpha * 0.12})`;
                ctx.fill();

                // 第 2 层：薄膜虹彩边缘光（渐变描边）
                const rimGrad = ctx.createLinearGradient(b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r);
                rimGrad.addColorStop(0, `hsla(${(b.hueShift) % 360}, 80%, 80%, ${alpha * 0.55})`);
                rimGrad.addColorStop(0.35, `hsla(${(b.hueShift + 80) % 360}, 75%, 85%, ${alpha * 0.40})`);
                rimGrad.addColorStop(0.7, `hsla(${(b.hueShift + 180) % 360}, 80%, 80%, ${alpha * 0.50})`);
                rimGrad.addColorStop(1, `hsla(${(b.hueShift + 260) % 360}, 75%, 82%, ${alpha * 0.45})`);
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
                ctx.strokeStyle = rimGrad;
                ctx.lineWidth = Math.max(1.2, b.r * 0.13);
                ctx.stroke();

                // 第 3 层：左上高光（模拟光源反射）
                const hlX = b.x - b.r * 0.32;
                const hlY = b.y - b.r * 0.32;
                const hlGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, b.r * 0.52);
                hlGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.55})`);
                hlGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
                ctx.fillStyle = hlGrad;
                ctx.fill();
            }

            // ── 破裂水滴 ──
            for (let i = popDrops.length - 1; i >= 0; i--) {
                const d = popDrops[i];
                d.x += d.vx * dt;
                d.y += d.vy * dt;
                d.vy += 0.04 * scale * dt;  // 轻微重力
                d.life -= dt;
                if (d.life <= 0) { popDrops.splice(i, 1); continue; }
                const t2 = d.life / d.maxLife;
                ctx.beginPath();
                ctx.arc(d.x, d.y, Math.max(0.5, 1.8 * scale * t2), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200, 230, 255, ${0.7 * t2 * env})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}

// ── 夏夜萤火（Fireflies） ─────────────────────────────────────────────
const FIREFLY_COUNT = 18;

type Firefly = {
    x: number; y: number;
    vx: number; vy: number;       // 布朗运动基础速度
    breathPhase: number;           // 呼吸律动初相
    breathFreq: number;            // 呼吸频率
    colorHue: number;              // 暖黄(45~55) 或 柔绿(90~110)
    r: number;                     // 光晕半径
    maxAlpha: number;
    // 布朗运动：每隔一段时间随机改变方向
    dirTimer: number;
    dirInterval: number;
    targetVx: number;
    targetVy: number;
};

export function FirefliesCanvas({ duration }: { duration: number }) {
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

        const fireflies: Firefly[] = Array.from({ length: FIREFLY_COUNT }, () => {
            const isGreen = Math.random() < 0.28;  // 约 28% 是柔绿色，其余暖黄
            return {
                x: W * 0.1 + Math.random() * W * 0.8,
                y: H * 0.3 + Math.random() * H * 0.65,  // 主要在屏幕中下区域
                vx: (Math.random() - 0.5) * 0.5 * scale,
                vy: -(0.15 + Math.random() * 0.25) * scale,  // 整体缓缓向上漂
                breathPhase: Math.random() * Math.PI * 2,
                breathFreq: 0.6 + Math.random() * 0.8,
                colorHue: isGreen ? 92 + Math.random() * 18 : 44 + Math.random() * 14,
                r: (4 + Math.random() * 5) * scale,
                maxAlpha: 0.7 + Math.random() * 0.3,
                dirTimer: 0,
                dirInterval: 60 + Math.random() * 80,  // 每 60~140 帧换一次方向
                targetVx: (Math.random() - 0.5) * 0.6 * scale,
                targetVy: -(0.1 + Math.random() * 0.3) * scale,
            };
        });

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 800;
        const FADE_OUT = 1200;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);
            const t = elapsed / 1000;

            ctx.clearRect(0, 0, W, H);

            // 大气覆盖层：深邃夏夜，让微光更突出
            ctx.fillStyle = `rgba(8, 16, 36, ${0.28 * env})`;
            ctx.fillRect(0, 0, W, H);

            for (const f of fireflies) {
                // 布朗运动：定时随机改变目标速度，速度平滑插值
                f.dirTimer += dt;
                if (f.dirTimer >= f.dirInterval) {
                    f.dirTimer = 0;
                    f.dirInterval = 60 + Math.random() * 80;
                    f.targetVx = (Math.random() - 0.5) * 0.6 * scale;
                    f.targetVy = -(0.08 + Math.random() * 0.28) * scale;
                }
                // 平滑插值趋近目标速度
                f.vx += (f.targetVx - f.vx) * 0.04 * dt;
                f.vy += (f.targetVy - f.vy) * 0.04 * dt;

                f.x += f.vx * dt;
                f.y += f.vy * dt;

                // 边界软回弹：靠近边缘时温和推回中心
                if (f.x < W * 0.05) f.targetVx = Math.abs(f.targetVx);
                if (f.x > W * 0.95) f.targetVx = -Math.abs(f.targetVx);
                if (f.y < H * 0.05) f.targetVy = Math.abs(f.targetVy) * 0.5;
                if (f.y > H * 0.95) f.targetVy = -Math.abs(f.targetVy);

                // 呼吸律动：正弦波控制亮度（0.2~1.0 之间呼吸）
                const breath = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * f.breathFreq * Math.PI * 2 + f.breathPhase));
                const alpha = f.maxAlpha * env * breath;
                if (alpha <= 0.015) continue;

                const { hue: h } = { hue: f.colorHue };

                // 外层大光晕（柔和漫射）
                const outerGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 4.5);
                outerGrad.addColorStop(0, `hsla(${h}, 85%, 72%, ${alpha * 0.18})`);
                outerGrad.addColorStop(1, `hsla(${h}, 80%, 65%, 0)`);
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 4.5, 0, Math.PI * 2);
                ctx.fillStyle = outerGrad;
                ctx.fill();

                // 中层光晕
                const midGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 2.2);
                midGrad.addColorStop(0, `hsla(${h}, 90%, 85%, ${alpha * 0.55})`);
                midGrad.addColorStop(1, `hsla(${h}, 85%, 75%, 0)`);
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 2.2, 0, Math.PI * 2);
                ctx.fillStyle = midGrad;
                ctx.fill();

                // 内核：高亮白热中心
                const coreGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 0.7);
                coreGrad.addColorStop(0, `rgba(255, 255, 240, ${alpha * 0.95})`);
                coreGrad.addColorStop(1, `hsla(${h}, 90%, 78%, ${alpha * 0.6})`);
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 0.7, 0, Math.PI * 2);
                ctx.fillStyle = coreGrad;
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}
