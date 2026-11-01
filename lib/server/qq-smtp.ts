import { randomBytes } from "node:crypto";
import tls from "node:tls";

// 最小 SMTP 客户端，只做一件事：用 QQ 邮箱 SMTP 授权码，从用户自己的 QQ 邮箱
// 发一封信给自己。
//
// 为什么不用 nodemailer：加依赖要同步更新 package-lock.json，在线提交时容易
// 让 Netlify 的安装步骤失败。这里需要的只是 465 端口隐式 TLS + AUTH LOGIN +
// 一封 UTF-8 正文，用 node:tls 自己写几十行就够了。
//
// 安全约束（改动前先读）：
//   - 主机固定为 smtp.qq.com，不接受调用方传入主机；
//   - 收件人固定等于发件人（自己发给自己），接口不能被当成开放中继；
//   - 授权码只出现在 AUTH 指令里，任何报错文本都不包含它。

const SMTP_HOST = "smtp.qq.com";
const SMTP_PORT = 465;
/** 单步等待上限。Netlify 函数默认约 26 秒超时，整体要留余量。 */
const STEP_TIMEOUT_MS = 12_000;

export type QqSmtpStage = "connect" | "auth" | "send";

export class QqSmtpError extends Error {
  constructor(public stage: QqSmtpStage, message: string, public code?: number) {
    super(message);
    this.name = "QqSmtpError";
  }
}

export type QqMailInput = {
  address: string;
  authCode: string;
  fromName: string;
  subject: string;
  text: string;
  html?: string;
};

type SmtpReply = { code: number; text: string };

/** 头部用的 RFC 2047 编码，按字符切块，避免单个 encoded-word 过长、也不切断汉字。 */
function encodeHeaderWord(value: string): string {
  const chars = Array.from(value);
  const chunks: string[] = [];
  let current = "";
  for (const char of chars) {
    if (Buffer.byteLength(current + char, "utf8") > 42) {
      chunks.push(current);
      current = "";
    }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks.map(chunk => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`).join("\r\n ");
}

function base64Lines(value: string): string {
  return (Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function buildMessage(input: QqMailInput): string {
  const domain = input.address.split("@")[1] || "qq.com";
  const fromName = stripLineBreaks(input.fromName) || "小手机信箱";
  const headers = [
    `From: ${encodeHeaderWord(fromName)} <${input.address}>`,
    `To: <${input.address}>`,
    `Subject: ${encodeHeaderWord(stripLineBreaks(input.subject) || "一封信")}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
  ];

  if (!input.html) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(input.text),
    ].join("\r\n");
  }

  const boundary = `=_letter_${randomBytes(10).toString("hex")}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.html),
    `--${boundary}--`,
  ].join("\r\n");
  // base64 字母表里没有「.」，所以正文不会出现以「.」开头的行，不需要 dot-stuffing。
}

/** 把服务器多行应答（250-xxx ... 250 xxx）拼成一条。 */
function createReplyReader(socket: tls.TLSSocket) {
  let buffer = "";
  let lines: string[] = [];
  const ready: SmtpReply[] = [];
  let waiter: { resolve: (reply: SmtpReply) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  let failure: Error | null = null;

  const flush = () => {
    if (waiter && ready.length > 0) {
      const current = waiter;
      waiter = null;
      clearTimeout(current.timer);
      current.resolve(ready.shift()!);
    } else if (waiter && failure) {
      const current = waiter;
      waiter = null;
      clearTimeout(current.timer);
      current.reject(failure);
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      lines.push(line);
      // 「250 ok」第 4 位是空格表示最后一行；「250-xxx」是续行
      if (/^\d{3}(?: |$)/.test(line)) {
        ready.push({ code: Number(line.slice(0, 3)), text: lines.map(item => item.slice(4)).join(" ").slice(0, 200) });
        lines = [];
      }
    }
    flush();
  });
  const fail = (err: Error) => {
    failure = failure ?? err;
    flush();
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("连接被服务器关闭")));

  return (stage: QqSmtpStage): Promise<SmtpReply> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiter = null;
      reject(new QqSmtpError(stage, "QQ 邮箱服务器响应超时"));
    }, STEP_TIMEOUT_MS);
    waiter = { resolve, reject, timer };
    flush();
  });
}

function connect(): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new QqSmtpError("connect", "连接 QQ 邮箱服务器超时"));
    }, STEP_TIMEOUT_MS);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", err => {
      clearTimeout(timer);
      reject(new QqSmtpError("connect", `无法连接 QQ 邮箱服务器（${err.message}）`));
    });
  });
}

/** 发信。成功返回服务器给的队列信息，失败抛 QqSmtpError。 */
export async function sendQqMail(input: QqMailInput): Promise<{ response: string }> {
  const socket = await connect();
  // 连上后立即挂读取器：服务器的 220 欢迎语可能在下一行代码之前就到了
  const read = createReplyReader(socket);
  const write = (line: string) => socket.write(`${line}\r\n`);

  const expect = async (stage: QqSmtpStage, accepted: number[], failMessage: string): Promise<SmtpReply> => {
    let reply: SmtpReply;
    try {
      reply = await read(stage);
    } catch (err) {
      if (err instanceof QqSmtpError) throw err;
      throw new QqSmtpError(stage, err instanceof Error ? err.message : String(err));
    }
    if (!accepted.includes(reply.code)) {
      throw new QqSmtpError(stage, `${failMessage}（${reply.code} ${reply.text}）`, reply.code);
    }
    return reply;
  };

  try {
    await expect("connect", [220], "QQ 邮箱服务器拒绝连接");
    write("EHLO ai-phone.local");
    await expect("connect", [250], "QQ 邮箱服务器握手失败");

    write("AUTH LOGIN");
    await expect("auth", [334], "QQ 邮箱不接受登录");
    write(Buffer.from(input.address, "utf8").toString("base64"));
    await expect("auth", [334], "邮箱地址被拒绝");
    write(Buffer.from(input.authCode, "utf8").toString("base64"));
    await expect("auth", [235], "登录失败");

    write(`MAIL FROM:<${input.address}>`);
    await expect("send", [250], "发件人被拒绝");
    write(`RCPT TO:<${input.address}>`);
    await expect("send", [250, 251], "收件人被拒绝");
    write("DATA");
    await expect("send", [354], "服务器不接受正文");
    socket.write(`${buildMessage(input)}\r\n.\r\n`);
    const accepted = await expect("send", [250], "邮件被拒收");

    write("QUIT");
    return { response: accepted.text };
  } finally {
    socket.destroy();
  }
}

/** 给前端看的错误说明。不包含授权码。 */
export function describeQqSmtpError(err: unknown): { message: string; status: number } {
  if (err instanceof QqSmtpError) {
    if (err.stage === "auth" && (err.code === 535 || err.code === 534 || err.code === 530)) {
      return {
        message: "QQ 邮箱登录失败：授权码不对，或者邮箱还没开启 SMTP 服务。授权码不是 QQ 密码，请到 QQ 邮箱「设置 → 账户 → POP3/SMTP 服务」重新生成。",
        status: 401,
      };
    }
    if (err.stage === "send" && (err.code === 550 || err.code === 554)) {
      return { message: `QQ 邮箱拒收了这封信，可能被判为垃圾邮件或发信太频繁。${err.message}`, status: 502 };
    }
    return { message: err.message, status: err.stage === "connect" ? 504 : 502 };
  }
  return { message: "发信失败，请稍后再试。", status: 500 };
}
