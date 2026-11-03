import type { Letter, LetterMailConfig } from "./letter-types";

export type LetterMailSendInput = {
  toAddress?: string;
  fromName: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * - ok：确定寄到了
 * - uncertain：正文可能已经交给 QQ 了，但没拿到回执。不要自动重试
 * - failed：确定没寄出，可以重试
 */
export type LetterMailSendResult =
  | { status: "ok" }
  | { status: "uncertain"; error: string }
  | { status: "failed"; error: string };

const UNCERTAIN_HINT = "信可能已经寄到了，但没等到确认。请先去 QQ 邮箱看看，不要急着重发。";

/** 调站点后端发信。邮箱和授权码随请求带上，站点不保存。 */
export async function sendLetterMail(
  config: Pick<LetterMailConfig, "address" | "authCode">,
  input: LetterMailSendInput,
): Promise<LetterMailSendResult> {
  let response: Response;
  try {
    response = await fetch("/api/letters/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        address: config.address,
        authCode: config.authCode,
        toAddress: input.toAddress,
        fromName: input.fromName,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
  } catch (err) {
    return { status: "uncertain", error: `${UNCERTAIN_HINT}（网络中断：${err instanceof Error ? err.message : String(err)}）` };
  }

  const data = await response.json().catch(() => null) as { ok?: boolean; error?: unknown; maybeSent?: unknown } | null;
  if (response.ok && data?.ok) return { status: "ok" };

  const error = typeof data?.error === "string" ? data.error : `发信失败（HTTP ${response.status}）`;
  if (data?.maybeSent === true) return { status: "uncertain", error };

  if (!data && [502, 503, 504].includes(response.status)) {
    return { status: "uncertain", error: `${UNCERTAIN_HINT}（HTTP ${response.status}）` };
  }
  if (response.status === 404) {
    return { status: "failed", error: "本站没有发信接口（404）。请确认部署的是包含信件功能的版本，并且不是纯静态导出。" };
  }
  return { status: "failed", error };
}

export function buildTestLetterMail(): LetterMailSendInput {
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  return {
    fromName: "Float 信箱",
    subject: "信箱连通测试",
    text: `这是一封测试信。\n\n收到它，说明 Float 已经能用你的 QQ 邮箱投递信件了。之后角色写给你的信也会这样送到这里。\n\n发送时间：${time}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatLetterDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 把一封信做成邮件：纯文本 + 信纸样式的 HTML。落款日期为实际写信日期（createdAt）。 */
export function buildLetterMail(letter: Letter): LetterMailSendInput {
  const writtenDate = formatLetterDate(letter.createdAt);
  const signature = letter.signature || letter.characterName;
  const isScheduled = letter.deliveryMode === "scheduled";
  const unlockDate = formatLetterDate(letter.unlockAt);

  const textLines = [
    letter.title,
    "",
    letter.body,
    "",
    `—— ${signature}`,
    `写于 ${writtenDate}${isScheduled ? `（约定于 ${unlockDate} 启封送达）` : ""}`,
    "",
    `（这封信由 ${letter.characterName} 从 Float 寄出）`,
  ];

  const paragraphs = letter.body
    .split(/\n{2,}/)
    .map(part => `<p style="margin:0 0 1em;">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#efebe2;">
<div style="max-width:560px;margin:0 auto;padding:36px 30px;background:#fbf8f1;border:1px solid #e3dccd;color:#3a342c;font-family:'Songti SC','STSong','Noto Serif SC',serif;font-size:16px;line-height:1.9;">
<h1 style="margin:0 0 24px;font-size:20px;font-weight:600;letter-spacing:1px;">${escapeHtml(letter.title)}</h1>
${paragraphs}
<p style="margin:28px 0 0;text-align:right;">—— ${escapeHtml(signature)}</p>
<p style="margin:4px 0 0;text-align:right;color:#8a8070;font-size:13px;">写于 ${escapeHtml(writtenDate)}${isScheduled ? ` <span style="font-size:11px;color:#a09482;">(约定于 ${escapeHtml(unlockDate)} 启封)</span>` : ""}</p>
</div>
<p style="max-width:560px;margin:14px auto 0;text-align:center;color:#a39a8a;font-size:12px;font-family:sans-serif;">这封信由 ${escapeHtml(letter.characterName)} 从 Float 寄出</p>
</body></html>`;

  return {
    fromName: letter.characterName,
    subject: letter.title,
    text: textLines.join("\n"),
    html,
  };
}
