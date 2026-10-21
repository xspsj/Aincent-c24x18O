"use client";

// 光效系全屏特效 Canvas 渲染器：三级天象流星 / 晨曦微光。
//
// 流星三级天象（每次触发随机 roll）：
//   50% 极光流星：极光帘幕背景（柔和半透明）+ 多色流星铺满屏幕
//   30% 彗星同框：双尾彗星缓缓划过 + 背景多色流星
//   20% 星轨：深蓝夜空 + 弧形星轨逐渐叠加铺满屏幕（低擦除率累积感）
//
// 修复：
//   - 流星起点铺满全屏、角度加大随机范围
//   - 极光帘幕降低 alpha，更柔和不遮挡
//   - 星轨擦除率降低让轨迹叠加累积
//   - 改 source-over 模式，浅色深色背景都清晰

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 流星色相池 ────────────────────────────────────────────────────
const COMMON_METEOR_COLORS: [number, number, number][] = [
    [210, 20, 96],
    [200, 15, 98],
    [50,  30, 95],
    [220, 25, 94],
];
const RARE_METEOR_COLORS: [number, number, number][] = [
    [142, 65, 75],
    [32,  72, 72],
    [185, 70, 78],
    [268, 58, 78],
    [0,   68, 72],
];
function pickMeteorColor(): [number, number, number] {
    return Math.random() < 0.70
        ? COMMON_METEOR_COLORS[Math.floor(Math.random() * COMMON_METEOR_COLORS.length)]
        : RARE_METEOR_COLORS[Math.floor(Math.random() * RARE_METEOR_COLORS.length)];
}

// ── 流星类型 ──────────────────────────────────────────────────────
type Meteor = {
    x: number; y: number;
    vx: number; vy: number;
    len: number; alpha: number;
    life: number; maxLife: number;
    hue: number; sat: number; light: number;
    isBolide: boolean; width: number; delay: number;
};

function makeMeteor(W: number, H: number, scale: number, isBolide = false): Meteor {
    // 修复：起点铺满全屏宽度，y 扩展到上半屏，角度加大随机范围
    const startX = W * (Math.random());
    const startY = H * (Math.random() * 0.55);
    const angle = (Math.PI / 5) + Math.random() * (Math.PI * 0.4); // 36°~108°，不再集中于 45°
    const speed = isBolide ? (14 + Math.random() * 7) * scale : (8 + Math.random() * 9) * scale;
    const life = isBolide ? 26 + Math.random() * 10 : 20 + Math.random() * 14;
    const [hue, sat, light] = pickMeteorColor();
    return {
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: isBolide ? (90 + Math.random() * 55) * scale : (45 + Math.random() * 52) * scale,
        alpha: isBolide ? 0.92 : 0.60 + Math.random() * 0.35,  // 提高基础 alpha，浅色背景也可见
        life, maxLife: life,
        hue, sat, light,
        isBolide,
        width: isBolide ? 2.5 * scale : (1.0 + Math.random() * 0.9) * scale,
        delay: 0,
    };
}

// ── 极光帘幕层 ────────────────────────────────────────────────────
type AuroraLayer = {
    yBase: number; thickness: number;
    hueCenter: number; hueRange: number;
    waveAmp: number; waveFreqX: number;
    waveSpeedX: number; waveSpeedY: number;
    alpha: number;
};

function makeAuroraLayers(H: number, scale: number, count: number): AuroraLayer[] {
    const layers: AuroraLayer[] = [
        // 主层：绿，修复：alpha 降低到 0.09~0.12，更柔和
        {
            yBase: 0.10 + Math.random() * 0.05,
            thickness: (50 + Math.random() * 22) * scale,
            hueCenter: 145 + Math.random() * 15,
            hueRange: 35,
            waveAmp: (16 + Math.random() * 14) * scale,
            waveFreqX: 0.0025 + Math.random() * 0.0015,
            waveSpeedX: 0.18 + Math.random() * 0.14,
            waveSpeedY: 0.32 + Math.random() * 0.18,
            alpha: 0.09 + Math.random() * 0.05,  // 原来 0.16+0.08，降低约 40%
        },
        // 副层：青蓝
        {
            yBase: 0.17 + Math.random() * 0.06,
            thickness: (30 + Math.random() * 18) * scale,
            hueCenter: 185 + Math.random() * 30,
            hueRange: 40,
            waveAmp: (10 + Math.random() * 12) * scale,
            waveFreqX: 0.003 + Math.random() * 0.002,
            waveSpeedX: 0.25 + Math.random() * 0.16,
            waveSpeedY: 0.25 + Math.random() * 0.16,
            alpha: 0.06 + Math.random() * 0.04,  // 原来 0.10+0.06，降低约 40%
        },
    ];
    if (count === 3) {
        layers.push({
            yBase: 0.05 + Math.random() * 0.04,
            thickness: (18 + Math.random() * 12) * scale,
            hueCenter: 265 + Math.random() * 25,
            hueRange: 28,
            waveAmp: (7 + Math.random() * 9) * scale,
            waveFreqX: 0.0035 + Math.random() * 0.002,
            waveSpeedX: 0.20 + Math.random() * 0.12,
            waveSpeedY: 0.20 + Math.random() * 0.12,
            alpha: 0.04 + Math.random() * 0.03,
        });
    }
    return layers;
}

// ── 彗星类型 ──────────────────────────────────────────────────────
type Comet = {
    x: number; y: number;
    vx: number; vy: number;
    ionLen: number; dustLen: number;
    life: number; maxLife: number;
    r: number;
};

function makeComet(W: number, H: number, scale: number): Comet {
    const startX = W * (0.10 + Math.random() * 0.40);
    const startY = H * (0.03 + Math.random() * 0.10);
    const angle = (Math.PI / 4) + (Math.random() - 0.5) * 0.25;
    const speed = (3.2 + Math.random() * 2.0) * scale;
    const life = 88 + Math.random() * 28;
    return {
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ionLen: (155 + Math.random() * 80) * scale,
        dustLen: (115 + Math.random() * 58) * scale,
        life, maxLife: life,
        r: (5 + Math.random() * 3) * scale,
    };
}

// ── 星轨类型 ──────────────────────────────────────────────────────
type StarTrail = {
    cx: number; cy: number;
    radius: number;
    startAngle: number;
    arcLen: number;
    alpha: number; width: number;
    delay: number;
    life: number; maxLife: number;
};

function makeStarTrail(W: number, H: number, scale: number): StarTrail {
    // 圆心在屏幕偏上偏左，模拟北极星方向，但随机范围更大让弧线铺满全屏
    const cx = W * (0.15 + Math.random() * 0.35);
    const cy = H * (-0.05 + Math.random() * 0.18);
    // 修复：半径范围扩大，确保弧线铺满全屏各角落
    const radius = W * (0.35 + Math.random() * 1.4);
    const startAngle = Math.random() * Math.PI * 2;
    const arcLen = 0.05 + Math.random() * 0.22;
    const life = 40 + Math.random() * 55;
    return {
        cx, cy, radius, startAngle, arcLen,
        alpha: 0.30 + Math.random() * 0.55,
        width: (0.7 + Math.random() * 0.9) * scale,
        delay: Math.random() * 1600,
        life, maxLife: life,
    };
}

export function ShootingStarCanvas({ duration }: { duration: number }) {
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

        const roll = Math.random();
        const mode: "aurora" | "comet" | "startrail" =
            roll < 0.50 ? "aurora" :
            roll < 0.80 ? "comet" : "startrail";

        const auroraLayers = mode === "aurora"
            ? makeAuroraLayers(H, scale, 2 + Math.floor(Math.random() * 2))
            : [];

        const meteorCount = mode === "aurora"
            ? (Math.random() < 0.50 ? 5 + Math.floor(Math.random() * 4) : 9 + Math.floor(Math.random() * 7))
            : 4 + Math.floor(Math.random() * 4);

        const meteors: Meteor[] = mode !== "startrail"
            ? Array.from({ length: meteorCount }, (_, i) => ({
                ...makeMeteor(W, H, scale, false),
                delay: i * (mode === "aurora" ? 240 : 360) + Math.random() * 160,
            }))
            : [];

        const comet: Comet | null = mode === "comet" ? makeComet(W, H, scale) : null;

        // 修复：星轨数量增加到 80~100 条，确保铺满感
        const TRAIL_COUNT = 80 + Math.floor(Math.random() * 25);
        const starTrails: StarTrail[] = mode === "startrail"
            ? Array.from({ length: TRAIL_COUNT }, () => makeStarTrail(W, H, scale))
            : [];

        type Fragment = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; hue: number; sat: number };
        const fragments: Fragment[] = [];

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 400;
        const FADE_OUT = 900;

        ctx.lineCap = "round";

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);
            const t = elapsed / 1000;

            // ══ 星轨模式 ══
            if (mode === "startrail") {
                ctx.globalCompositeOperation = "source-over";
                // 深蓝夜空基底：每帧叠加一点，慢慢压暗
                ctx.fillStyle = `rgba(4, 10, 30, ${0.06 * env})`;
                ctx.fillRect(0, 0, W, H);

                // 修复：擦除率从 0.15 降到 0.05，让星轨轨迹慢慢叠加累积
                ctx.globalCompositeOperation = "destination-out";
                ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
                ctx.fillRect(0, 0, W, H);
                ctx.globalCompositeOperation = "source-over";

                for (const trail of starTrails) {
                    if (elapsed < trail.delay) continue;
                    trail.life -= dt;
                    if (trail.life <= 0) continue;
                    const tl = trail.life / trail.maxLife;
                    // 淡入：前 10 帧渐入，防止突然出现
                    const fadeIn = Math.min(1, (trail.maxLife - trail.life) / 10);
                    const alpha = trail.alpha * fadeIn * tl * env;
                    if (alpha <= 0.01) continue;

                    ctx.strokeStyle = `rgba(210, 228, 255, ${alpha})`;
                    ctx.lineWidth = trail.width;
                    ctx.beginPath();
                    ctx.arc(trail.cx, trail.cy, trail.radius, trail.startAngle, trail.startAngle + trail.arcLen);
                    ctx.stroke();
                }
                raf = requestAnimationFrame(loop);
                return;
            }

            // ══ 极光 / 彗星模式 ══
            // 修复：改 source-over，浅色深色背景都能看清
            ctx.globalCompositeOperation = "source-over";
            // 夜空基底：极低透明度，聊天内容完全可见
            ctx.fillStyle = `rgba(3, 10, 24, ${0.07 * env})`;
            ctx.fillRect(0, 0, W, H);

            // 极光帘幕（aurora 模式，修复后更柔和）
            if (mode === "aurora") {
                for (const layer of auroraLayers) {
                    const breathAlpha = layer.alpha
                        * (0.65 + 0.35 * Math.sin(t * layer.waveSpeedY + layer.yBase * 20))
                        * env;
                    if (breathAlpha < 0.003) continue;
                    const steps = Math.ceil(W / 9);
                    for (let s = 0; s <= steps; s++) {
                        const px = (s / steps) * W;
                        const py = H * layer.yBase
                            + Math.sin(px * layer.waveFreqX + t * layer.waveSpeedX) * layer.waveAmp;
                        const hue = layer.hueCenter + ((s / steps) - 0.5) * layer.hueRange;
                        const grad = ctx.createRadialGradient(px, py, 0, px, py, layer.thickness);
                        grad.addColorStop(0,    `hsla(${hue}, 85%, 68%, ${breathAlpha})`);
                        grad.addColorStop(0.42, `hsla(${hue}, 80%, 62%, ${breathAlpha * 0.40})`);
                        grad.addColorStop(0.78, `hsla(${hue}, 76%, 58%, ${breathAlpha * 0.10})`);
                        grad.addColorStop(1,    `hsla(${hue}, 72%, 55%, 0)`);
                        ctx.fillStyle = grad;
                        ctx.beginPath();
                        ctx.ellipse(px, py, layer.thickness * 0.88, layer.thickness * 0.42, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            // 彗星
            if (comet && mode === "comet") {
                comet.x += comet.vx * dt;
                comet.y += comet.vy * dt;
                comet.life -= dt;

                if (comet.life > 0) {
                    const ct = comet.life / comet.maxLife;
                    const coreAlpha = Math.min(1, (comet.maxLife - comet.life) / 12) * ct * env;

                    if (coreAlpha > 0.01) {
                        const spd = Math.hypot(comet.vx, comet.vy);
                        const nx = comet.vx / spd;
                        const ny = comet.vy / spd;

                        // 尘埃尾（暖黄宽散）
                        const dustTailX = comet.x - nx * comet.dustLen;
                        const dustTailY = comet.y - ny * comet.dustLen;
                        const dustGrad = ctx.createLinearGradient(dustTailX, dustTailY, comet.x, comet.y);
                        dustGrad.addColorStop(0,    `rgba(180, 140, 60, 0)`);
                        dustGrad.addColorStop(0.45, `rgba(210, 170, 80, ${coreAlpha * 0.22})`);
                        dustGrad.addColorStop(0.82, `rgba(235, 200, 110, ${coreAlpha * 0.45})`);
                        dustGrad.addColorStop(1,    `rgba(255, 230, 160, ${coreAlpha * 0.70})`);
                        ctx.strokeStyle = dustGrad;
                        ctx.lineWidth = comet.r * 2.8;
                        ctx.globalAlpha = 0.55;
                        ctx.beginPath(); ctx.moveTo(dustTailX, dustTailY); ctx.lineTo(comet.x, comet.y); ctx.stroke();

                        // 离子尾（蓝白细直，偏角 0.12）
                        const ionAngle = Math.atan2(ny, nx) - 0.12;
                        const ionTailX = comet.x - Math.cos(ionAngle) * comet.ionLen;
                        const ionTailY = comet.y - Math.sin(ionAngle) * comet.ionLen;
                        const ionGrad = ctx.createLinearGradient(ionTailX, ionTailY, comet.x, comet.y);
                        ionGrad.addColorStop(0,    `rgba(100, 160, 255, 0)`);
                        ionGrad.addColorStop(0.50, `rgba(140, 195, 255, ${coreAlpha * 0.35})`);
                        ionGrad.addColorStop(0.85, `rgba(190, 225, 255, ${coreAlpha * 0.72})`);
                        ionGrad.addColorStop(1,    `rgba(230, 248, 255, ${coreAlpha * 0.90})`);
                        ctx.strokeStyle = ionGrad;
                        ctx.lineWidth = comet.r * 0.65;
                        ctx.globalAlpha = 1;
                        ctx.beginPath(); ctx.moveTo(ionTailX, ionTailY); ctx.lineTo(comet.x, comet.y); ctx.stroke();

                        // 彗核白热光点
                        const coreGrad = ctx.createRadialGradient(comet.x, comet.y, 0, comet.x, comet.y, comet.r * 2.8);
                        coreGrad.addColorStop(0,   `rgba(255, 255, 255, ${coreAlpha})`);
                        coreGrad.addColorStop(0.4, `rgba(210, 240, 255, ${coreAlpha * 0.7})`);
                        coreGrad.addColorStop(1,   `rgba(150, 200, 255, 0)`);
                        ctx.fillStyle = coreGrad;
                        ctx.globalAlpha = 1;
                        ctx.beginPath(); ctx.arc(comet.x, comet.y, comet.r * 2.8, 0, Math.PI * 2); ctx.fill();
                    }
                }
            }

            // 流星（source-over，浅色深色都可见）
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";

            for (const m of meteors) {
                if (elapsed < m.delay) continue;
                m.x += m.vx * dt;
                m.y += m.vy * dt;
                m.life -= dt;
                if (m.life <= 0) continue;

                const mt = m.life / m.maxLife;
                const alpha = m.alpha * mt * env;
                if (alpha <= 0.01) continue;

                const spd = Math.hypot(m.vx, m.vy);
                const tailX = m.x - (m.vx / spd) * m.len;
                const tailY = m.y - (m.vy / spd) * m.len;

                const grad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
                grad.addColorStop(0,    `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                grad.addColorStop(0.55, `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${alpha * 0.42})`);
                grad.addColorStop(0.85, `hsla(${m.hue}, ${m.sat + 5}%, ${Math.min(98, m.light + 6)}%, ${alpha * 0.80})`);
                grad.addColorStop(1,    `rgba(255, 255, 255, ${alpha})`);

                // 外圈柔光
                ctx.lineWidth = m.width * (m.isBolide ? 4.0 : 2.6);
                ctx.globalAlpha = 0.22;
                ctx.strokeStyle = grad;
                ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(m.x, m.y); ctx.stroke();

                // 内核
                ctx.globalAlpha = 1;
                ctx.lineWidth = m.width;
                ctx.strokeStyle = grad;
                ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(m.x, m.y); ctx.stroke();

                if (m.isBolide) {
                    const coreGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.width * 4.2);
                    coreGrad.addColorStop(0,   `rgba(255, 255, 255, ${alpha})`);
                    coreGrad.addColorStop(0.4, `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${alpha * 0.65})`);
                    coreGrad.addColorStop(1,   `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                    ctx.fillStyle = coreGrad;
                    ctx.beginPath(); ctx.arc(m.x, m.y, m.width * 4.2, 0, Math.PI * 2); ctx.fill();

                    if (mt < 0.3 && fragments.length < 18 && Math.random() < 0.22) {
                        const angle = Math.random() * Math.PI * 2;
                        const sp = (1.0 + Math.random() * 1.8) * scale;
                        const fl = 12 + Math.random() * 10;
                        fragments.push({ x: m.x, y: m.y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp, life: fl, maxLife: fl, hue: m.hue, sat: m.sat });
                    }
                }
            }

            ctx.globalAlpha = 1;
            for (let i = fragments.length - 1; i >= 0; i--) {
                const f = fragments[i];
                f.x += f.vx * dt; f.y += f.vy * dt;
                f.life -= dt;
                if (f.life <= 0) { fragments.splice(i, 1); continue; }
                const ft = f.life / f.maxLife;
                ctx.beginPath();
                ctx.arc(f.x, f.y, Math.max(0.4, 1.3 * scale * ft), 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${f.hue}, ${f.sat}%, 88%, ${0.85 * ft * env})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}

// ═══════════════════════════════════════════════════════════════════
// ── 晨曦微光（Sunbeam） ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

const DUST_COUNT = 22;

type Dust = {
    x: number; y: number;
    vx: number; vy: number;
    r: number;
    breathPhase: number; breathFreq: number;
    inBeam: boolean;
};

type Beam = {
    originX: number; angle: number;
    width: number; length: number; alpha: number;
};

export function SunbeamCanvas({ duration }: { duration: number }) {
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

        const beamCount = 2 + Math.floor(Math.random() * 2);
        const beams: Beam[] = Array.from({ length: beamCount }, (_, i) => ({
            originX: W * (0.55 + i * 0.15 + Math.random() * 0.1),
            angle: (Math.PI / 2) + 0.18 + i * 0.22 + (Math.random() - 0.5) * 0.1,
            width: (38 + Math.random() * 32) * scale,
            length: H * (0.55 + Math.random() * 0.3),
            alpha: 0.10 + Math.random() * 0.08,
        }));

        const dusts: Dust[] = Array.from({ length: DUST_COUNT }, () => ({
            x: W * 0.3 + Math.random() * W * 0.5,
            y: H * 0.08 + Math.random() * H * 0.55,
            vx: (Math.random() - 0.5) * 0.25 * scale,
            vy: -(0.04 + Math.random() * 0.10) * scale,
            r: (0.8 + Math.random() * 1.2) * scale,
            breathPhase: Math.random() * Math.PI * 2,
            breathFreq: 0.3 + Math.random() * 0.5,
            inBeam: false,
        }));

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 800;
        const FADE_OUT = 1000;
        let beamPhase = 0;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);
            const t = elapsed / 1000;

            ctx.clearRect(0, 0, W, H);
            beamPhase += 0.008 * dt;

            // 右上角金橙柔光基底
            const ambientGrad = ctx.createRadialGradient(W * 0.78, 0, 0, W * 0.78, 0, W * 0.75);
            ambientGrad.addColorStop(0,   `rgba(255, 220, 120, ${0.18 * env})`);
            ambientGrad.addColorStop(0.5, `rgba(255, 195, 80,  ${0.08 * env})`);
            ambientGrad.addColorStop(1,   `rgba(255, 180, 60,  0)`);
            ctx.fillStyle = ambientGrad;
            ctx.fillRect(0, 0, W, H);

            // 梯形光柱（原版线性渐变）
            for (const beam of beams) {
                const breathAlpha = beam.alpha * (0.75 + 0.25 * Math.sin(beamPhase + beam.angle)) * env;
                if (breathAlpha <= 0.005) continue;

                ctx.save();
                ctx.translate(beam.originX, -10);
                ctx.rotate(beam.angle - Math.PI / 2);

                const beamGrad = ctx.createLinearGradient(0, 0, 0, beam.length);
                beamGrad.addColorStop(0,    `rgba(255, 215, 100, 0)`);
                beamGrad.addColorStop(0.08, `rgba(255, 215, 100, ${breathAlpha * 0.85})`);
                beamGrad.addColorStop(0.45, `rgba(255, 208, 88,  ${breathAlpha * 0.55})`);
                beamGrad.addColorStop(0.78, `rgba(255, 198, 75,  ${breathAlpha * 0.18})`);
                beamGrad.addColorStop(1,    `rgba(255, 188, 65,  0)`);

                const topW = beam.width * 0.18;
                const botW = beam.width;
                ctx.beginPath();
                ctx.moveTo(-topW / 2, 0);
                ctx.lineTo(topW / 2, 0);
                ctx.lineTo(botW / 2, beam.length);
                ctx.lineTo(-botW / 2, beam.length);
                ctx.closePath();
                ctx.fillStyle = beamGrad;
                ctx.fill();
                ctx.restore();
            }

            // 微尘
            for (const d of dusts) {
                d.x += d.vx * dt + Math.sin(t * 0.3 + d.breathPhase) * 0.18 * scale * dt;
                d.y += d.vy * dt;
                if (d.y < -10) { d.y = H * 0.6 + Math.random() * H * 0.3; d.x = W * 0.3 + Math.random() * W * 0.5; }
                if (d.x < W * 0.1 || d.x > W * 0.9) d.vx = -d.vx;

                d.inBeam = beams.some(beam => {
                    const dx = d.x - beam.originX;
                    const dy = d.y - (-10);
                    const dist = Math.abs(dx * Math.cos(beam.angle) - dy * Math.sin(beam.angle));
                    return dist < beam.width * 0.55 && dy > 0 && dy < beam.length;
                });

                const breath = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * d.breathFreq * Math.PI * 2 + d.breathPhase));
                const baseA = d.inBeam ? 0.75 : 0.18;
                const alpha = baseA * breath * env;
                if (alpha <= 0.01) continue;

                ctx.beginPath();
                ctx.arc(d.x, d.y, d.r * (d.inBeam ? 1.3 : 0.8), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 230, 150, ${alpha})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}
