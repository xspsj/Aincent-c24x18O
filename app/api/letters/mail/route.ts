import { NextResponse } from "next/server";

import { cleanAccountText, getCurrentAccount } from "@/lib/server/account-auth";
import { describeQqSmtpError, sendQqMail } from "@/lib/server/qq-smtp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 信件投递：用用户自己的 QQ 邮箱 + SMTP 授权码，把角色写的信发到这个邮箱本身。
 *
 * 邮箱和授权码由浏览器每次随请求带上，站点不保存。收件人固定等于发件人，
 * 所以这个接口最多只能让人「给自己发信」，不能用来给别人发垃圾邮件。
 *
 * 返回体里的 maybeSent=true 表示正文已经交给 QQ、但没等到回执：信可能已经
 * 寄到了，调用方不要自动重试（否则会重复投递）。
 */

const QQ_MAIL_ADDRESS_PATTERN = /^[a-z0-9._-]{1,64}@(qq\.com|vip\.qq\.com|foxmail\.com)$/i;
const QQ_MAIL_AUTH_CODE_PATTERN = /^[a-z]{16}$/i;
const MAX_SUBJECT = 120;
const MAX_TEXT = 12_000;
const MAX_HTML = 40_000;

// 尽力而为的频控：Serverless 实例之间不共享内存，只能挡住单实例上的连发
// （比如前端 bug 死循环、有人拿接口试授权码）。
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 12;
const recentSends = new Map<string, number[]>();

function allowSend(key: string): boolean {
  const now = Date.now();
  const recent = (recentSends.get(key) ?? []).filter(time => now - time < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    recentSends.set(key, recent);
    return false;
  }
  recent.push(now);
  recentSends.set(key, recent);
  return true;
}

function fail(error: string, status: number, maybeSent = false) {
  return NextResponse.json({ ok: false, error, maybeSent }, { status });
}

export async function POST(request: Request) {
  let account;
  try {
    account = await getCurrentAccount(request);
  } catch {
    return fail("账号校验失败，请稍后再试。", 500);
  }
  if (!account) return fail("请先登录账号。", 401);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const address = cleanAccountText(body.address, 254).toLowerCase();
  const authCode = cleanAccountText(body.authCode, 64).replace(/\s+/g, "");
  const fromName = cleanAccountText(body.fromName, 40);
  const subject = cleanAccountText(body.subject, MAX_SUBJECT);
  const text = String(body.text ?? "").replace(/\u0000/g, "");
  const html = typeof body.html === "string" ? body.html.replace(/\u0000/g, "") : "";

  if (!QQ_MAIL_ADDRESS_PATTERN.test(address)) return fail("请填写 QQ 邮箱地址（@qq.com / @foxmail.com / @vip.qq.com）。", 400);
  if (!QQ_MAIL_AUTH_CODE_PATTERN.test(authCode)) return fail("授权码应为 16 位字母，请检查是否复制完整。", 400);
  if (!text.trim()) return fail("信件正文为空。", 400);
  if (text.length > MAX_TEXT || html.length > MAX_HTML) return fail("信件太长了。", 413);

  if (!allowSend(`${account.id}:${address}`)) return fail("发信太频繁，请过几分钟再试。", 429);

  try {
    await sendQqMail({ address, authCode, fromName, subject, text, html: html || undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { message, status, maybeSent } = describeQqSmtpError(err);
    console.warn("[LetterMail] send failed:", message);
    return fail(message, status, maybeSent);
  }
}
