import type { LetterMailConfig } from "./letter-types";

export type LetterMailSendInput = {
  fromName: string;
  subject: string;
  text: string;
  html?: string;
};

export type LetterMailSendResult = { ok: true } | { ok: false; error: string };

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
        fromName: input.fromName,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
  } catch (err) {
    return { ok: false, error: `连不上本站的发信接口：${err instanceof Error ? err.message : String(err)}` };
  }

  const data = await response.json().catch(() => null) as { ok?: boolean; error?: unknown } | null;
  if (response.ok && data?.ok) return { ok: true };
  if (response.status === 404) {
    return { ok: false, error: "本站没有发信接口（404）。请确认部署的是包含信件功能的版本，并且不是纯静态导出。" };
  }
  return { ok: false, error: typeof data?.error === "string" ? data.error : `发信失败（HTTP ${response.status}）` };
}

export function buildTestLetterMail(): LetterMailSendInput {
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  return {
    fromName: "小手机信箱",
    subject: "信箱连通测试",
    text: `这是一封测试信。\n\n收到它，说明小手机已经能用你的 QQ 邮箱投递信件了。之后角色写给你的信也会这样送到这里。\n\n发送时间：${time}`,
  };
}
