"use client";

// 翻转飘落系全屏特效 Canvas 渲染器：落叶（秋）/ 落樱（春）。
// 修复：初始 y 分散在全屏范围，确保下半屏也有粒子；叶片形状改用贝塞尔尖角叶形。

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 通用叶片粒子类型 ────────────────────────────────────────────────
type Leaf = {
    x: number; y: number;
    vx: number; vy: number;
    swayPhase: number;
    swayAmp: number;
    swayFreq: number;
    rotX: number;
    rotZ: number;
    rotXSpeed: number;
    rotZSpeed: number;
    size: number;
    colorIdx: number;
    maxAlpha: number;
};

// ── 落叶（Autumn Leaves） ──────────────────────────────────────────
const LEAF_COUNT = 32;

const LEAF_COLORS = [
    "#c0392b", // 深枫红
    "#e74c3c", // 亮枫红
    "#e67e22", // 橙
    "#f39c12", // 暖黄橙
    "#d4a847", // 金黄
    "#a04020", // 橙褐
];

function drawAutumnLeaf(ctx: CanvasRenderingContext2D, size: number, color: string, alpha: number) {
    // 尖角叶形：两段对称贝塞尔，顶端和底端都是尖的
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;

    ctx.beginPath();
    // 从底部尖端出发 → 左弧 → 顶部尖端 → 右弧 → 回到底部
    ctx.moveTo(0, size);                                         // 底尖
    ctx.bezierCurveTo(-size * 0.8, size * 0.4, -size * 0.7, -size * 0.6, 0, -size); // 左侧弧
    ctx.bezierCurveTo(size * 0.7, -size * 0.6, size * 0.8, size * 0.4, 0, size);    // 右侧弧
    ctx.closePath();
    ctx.fill();

    // 叶脉：中央主脉
    ctx.beginPath();
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.18})`;
    ctx.lineWidth = size * 0.08;
    ctx.moveTo(0, size * 0.9);
    ctx.lineTo(0, -size * 0.9);
    ctx.stroke();

    // 叶脉：两侧分支（3对）
    ctx.lineWidth = size * 0.04;
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.12})`;
    for (let i = 1; i <= 3; i++) {
        const yBase = -size * 0.6 + i * size * 0.4;
        const xTip = size * 0.55;
        ctx.beginPath(); ctx.moveTo(0, yBase); ctx.lineTo(-xTip, yBase - size * 0.22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, yBase); ctx.lineTo(xTip, yBase - size * 0.22); ctx.stroke();
    }

    // 叶茎
    ctx.beginPath();
    ctx.strokeStyle = `rgba(80, 40, 10, ${alpha * 0.5})`;
    ctx.lineWidth = size * 0.07;
    ctx.moveTo(0, size * 0.9);
    ctx.lineTo(0, size * 1.5);
    ctx.stroke();

    ctx.globalAlpha = 1;
}

export function AutumnLeavesCanvas({ duration }: { duration: number }) {
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

        const leaves: Leaf[] = Array.from({ length: LEAF_COUNT }, (_, i) => ({
            x: Math.random() * W,
            // 关键修复：初始 y 均匀分散在全屏，前 1/3 粒子从顶部以上入场，其余散布全屏
            y: i < LEAF_COUNT / 3 ? -20 - Math.random() * 80 : Math.random() * H,
            vx: (Math.random() - 0.5) * 0.9 * scale,
            vy: (1.4 + Math.random() * 1.4) * scale,   // 下落速度提升，确保能穿越全屏
            swayPhase: Math.random() * Math.PI * 2,
            swayAmp: (20 + Math.random() * 28) * scale,
            swayFreq: 0.4 + Math.random() * 0.5,
            rotX: Math.random() * Math.PI * 2,
            rotZ: (Math.random() - 0.5) * 0.6,
            rotXSpeed: (0.025 + Math.random() * 0.035) * (Math.random() < 0.5 ? 1 : -1),
            rotZSpeed: (0.008 + Math.random() * 0.012) * (Math.random() < 0.5 ? 1 : -1),
            size: (8 + Math.random() * 8) * scale,
            colorIdx: Math.floor(Math.random() * LEAF_COLORS.length),
            maxAlpha: 0.75 + Math.random() * 0.25,
        }));

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 600;
        const FADE_OUT = 1000;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);
            const t = elapsed / 1000;

            ctx.clearRect(0, 0, W, H);

            // 大气覆盖层：秋日暖橙微光
            ctx.fillStyle = `rgba(60, 30, 10, ${0.09 * env})`;
            ctx.fillRect(0, 0, W, H);

            for (const leaf of leaves) {
                leaf.x += Math.sin(t * leaf.swayFreq + leaf.swayPhase) * leaf.swayAmp * 0.022 * dt + leaf.vx * dt;
                leaf.y += leaf.vy * dt;
                leaf.rotX += leaf.rotXSpeed * dt;
                leaf.rotZ += leaf.rotZSpeed * dt;

                if (leaf.y > H + 40) { leaf.y = -20; leaf.x = Math.random() * W; }
                if (leaf.x < -50) leaf.x = W + 30;
                if (leaf.x > W + 50) leaf.x = -30;

                const alpha = leaf.maxAlpha * env;
                if (alpha <= 0.01) continue;

                ctx.save();
                ctx.translate(leaf.x, leaf.y);
                ctx.rotate(leaf.rotZ);
                const flipX = Math.cos(leaf.rotX);
                ctx.scale(flipX, 1);

                // 背面颜色暗一档
                const drawAlpha = flipX < 0 ? alpha * 0.6 : alpha;
                drawAutumnLeaf(ctx, leaf.size, LEAF_COLORS[leaf.colorIdx], drawAlpha);
                ctx.restore();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}

// ── 落樱（Sakura） ────────────────────────────────────────────────────
const SAKURA_COUNT = 38;

const SAKURA_COLORS = [
    "#fde8f0",
    "#f9c8db",
    "#f4a7c0",
    "#f0c0d0",
    "#ffffff",
];

function drawSakuraPetal(ctx: CanvasRenderingContext2D, size: number, color: string, alpha: number) {
    // 花瓣形：上宽下尖，顶端带轻微凹口（心形感）
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = `rgba(200, 130, 150, ${alpha * 0.28})`;
    ctx.lineWidth = 0.5;

    ctx.beginPath();
    ctx.moveTo(0, size);                                                      // 底尖
    ctx.bezierCurveTo(-size * 0.75, size * 0.3, -size * 0.85, -size * 0.4, -size * 0.3, -size * 0.7); // 左弧到左上
    ctx.bezierCurveTo(-size * 0.1, -size * 1.05, size * 0.1, -size * 1.05, size * 0.3, -size * 0.7);  // 顶部微凹
    ctx.bezierCurveTo(size * 0.85, -size * 0.4, size * 0.75, size * 0.3, 0, size);                    // 右弧回底
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 中央纹路
    ctx.beginPath();
    ctx.strokeStyle = `rgba(210, 140, 160, ${alpha * 0.22})`;
    ctx.lineWidth = 0.4;
    ctx.moveTo(0, size * 0.85);
    ctx.lineTo(0, -size * 0.6);
    ctx.stroke();

    ctx.globalAlpha = 1;
}

export function SakuraCanvas({ duration }: { duration: number }) {
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

        const petals: Leaf[] = Array.from({ length: SAKURA_COUNT }, (_, i) => ({
            x: Math.random() * W,
            y: i < SAKURA_COUNT / 3 ? -20 - Math.random() * 80 : Math.random() * H,
            vx: (0.4 + Math.random() * 0.5) * scale,
            vy: (0.9 + Math.random() * 1.0) * scale,
            swayPhase: Math.random() * Math.PI * 2,
            swayAmp: (28 + Math.random() * 34) * scale,
            swayFreq: 0.32 + Math.random() * 0.42,
            rotX: Math.random() * Math.PI * 2,
            rotZ: (Math.random() - 0.5) * 0.5,
            rotXSpeed: (0.018 + Math.random() * 0.026) * (Math.random() < 0.5 ? 1 : -1),
            rotZSpeed: (0.006 + Math.random() * 0.010) * (Math.random() < 0.5 ? 1 : -1),
            size: (6 + Math.random() * 6) * scale,
            colorIdx: Math.floor(Math.random() * SAKURA_COLORS.length),
            maxAlpha: 0.70 + Math.random() * 0.30,
        }));

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 700;
        const FADE_OUT = 1100;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);
            const t = elapsed / 1000;

            ctx.clearRect(0, 0, W, H);

            // 大气覆盖层：春日樱粉柔光
            ctx.fillStyle = `rgba(255, 220, 235, ${0.10 * env})`;
            ctx.fillRect(0, 0, W, H);

            for (const petal of petals) {
                petal.x += Math.sin(t * petal.swayFreq + petal.swayPhase) * petal.swayAmp * 0.022 * dt + petal.vx * dt;
                petal.y += petal.vy * dt;
                petal.rotX += petal.rotXSpeed * dt;
                petal.rotZ += petal.rotZSpeed * dt;

                if (petal.y > H + 30) { petal.y = -20; petal.x = Math.random() * W; }
                if (petal.x < -50) petal.x = W + 30;
                if (petal.x > W + 50) petal.x = -30;

                const alpha = petal.maxAlpha * env;
                if (alpha <= 0.01) continue;

                ctx.save();
                ctx.translate(petal.x, petal.y);
                ctx.rotate(petal.rotZ);
                const flipX = Math.cos(petal.rotX);
                ctx.scale(flipX, 1);

                const drawAlpha = flipX < 0 ? alpha * 0.68 : alpha;
                drawSakuraPetal(ctx, petal.size, SAKURA_COLORS[petal.colorIdx], drawAlpha);
                ctx.restore();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}
