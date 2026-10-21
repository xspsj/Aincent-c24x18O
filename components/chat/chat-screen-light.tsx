"use client";

// 光效系全屏特效 Canvas 渲染器：流星 / 晨曦微光。
//
// 流星 v5：
//   - 位置历史数组 → 连续渐变线段彗尾，头亮尾透明，不再是串珠
//   - clearRect 每帧清屏，背景只画一次极淡覆盖（不累积变黑）
//   - 速度放慢，颗数 5~8 颗，错落延时
//   - 65% 普通 / 35% 火流星（1颗主星末段碎星）

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 流星色相池 ────────────────────────────────────────────────────
const COMMON_COLORS: [number, number, number][] = [
    [210, 18, 97],
    [200, 12, 99],
    [50,  28, 96],
    [220, 22, 95],
];
const RARE_COLORS: [number, number, number][] = [
    [142, 62, 76],
    [32,  70, 74],
    [185, 68, 80],
    [268, 55, 80],
    [0,   65, 74],
];
function pickColor(): [number, number, number] {
    return Math.random() < 0.70
        ? COMMON_COLORS[Math.floor(Math.random() * COMMON_COLORS.length)]
        : RARE_COLORS[Math.floor(Math.random() * RARE_COLORS.length)];
}

type MeteorParticle = {
    x: number; y: number;
    vx: number; vy: number;
    trail: { x: number; y: number }[];   // 位置历史
    maxTrailLen: number;                  // 历史最大长度 = 彗尾长度（帧数）
    hue: number; sat: number; light: number;
    coreR: number;     // 头部亮核半径
    glowR: number;     // 头部光晕半径
    alpha: number;
    delay: number;
    life: number; maxLife: number;
    isBolide: boolean;
    started: boolean;
};

function makeMeteor(W: number, H: number, scale: number, isBolide = false): MeteorParticle {
    // 起点：铺满屏幕上方，从右上往左下（110°~135°）
    const startX = W * (0.10 + Math.random() * 0.85);
    const startY = H * (Math.random() * 0.45);
    const angleDeg = 110 + Math.random() * 25;
    const angle = (angleDeg * Math.PI) / 180;
    // 速度放慢：普通 5~8，火流星 9~12
    const speed = isBolide ? (9 + Math.random() * 3) * scale : (5 + Math.random() * 3) * scale;
    // 寿命足够长，让流星完整划过
    const life = isBolide ? 80 + Math.random() * 30 : 60 + Math.random() * 30;
    const [hue, sat, light] = pickColor();
    const coreR = isBolide ? (2.8 + Math.random() * 1.5) * scale : (1.4 + Math.random() * 1.0) * scale;
    // 彗尾历史帧数：普通 22~30帧，火流星 28~38帧
    const maxTrailLen = isBolide ? 28 + Math.floor(Math.random() * 10) : 18 + Math.floor(Math.random() * 12);
    return {
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        trail: [],
        maxTrailLen,
        hue, sat, light,
        coreR,
        glowR: coreR * 3.5,
        alpha: isBolide ? 0.96 : 0.70 + Math.random() * 0.26,
        delay: 0,
        life, maxLife: life,
        isBolide,
        started: false,
    };
}

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
        const isBolideMode = Math.random() < 0.35;
        // 颗数：5~8 颗普通 / 火流星模式 4~6 普通 + 1 主星
        const count = isBolideMode
            ? 4 + Math.floor(Math.random() * 3)
            : 5 + Math.floor(Math.random() * 4);

        const meteors: MeteorParticle[] = Array.from({ length: count }, (_, i) => ({
            ...makeMeteor(W, H, scale, false),
            // 错落延时：0~3.5 秒内分散出场
            delay: i * (350 + Math.random() * 500) + Math.random() * 200,
        }));

        if (isBolideMode) {
            meteors.push({
                ...makeMeteor(W, H, scale, true),
                delay: 500 + Math.random() * 800,
            });
        }

        const fragments: Fragment[] = [];

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 400;
        const FADE_OUT = 1000;

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);

            // 每帧清屏，不累积背景
            ctx.clearRect(0, 0, W, H);

            // 极淡深蓝夜空覆盖（只画一次，不叠加，聊天内容完全可见）
            ctx.fillStyle = `rgba(4, 9, 26, ${0.10 * env})`;
            ctx.fillRect(0, 0, W, H);

            // ── 流星渲染 ──
            for (const m of meteors) {
                if (elapsed < m.delay) continue;
                if (!m.started) m.started = true;

                // 更新位置，push 进历史
                m.x += m.vx * dt;
                m.y += m.vy * dt;
                m.life -= dt;

                m.trail.push({ x: m.x, y: m.y });
                if (m.trail.length > m.maxTrailLen) m.trail.shift();

                if (m.life <= 0 || m.x < -100 || m.y > H + 100) continue;
                if (m.trail.length < 2) continue;

                // 整体生命周期透明度包络（淡入 10 帧 + 淡出末 25%）
                const lt = m.life / m.maxLife;
                const fadeIn = Math.min(1, (m.maxLife - m.life) / 10);
                const envAlphaM = m.alpha * fadeIn * Math.min(1, lt * 4) * env;
                if (envAlphaM <= 0.01) continue;

                // ── 彗尾：连续渐变线段 ──
                // 从尾（最老）到头（最新），alpha 从 0 线性增至 envAlphaM
                const trailLen = m.trail.length;
                for (let i = 1; i < trailLen; i++) {
                    const prev = m.trail[i - 1];
                    const curr = m.trail[i];
                    // i/trailLen：越靠近头部（i 越大）alpha 越高
                    const segRatio = i / trailLen;
                    const segAlpha = envAlphaM * (segRatio * segRatio); // 二次曲线：尾端衰减更自然
                    if (segAlpha <= 0.008) continue;

                    // 线宽：头部稍粗，尾部细
                    const lineW = m.coreR * 0.45 * segRatio + 0.4;
                    ctx.strokeStyle = `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${segAlpha})`;
                    ctx.lineWidth = lineW;
                    ctx.beginPath();
                    ctx.moveTo(prev.x, prev.y);
                    ctx.lineTo(curr.x, curr.y);
                    ctx.stroke();
                }

                // ── 头部：外圈柔光 + 白热内核 ──
                const head = m.trail[trailLen - 1];

                // 外圈柔光晕
                const glowGrad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, m.glowR);
                glowGrad.addColorStop(0,    `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${envAlphaM * 0.55})`);
                glowGrad.addColorStop(0.5,  `hsla(${m.hue}, ${m.sat}%, ${m.light}%, ${envAlphaM * 0.18})`);
                glowGrad.addColorStop(1,    `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                ctx.fillStyle = glowGrad;
                ctx.beginPath();
                ctx.arc(head.x, head.y, m.glowR, 0, Math.PI * 2);
                ctx.fill();

                // 白热内核
                const coreGrad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, m.coreR);
                coreGrad.addColorStop(0,   `rgba(255, 255, 255, ${envAlphaM})`);
                coreGrad.addColorStop(0.65, `hsla(${m.hue}, ${m.sat}%, 92%, ${envAlphaM * 0.7})`);
                coreGrad.addColorStop(1,   `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0)`);
                ctx.fillStyle = coreGrad;
                ctx.beginPath();
                ctx.arc(head.x, head.y, m.coreR, 0, Math.PI * 2);
                ctx.fill();

                // 火流星末段碎星
                if (m.isBolide && lt < 0.30 && fragments.length < 24 && Math.random() < 0.25) {
                    const fAngle = Math.random() * Math.PI * 2;
                    const fSpeed = (1.0 + Math.random() * 2.0) * scale;
                    const fLife = 16 + Math.random() * 14;
                    fragments.push({
                        x: head.x, y: head.y,
                        vx: Math.cos(fAngle) * fSpeed,
                        vy: Math.sin(fAngle) * fSpeed,
                        life: fLife, maxLife: fLife,
                        hue: m.hue, sat: m.sat,
                        r: (0.7 + Math.random() * 0.9) * scale,
                    });
                }
            }

            // ── 碎星粒子 ──
            for (let i = fragments.length - 1; i >= 0; i--) {
                const f = fragments[i];
                f.x += f.vx * dt;
                f.y += f.vy * dt;
                f.vy += 0.025 * scale * dt;
                f.life -= dt;
                if (f.life <= 0) { fragments.splice(i, 1); continue; }
                const ft = f.life / f.maxLife;
                const fGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 2.0);
                fGrad.addColorStop(0,   `rgba(255, 255, 255, ${0.88 * ft * env})`);
                fGrad.addColorStop(0.5, `hsla(${f.hue}, ${f.sat}%, 88%, ${0.45 * ft * env})`);
                fGrad.addColorStop(1,   `hsla(${f.hue}, ${f.sat}%, 80%, 0)`);
                ctx.fillStyle = fGrad;
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r * 2.0, 0, Math.PI * 2);
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
