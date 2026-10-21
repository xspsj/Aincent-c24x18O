"use client";

// 光效系全屏特效 Canvas 渲染器：流星 / 晨曦微光。
//
// 流星重做：
//   - 移动亮点 + 半透明覆盖衰减产生拖尾（头亮尾淡，物理正确）
//   - 从右上往左下（110°~135°），不横着跑
//   - 3~5 颗，随机延时错落出场
//   - 65% 普通流星雨 / 35% 火流星场（1颗主星+2~3颗陪衬）
//   - 多色流星：70% 冷白蓝白，30% 偶发彩色
//   - 背景极低透明度深蓝，完全看得清聊天内容
//
// 晨曦微光：梯形光柱 + 线性渐变，稳定版

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ═══════════════════════════════════════════════════════════════════
// ── 流星 ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// 流星色相池：70% 冷白系，30% 彩色
const COMMON_COLORS: [number, number, number][] = [
    [210, 18, 97],   // 蓝白
    [200, 12, 99],   // 纯白偏蓝
    [50,  28, 96],   // 淡黄白
    [220, 22, 95],   // 冷白
];
const RARE_COLORS: [number, number, number][] = [
    [142, 62, 76],   // 绿（镍/铜）
    [32,  70, 74],   // 橙（钠）
    [185, 68, 80],   // 青（铜）
    [268, 55, 80],   // 紫（钙）
    [0,   65, 74],   // 红橙
];
function pickColor(): [number, number, number] {
    return Math.random() < 0.70
        ? COMMON_COLORS[Math.floor(Math.random() * COMMON_COLORS.length)]
        : RARE_COLORS[Math.floor(Math.random() * RARE_COLORS.length)];
}

type MeteorParticle = {
    x: number; y: number;       // 当前亮点位置
    vx: number; vy: number;     // 每帧移动量
    hue: number; sat: number; light: number;
    coreR: number;              // 白热内核半径
    glowR: number;              // 柔光晕半径
    alpha: number;              // 峰值透明度
    delay: number;              // 出场延时 ms
    life: number; maxLife: number;
    isBolide: boolean;          // 是否为火流星主星
    active: boolean;            // 是否已入场
};

function makeMeteor(W: number, H: number, scale: number, isBolide = false): MeteorParticle {
    // 从右上区域入场，方向从右上往左下（110°~135°）
    const startX = W * (0.30 + Math.random() * 0.70);   // 右侧 30%~100%
    const startY = H * (Math.random() * 0.38);            // 上方 0~38%
    // 角度：110°~135°（从右上往左下），弧度换算
    const angleDeg = 110 + Math.random() * 25;
    const angle = (angleDeg * Math.PI) / 180;
    const speed = isBolide ? (14 + Math.random() * 8) * scale : (10 + Math.random() * 8) * scale;
    const life = isBolide ? 55 + Math.random() * 20 : 40 + Math.random() * 22;
    const [hue, sat, light] = pickColor();
    const coreR = isBolide ? (3.5 + Math.random() * 2.0) * scale : (1.8 + Math.random() * 1.2) * scale;
    return {
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue, sat, light,
        coreR,
        glowR: coreR * (isBolide ? 5.5 : 4.2),
        alpha: isBolide ? 1.0 : 0.72 + Math.random() * 0.28,
        delay: 0,
        life, maxLife: life,
        isBolide,
        active: false,
    };
}

// 碎星粒子（火流星末段爆出）
type Fragment = {
    x: number; y: number;
    vx: number; vy: number;
    life: number; maxLife: number;
    hue: number; sat: number; r: number;
};

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

        // 概率分级
        const isBolideMode = Math.random() < 0.35;  // 35% 火流星场
        const count = isBolideMode
            ? 2 + Math.floor(Math.random() * 2)      // 火流星场：2~3 颗普通 + 1 颗主星
            : 3 + Math.floor(Math.random() * 3);     // 普通流星雨：3~5 颗

        const meteors: MeteorParticle[] = Array.from({ length: count }, (_, i) => ({
            ...makeMeteor(W, H, scale, false),
            // 错落延时：第一颗 0~400ms，后续每颗间隔 600~1400ms
            delay: i === 0
                ? Math.random() * 400
                : 400 + i * (600 + Math.random() * 800),
        }));

        // 火流星主星（最后出场，最亮最大）
        if (isBolideMode) {
            meteors.push({
                ...makeMeteor(W, H, scale, true),
                delay: 300 + Math.random() * 600,
            });
        }

        const fragments: Fragment[] = [];

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 300;
        const FADE_OUT = 800;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);

            // ── 背景：极低透明度深蓝，每帧叠加营造入夜感 ──
            // 不清画布！用半透明覆盖让前帧亮迹自然衰减 → 产生拖尾
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = `rgba(4, 9, 26, ${0.06 * env})`;
            ctx.fillRect(0, 0, W, H);

            // ── 拖尾衰减层：盖一层半透明黑，让亮迹逐渐消隐 ──
            // 透明度 0.18：约 5~6 帧后亮迹衰减到不可见，彗尾长度自然合适
            ctx.fillStyle = `rgba(0, 0, 0, ${0.18 * env})`;
            ctx.fillRect(0, 0, W, H);

            // ── 流星亮点渲染 ──
            for (const m of meteors) {
                if (elapsed < m.delay) continue;
                if (!m.active) m.active = true;

                m.x += m.vx * dt;
                m.y += m.vy * dt;
                m.life -= dt;

                // 飞出屏幕或寿命耗尽
                if (m.life <= 0 || m.x < -80 || m.y > H + 80) continue;

                const lt = m.life / m.maxLife;
                // 淡入（前 8 帧）+ 淡出（末 20% 寿命）
                const fadeIn = Math.min(1, (m.maxLife - m.life) / 8);
                const alpha = m.alpha * fadeIn * Math.min(1, lt * 3.5) * env;
                if (alpha <= 0.01) continue;

                // 第 1 层：外圈漫射光晕（最大最淡）
                const outerR = m.glowR * 1.8;
                const outerGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, outerR);
                outerGrad.addColorStop(0,    `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${alpha * 0.18})`);
                outerGrad.addColorStop(0.5,  `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${alpha * 0.06})`);
                outerGrad.addColorStop(1,    `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                ctx.fillStyle = outerGrad;
                ctx.beginPath();
                ctx.arc(m.x, m.y, outerR, 0, Math.PI * 2);
                ctx.fill();

                // 第 2 层：中层柔光晕（带流星主色）
                const glowGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.glowR);
                glowGrad.addColorStop(0,    `hsla(${m.hue}, ${m.sat}%, ${Math.min(98, m.light + 5)}%, ${alpha * 0.65})`);
                glowGrad.addColorStop(0.45, `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${alpha * 0.28})`);
                glowGrad.addColorStop(1,    `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                ctx.fillStyle = glowGrad;
                ctx.beginPath();
                ctx.arc(m.x, m.y, m.glowR, 0, Math.PI * 2);
                ctx.fill();

                // 第 3 层：白热内核（最小最亮）
                const coreGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.coreR);
                coreGrad.addColorStop(0,   `rgba(255, 255, 255, ${alpha})`);
                coreGrad.addColorStop(0.6, `hsla(${m.hue}, ${m.sat}%, 92%, ${alpha * 0.75})`);
                coreGrad.addColorStop(1,   `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                ctx.fillStyle = coreGrad;
                ctx.beginPath();
                ctx.arc(m.x, m.y, m.coreR, 0, Math.PI * 2);
                ctx.fill();

                // 火流星：末段爆出碎星粒子
                if (m.isBolide && lt < 0.28 && fragments.length < 22 && Math.random() < 0.28) {
                    const fragAngle = Math.random() * Math.PI * 2;
                    const fragSpeed = (1.2 + Math.random() * 2.2) * scale;
                    const fragLife = 14 + Math.random() * 12;
                    fragments.push({
                        x: m.x, y: m.y,
                        vx: Math.cos(fragAngle) * fragSpeed,
                        vy: Math.sin(fragAngle) * fragSpeed,
                        life: fragLife, maxLife: fragLife,
                        hue: m.hue, sat: m.sat,
                        r: (0.8 + Math.random() * 1.0) * scale,
                    });
                }
            }

            // ── 碎星粒子 ──
            for (let i = fragments.length - 1; i >= 0; i--) {
                const f = fragments[i];
                f.x += f.vx * dt;
                f.y += f.vy * dt;
                f.vy += 0.03 * scale * dt;  // 微弱重力
                f.life -= dt;
                if (f.life <= 0) { fragments.splice(i, 1); continue; }
                const ft = f.life / f.maxLife;
                const fragGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 1.8);
                fragGrad.addColorStop(0,   `rgba(255, 255, 255, ${0.9 * ft * env})`);
                fragGrad.addColorStop(0.5, `hsla(${f.hue}, ${f.sat}%, 88%, ${0.5 * ft * env})`);
                fragGrad.addColorStop(1,   `hsla(${f.hue}, ${f.sat}%, 80%, 0)`);
                ctx.fillStyle = fragGrad;
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 1.8, 0, Math.PI * 2);
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

            const ambientGrad = ctx.createRadialGradient(W * 0.78, 0, 0, W * 0.78, 0, W * 0.75);
            ambientGrad.addColorStop(0,   `rgba(255, 220, 120, ${0.18 * env})`);
            ambientGrad.addColorStop(0.5, `rgba(255, 195, 80,  ${0.08 * env})`);
            ambientGrad.addColorStop(1,   `rgba(255, 180, 60,  0)`);
            ctx.fillStyle = ambientGrad;
            ctx.fillRect(0, 0, W, H);

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
