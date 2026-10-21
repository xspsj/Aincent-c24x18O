"use client";

// 光效系全屏特效 Canvas 渲染器：流星（三级概率分级）/ 晨曦微光（丁达尔光柱+微尘）。
// 修复：流星移除全屏深色覆盖层改用 destination-out 轻余辉；晨曦光柱改径向渐变羽化边缘。

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 流星（Shooting Star）三级概率分级 ─────────────────────────────
type Meteor = {
    x: number; y: number;
    vx: number; vy: number;
    len: number;
    alpha: number;
    life: number; maxLife: number;
    hue: number;
    isBolide: boolean;
    width: number;
};

function makeMeteor(W: number, H: number, scale: number, isBolide = false): Meteor {
    const startX = W * (0.1 + Math.random() * 0.7);
    const startY = H * (0.02 + Math.random() * 0.35);
    const angle = (Math.PI / 4) + (Math.random() - 0.5) * 0.4;
    const speed = isBolide ? (18 + Math.random() * 8) * scale : (10 + Math.random() * 10) * scale;
    const life = isBolide ? 28 + Math.random() * 10 : 22 + Math.random() * 14;
    return {
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: isBolide ? (110 + Math.random() * 60) * scale : (55 + Math.random() * 55) * scale,
        alpha: isBolide ? 0.95 : 0.55 + Math.random() * 0.35,
        life, maxLife: life,
        hue: isBolide ? 45 + Math.random() * 20 : 200 + Math.random() * 40,
        isBolide,
        width: isBolide ? 2.8 * scale : (1.0 + Math.random() * 0.8) * scale,
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
        const isSparse = roll < 0.50;
        const isShower = roll < 0.85;

        const baseCount = isSparse ? 4 + Math.floor(Math.random() * 3)
                        : isShower ? 8 + Math.floor(Math.random() * 7)
                        : 9 + Math.floor(Math.random() * 6);

        const meteors: (Meteor & { delay: number })[] = Array.from({ length: baseCount }, (_, i) => ({
            ...makeMeteor(W, H, scale, false),
            delay: i * (isSparse ? 320 : 180) + Math.random() * 200,
        }));

        if (!isShower) {
            meteors.push({ ...makeMeteor(W, H, scale, true), delay: 400 + Math.random() * 300 });
        }

        type BolideFragment = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; hue: number };
        const fragments: BolideFragment[] = [];

        let raf = 0;
        let last = performance.now();
        const startAt = last;
        const FADE_IN = 300;
        const FADE_OUT = 800;

        ctx.lineCap = "round";

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;
            const env = envAlpha(elapsed, duration, FADE_IN, FADE_OUT);

            // 修复：和烟花一样，用 destination-out 轻轻擦除旧帧（产生短暂拖尾余辉），
            // 不用全屏深色 fillRect 覆盖，避免黑屏遮住聊天内容
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
            ctx.fillRect(0, 0, W, H);
            ctx.globalCompositeOperation = "lighter";

            for (const m of meteors) {
                if (elapsed < m.delay) continue;
                m.x += m.vx * dt;
                m.y += m.vy * dt;
                m.life -= dt;
                if (m.life <= 0) continue;

                const t = m.life / m.maxLife;
                const alpha = m.alpha * t * env;
                if (alpha <= 0.01) continue;

                const spd = Math.hypot(m.vx, m.vy);
                const tailX = m.x - (m.vx / spd) * m.len;
                const tailY = m.y - (m.vy / spd) * m.len;

                const grad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
                if (m.isBolide) {
                    grad.addColorStop(0,    `hsla(${m.hue}, 90%, 70%, 0)`);
                    grad.addColorStop(0.5,  `hsla(${m.hue}, 95%, 82%, ${alpha * 0.5})`);
                    grad.addColorStop(0.85, `hsla(${m.hue + 20}, 80%, 88%, ${alpha * 0.85})`);
                    grad.addColorStop(1,    `rgba(255, 255, 240, ${alpha})`);
                } else {
                    grad.addColorStop(0,   `hsla(${m.hue}, 80%, 75%, 0)`);
                    grad.addColorStop(0.7, `hsla(${m.hue}, 85%, 88%, ${alpha * 0.6})`);
                    grad.addColorStop(1,   `rgba(255, 255, 255, ${alpha})`);
                }

                // 外圈柔光
                ctx.strokeStyle = grad;
                ctx.lineWidth = m.width * (m.isBolide ? 3.5 : 2.4);
                ctx.globalAlpha = 0.18;
                ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(m.x, m.y); ctx.stroke();

                // 内核亮线
                ctx.globalAlpha = 1;
                ctx.strokeStyle = grad;
                ctx.lineWidth = m.width;
                ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(m.x, m.y); ctx.stroke();

                if (m.isBolide) {
                    const coreGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.width * 3.5);
                    coreGrad.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
                    coreGrad.addColorStop(1, `rgba(255, 200, 100, 0)`);
                    ctx.fillStyle = coreGrad;
                    ctx.beginPath(); ctx.arc(m.x, m.y, m.width * 3.5, 0, Math.PI * 2); ctx.fill();

                    if (t < 0.3 && fragments.length < 20 && Math.random() < 0.25) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = (1.2 + Math.random() * 2) * scale;
                        const fLife = 14 + Math.random() * 10;
                        fragments.push({ x: m.x, y: m.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: fLife, maxLife: fLife, hue: m.hue });
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
                ctx.arc(f.x, f.y, Math.max(0.4, 1.4 * scale * ft), 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${f.hue}, 90%, 85%, ${0.9 * ft * env})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [duration]);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}

// ── 晨曦微光（Sunbeam） ────────────────────────────────────────────
const DUST_COUNT = 22;

type Dust = {
    x: number; y: number;
    vx: number; vy: number;
    r: number;
    breathPhase: number;
    breathFreq: number;
    inBeam: boolean;
};

type Beam = {
    originX: number;
    angle: number;
    width: number;
    length: number;
    alpha: number;
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

            // 右上角温暖金橙柔光基底（径向渐变，不是 fillRect，没有硬边）
            const ambientGrad = ctx.createRadialGradient(W * 0.78, 0, 0, W * 0.78, 0, W * 0.75);
            ambientGrad.addColorStop(0,   `rgba(255, 220, 120, ${0.18 * env})`);
            ambientGrad.addColorStop(0.5, `rgba(255, 195, 80,  ${0.08 * env})`);
            ambientGrad.addColorStop(1,   `rgba(255, 180, 60,  0)`);
            ctx.fillStyle = ambientGrad;
            ctx.fillRect(0, 0, W, H);

            // 修复：光柱改用两端径向渐变羽化，彻底消除纸片方块感
            for (const beam of beams) {
                const breathAlpha = beam.alpha * (0.75 + 0.25 * Math.sin(beamPhase + beam.angle)) * env;
                if (breathAlpha <= 0.005) continue;

                ctx.save();
                ctx.translate(beam.originX, -10);
                ctx.rotate(beam.angle - Math.PI / 2);

                const topW = beam.width * 0.18;
                const botW = beam.width;
                const len = beam.length;

                // 用线性渐变：顶部淡入 → 中段最亮 → 底部淡出，消除末端硬切
                const beamGrad = ctx.createLinearGradient(0, 0, 0, len);
                beamGrad.addColorStop(0,    `rgba(255, 215, 100, 0)`);
                beamGrad.addColorStop(0.08, `rgba(255, 215, 100, ${breathAlpha * 0.80})`);
                beamGrad.addColorStop(0.45, `rgba(255, 210, 90,  ${breathAlpha * 0.55})`);
                beamGrad.addColorStop(0.78, `rgba(255, 200, 80,  ${breathAlpha * 0.18})`);
                beamGrad.addColorStop(1,    `rgba(255, 190, 70,  0)`);

                // 左右羽化：用两侧软渐变遮罩模拟光柱边缘衰减
                // 画法：先 clip 住梯形区域，再用宽渐变填充
                ctx.beginPath();
                ctx.moveTo(-topW / 2, 0);
                ctx.lineTo(topW / 2, 0);
                ctx.lineTo(botW / 2, len);
                ctx.lineTo(-botW / 2, len);
                ctx.closePath();
                ctx.clip();

                // 填充比梯形宽一圈的渐变矩形，让边缘自然衰减
                const fadeGrad = ctx.createLinearGradient(-botW / 2, 0, botW / 2, 0);
                fadeGrad.addColorStop(0,    "rgba(255, 210, 90, 0)");
                fadeGrad.addColorStop(0.12, `rgba(255, 210, 90, ${breathAlpha})`);
                fadeGrad.addColorStop(0.88, `rgba(255, 210, 90, ${breathAlpha})`);
                fadeGrad.addColorStop(1,    "rgba(255, 210, 90, 0)");

                // 叠加两个渐变：纵向（长度方向）× 横向（宽度方向）
                ctx.fillStyle = beamGrad;
                ctx.fillRect(-botW / 2, 0, botW, len);

                ctx.globalCompositeOperation = "destination-in";
                ctx.fillStyle = fadeGrad;
                ctx.fillRect(-botW / 2, 0, botW, len);
                ctx.globalCompositeOperation = "source-over";

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
