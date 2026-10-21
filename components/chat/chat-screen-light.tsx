"use client";

// 光效系全屏特效 Canvas 渲染器：流星（三级概率分级）/ 晨曦微光（丁达尔光柱+微尘）。

import { useEffect, useRef } from "react";

function envAlpha(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
    if (elapsed < fadeIn) return elapsed / fadeIn;
    if (elapsed > duration - fadeOut) return Math.max(0, (duration - elapsed) / fadeOut);
    return 1;
}

// ── 流星（Shooting Star）三级概率分级 ─────────────────────────────
// 50% 掠影（4~6 道）/ 35% 群星（8~14 道）/ 15% 火流星（群星 + 1 颗超亮主星）

type Meteor = {
    x: number; y: number;       // 起始坐标
    vx: number; vy: number;     // 速度（确定划过方向与速度）
    len: number;                // 彗尾长度
    alpha: number;              // 峰值透明度
    life: number; maxLife: number;
    hue: number;                // 彗尾主色调（冷蓝白 / 暖金 for 火流星）
    isBolide: boolean;          // 是否为火流星主星
    width: number;              // 线宽
};

function makeMeteor(W: number, H: number, scale: number, isBolide = false): Meteor {
    // 从屏幕上半区随机位置出发，斜向右下方划过
    const startX = W * (0.1 + Math.random() * 0.7);
    const startY = H * (0.02 + Math.random() * 0.35);
    const angle = (Math.PI / 4) + (Math.random() - 0.5) * 0.4; // 约 45°±23°
    const speed = isBolide
        ? (18 + Math.random() * 8) * scale
        : (10 + Math.random() * 10) * scale;
    const life = isBolide ? 28 + Math.random() * 10 : 22 + Math.random() * 14;
    return {
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: isBolide ? (110 + Math.random() * 60) * scale : (55 + Math.random() * 55) * scale,
        alpha: isBolide ? 0.95 : 0.55 + Math.random() * 0.35,
        life, maxLife: life,
        hue: isBolide ? 45 + Math.random() * 20 : 200 + Math.random() * 40, // 火流星暖金；普通冷蓝白
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

        // 三级概率分级
        const roll = Math.random();
        const isSparse  = roll < 0.50;          // 50%：掠影 4~6 道
        const isShower  = roll < 0.85;          // 35%：群星 8~14 道
        const isBolide  = !isShower;            // 15%：火流星（群星 + 超亮主星）

        const baseCount = isSparse ? 4 + Math.floor(Math.random() * 3)     // 4~6
                        : isShower ? 8 + Math.floor(Math.random() * 7)     // 8~14
                        : 9 + Math.floor(Math.random() * 6);               // 9~14 + 主星

        // 生成流星，用时间差错落出场（越靠后的出场越晚）
        const meteors: (Meteor & { delay: number })[] = Array.from({ length: baseCount }, (_, i) => ({
            ...makeMeteor(W, H, scale, false),
            delay: i * (isSparse ? 320 : 180) + Math.random() * 200,
        }));

        // 火流星：主星在 400~700ms 后登场
        if (isBolide) {
            meteors.push({ ...makeMeteor(W, H, scale, true), delay: 400 + Math.random() * 300 });
        }

        // 火流星碎星粒子
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

            // 深夜背景覆盖层（流星必须在深色背景下才有冲击感）
            ctx.fillStyle = `rgba(5, 8, 22, ${0.45 * env})`;
            ctx.fillRect(0, 0, W, H);

            // 流星
            for (const m of meteors) {
                if (elapsed < m.delay) continue;
                m.x += m.vx * dt;
                m.y += m.vy * dt;
                m.life -= dt;
                if (m.life <= 0) continue;

                const t = m.life / m.maxLife;
                const alpha = m.alpha * t * env;
                if (alpha <= 0.01) continue;

                // 彗尾：从当前位置往后退 len，渐变透明
                const tailX = m.x - (m.vx / Math.hypot(m.vx, m.vy)) * m.len;
                const tailY = m.y - (m.vy / Math.hypot(m.vx, m.vy)) * m.len;

                const grad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
                if (m.isBolide) {
                    grad.addColorStop(0, `hsla(${m.hue}, 90%, 70%, 0)`);
                    grad.addColorStop(0.5, `hsla(${m.hue}, 95%, 82%, ${alpha * 0.5})`);
                    grad.addColorStop(0.85, `hsla(${m.hue + 20}, 80%, 88%, ${alpha * 0.85})`);
                    grad.addColorStop(1, `rgba(255, 255, 240, ${alpha})`);
                } else {
                    grad.addColorStop(0, `hsla(${m.hue}, 80%, 75%, 0)`);
                    grad.addColorStop(0.7, `hsla(${m.hue}, 85%, 88%, ${alpha * 0.6})`);
                    grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);
                }

                // 外圈柔光（火流星更宽）
                ctx.strokeStyle = grad;
                ctx.lineWidth = m.width * (m.isBolide ? 3.5 : 2.4);
                ctx.globalAlpha = 0.18;
                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(m.x, m.y);
                ctx.stroke();

                // 内核亮线
                ctx.globalAlpha = 1;
                ctx.strokeStyle = grad;
                ctx.lineWidth = m.width;
                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(m.x, m.y);
                ctx.stroke();

                // 火流星：头部超亮光点 + 快结束时爆出碎星
                if (m.isBolide) {
                    const coreGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.width * 3.5);
                    coreGrad.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
                    coreGrad.addColorStop(1, `rgba(255, 200, 100, 0)`);
                    ctx.fillStyle = coreGrad;
                    ctx.beginPath();
                    ctx.arc(m.x, m.y, m.width * 3.5, 0, Math.PI * 2);
                    ctx.fill();

                    // 生命末段爆出碎星
                    if (t < 0.3 && fragments.length < 20 && Math.random() < 0.25) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = (1.2 + Math.random() * 2) * scale;
                        const fLife = 14 + Math.random() * 10;
                        fragments.push({
                            x: m.x, y: m.y,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            life: fLife, maxLife: fLife,
                            hue: m.hue,
                        });
                    }
                }
            }

            // 碎星粒子
            for (let i = fragments.length - 1; i >= 0; i--) {
                const f = fragments[i];
                f.x += f.vx * dt;
                f.y += f.vy * dt;
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
// 3 层：金色柔光基底 + 丁达尔斜射光柱（2~3 道）+ 光柱内微尘布朗运动

const DUST_COUNT = 22;

type Dust = {
    x: number; y: number;
    vx: number; vy: number;
    r: number;
    breathPhase: number;
    breathFreq: number;
    inBeam: boolean;   // 是否在光柱内（影响亮度）
};

type Beam = {
    originX: number;    // 光柱顶端 x
    angle: number;      // 向右下方的角度（弧度）
    width: number;      // 光柱宽度
    length: number;     // 光柱长度
    alpha: number;      // 峰值透明度
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

        // 光柱：2~3 道，从屏幕右上角扇形射下
        const beamCount = 2 + Math.floor(Math.random() * 2);
        const beams: Beam[] = Array.from({ length: beamCount }, (_, i) => ({
            originX: W * (0.55 + i * 0.15 + Math.random() * 0.1),
            angle: (Math.PI / 2) + 0.18 + i * 0.22 + (Math.random() - 0.5) * 0.1, // 约 100°~130°，向左下射
            width: (38 + Math.random() * 32) * scale,
            length: H * (0.55 + Math.random() * 0.3),
            alpha: 0.10 + Math.random() * 0.08,
        }));

        // 微尘：在光柱照射区域浮动
        const dusts: Dust[] = Array.from({ length: DUST_COUNT }, () => ({
            x: W * 0.3 + Math.random() * W * 0.5,
            y: H * 0.08 + Math.random() * H * 0.55,
            vx: (Math.random() - 0.5) * 0.25 * scale,
            vy: -(0.04 + Math.random() * 0.10) * scale,  // 缓缓向上漂
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

            // 第 1 层：右上角温暖金橙柔光基底
            const ambientGrad = ctx.createRadialGradient(W * 0.78, 0, 0, W * 0.78, 0, W * 0.75);
            ambientGrad.addColorStop(0, `rgba(255, 220, 120, ${0.18 * env})`);
            ambientGrad.addColorStop(0.5, `rgba(255, 195, 80, ${0.08 * env})`);
            ambientGrad.addColorStop(1, `rgba(255, 180, 60, 0)`);
            ctx.fillStyle = ambientGrad;
            ctx.fillRect(0, 0, W, H);

            // 第 2 层：丁达尔光柱（梯形渐变，带呼吸律动）
            for (const beam of beams) {
                const breathAlpha = beam.alpha * (0.75 + 0.25 * Math.sin(beamPhase + beam.angle)) * env;
                if (breathAlpha <= 0.005) continue;

                ctx.save();
                ctx.translate(beam.originX, -10);
                ctx.rotate(beam.angle - Math.PI / 2);

                // 梯形光柱：顶窄底宽，用线性渐变（头部亮尾部透明）
                const beamGrad = ctx.createLinearGradient(0, 0, 0, beam.length);
                beamGrad.addColorStop(0,    `rgba(255, 215, 100, ${breathAlpha * 0.85})`);
                beamGrad.addColorStop(0.35, `rgba(255, 210, 90, ${breathAlpha * 0.55})`);
                beamGrad.addColorStop(0.75, `rgba(255, 200, 80, ${breathAlpha * 0.18})`);
                beamGrad.addColorStop(1,    `rgba(255, 190, 70, 0)`);

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

            // 第 3 层：微尘粒子（在光柱内更亮）
            for (const d of dusts) {
                d.x += d.vx * dt + Math.sin(t * 0.3 + d.breathPhase) * 0.18 * scale * dt;
                d.y += d.vy * dt;

                if (d.y < -10) { d.y = H * 0.6 + Math.random() * H * 0.3; d.x = W * 0.3 + Math.random() * W * 0.5; }
                if (d.x < W * 0.1 || d.x > W * 0.9) d.vx = -d.vx;

                // 判断是否在任意光柱内（简单距离判断）
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
