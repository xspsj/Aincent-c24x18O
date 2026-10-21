"use client";

// 翻转飘落系全屏特效 Canvas 渲染器：落叶（秋）/ 落樱（春）。
// 共享同一套「3D 模拟翻转 + 正弦风阻漂移 + 大气覆盖层 + 时间包络」架构。
// 3D 翻转：用 ctx.scale(Math.cos(rotX), 1) 模拟叶片绕竖轴的视觉厚薄变化，
// 再叠加 ctx.rotate(rotZ) 做平面内摇摆，两轴叠加出真实翻转感，零 GPU 开销。

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 通用叶片粒子类型 ────────────────────────────────────────────────
type Leaf = {
    x: number; y: number;
    vx: number; vy: number;        // 基础速度
    swayPhase: number;             // 正弦漂移初相
    swayAmp: number;               // 漂移幅度
    swayFreq: number;              // 漂移频率
    rotX: number;                  // 绕竖轴旋转（0~2π，模拟厚薄）
    rotZ: number;                  // 平面内摇摆角
    rotXSpeed: number;             // 竖轴旋转速度
    rotZSpeed: number;             // 平面摇摆速度
    size: number;                  // 叶片长半轴
    colorIdx: number;              // 颜色索引
    maxAlpha: number;
};

// ── 落叶（Autumn Leaves） ──────────────────────────────────────────
const LEAF_COUNT = 28;

// 枫红 + 暖黄 + 橙褐色系
const LEAF_COLORS = [
    "#c0392b", // 深枫红
    "#e74c3c", // 亮枫红
    "#e67e22", // 橙
    "#f39c12", // 暖黄橙
    "#d4a847", // 金黄
    "#a04020", // 橙褐
];

function drawAutumnLeaf(ctx: CanvasRenderingContext2D, size: number, color: string, alpha: number) {
    // 简洁枫叶形状：两个相对的椭圆贝塞尔 + 叶茎
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = `rgba(80, 30, 10, ${alpha * 0.35})`;
    ctx.lineWidth = 0.6;

    // 叶身：椭圆近似
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 叶茎
    ctx.beginPath();
    ctx.strokeStyle = `rgba(100, 50, 20, ${alpha * 0.5})`;
    ctx.lineWidth = 0.8;
    ctx.moveTo(0, 0);
    ctx.lineTo(0, size * 0.9);
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

        const leaves: Leaf[] = Array.from({ length: LEAF_COUNT }, () => ({
            x: Math.random() * W,
            y: -20 - Math.random() * H * 0.5,   // 错落从屏幕顶部以上入场
            vx: (Math.random() - 0.5) * 0.8 * scale,
            vy: (1.0 + Math.random() * 1.2) * scale,
            swayPhase: Math.random() * Math.PI * 2,
            swayAmp: (22 + Math.random() * 32) * scale,
            swayFreq: 0.4 + Math.random() * 0.5,
            rotX: Math.random() * Math.PI * 2,
            rotZ: (Math.random() - 0.5) * 0.6,
            rotXSpeed: (0.025 + Math.random() * 0.035) * (Math.random() < 0.5 ? 1 : -1),
            rotZSpeed: (0.008 + Math.random() * 0.012) * (Math.random() < 0.5 ? 1 : -1),
            size: (7 + Math.random() * 7) * scale,
            colorIdx: Math.floor(Math.random() * LEAF_COLORS.length),
            maxAlpha: 0.72 + Math.random() * 0.28,
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

            // 大气覆盖层：秋日暖橙微光，衬托叶片颜色
            ctx.fillStyle = `rgba(60, 30, 10, ${0.08 * env})`;
            ctx.fillRect(0, 0, W, H);

            for (const leaf of leaves) {
                // 正弦漂移 + 重力下落
                leaf.x += Math.sin(t * leaf.swayFreq + leaf.swayPhase) * leaf.swayAmp * 0.022 * dt + leaf.vx * dt;
                leaf.y += leaf.vy * dt;
                leaf.rotX += leaf.rotXSpeed * dt;
                leaf.rotZ += leaf.rotZSpeed * dt;
                // 到达底部或飞出侧边后从顶部重入
                if (leaf.y > H + 30) { leaf.y = -20; leaf.x = Math.random() * W; }
                if (leaf.x < -50) leaf.x = W + 30;
                if (leaf.x > W + 50) leaf.x = -30;

                const alpha = leaf.maxAlpha * env;
                if (alpha <= 0.01) continue;

                ctx.save();
                ctx.translate(leaf.x, leaf.y);
                // 平面摇摆
                ctx.rotate(leaf.rotZ);
                // 竖轴翻转：scaleX 用 cos(rotX) 模拟叶片朝向变化（正/负 = 正面/背面）
                const flipX = Math.cos(leaf.rotX);
                ctx.scale(flipX, 1);

                // 背面颜色更暗
                const color = flipX < 0
                    ? LEAF_COLORS[leaf.colorIdx].replace(/^#/, "")
                    : LEAF_COLORS[leaf.colorIdx];
                const drawAlpha = flipX < 0 ? alpha * 0.65 : alpha;

                drawAutumnLeaf(ctx, leaf.size, `#${color}`, drawAlpha);
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
const SAKURA_COUNT = 35;

// 樱花粉白色系
const SAKURA_COLORS = [
    "#fde8f0", // 极淡粉白
    "#f9c8db", // 浅粉
    "#f4a7c0", // 中粉
    "#f0c0d0", // 粉白
    "#ffffff", // 纯白（部分花瓣）
];

function drawSakuraPetal(ctx: CanvasRenderingContext2D, size: number, color: string, alpha: number) {
    // 樱花单片花瓣：心形椭圆，顶端有轻微凹口
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = `rgba(200, 130, 150, ${alpha * 0.3})`;
    ctx.lineWidth = 0.5;

    ctx.beginPath();
    // 花瓣形状：上宽下尖的卵形
    ctx.moveTo(0, size * 0.9);
    ctx.bezierCurveTo(
        -size * 0.7, size * 0.3,
        -size * 0.8, -size * 0.5,
        0, -size * 0.2,
    );
    ctx.bezierCurveTo(
        size * 0.8, -size * 0.5,
        size * 0.7, size * 0.3,
        0, size * 0.9,
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 花瓣中央纹路（细腻感）
    ctx.beginPath();
    ctx.strokeStyle = `rgba(220, 150, 170, ${alpha * 0.25})`;
    ctx.lineWidth = 0.4;
    ctx.moveTo(0, size * 0.85);
    ctx.lineTo(0, -size * 0.15);
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

        const petals: Leaf[] = Array.from({ length: SAKURA_COUNT }, () => ({
            x: Math.random() * W,
            y: -20 - Math.random() * H * 0.5,
            vx: (0.3 + Math.random() * 0.5) * scale,   // 樱花偏向右漂（春风感）
            vy: (0.7 + Math.random() * 0.9) * scale,    // 比落叶更轻盈，下落更慢
            swayPhase: Math.random() * Math.PI * 2,
            swayAmp: (28 + Math.random() * 36) * scale, // 摆幅更大，轻盈感
            swayFreq: 0.35 + Math.random() * 0.45,
            rotX: Math.random() * Math.PI * 2,
            rotZ: (Math.random() - 0.5) * 0.5,
            rotXSpeed: (0.018 + Math.random() * 0.028) * (Math.random() < 0.5 ? 1 : -1),
            rotZSpeed: (0.006 + Math.random() * 0.010) * (Math.random() < 0.5 ? 1 : -1),
            size: (5.5 + Math.random() * 5.5) * scale,  // 花瓣比叶片稍小
            colorIdx: Math.floor(Math.random() * SAKURA_COLORS.length),
            maxAlpha: 0.68 + Math.random() * 0.32,
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

                // 背面稍暗淡一些
                const drawAlpha = flipX < 0 ? alpha * 0.7 : alpha;
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
