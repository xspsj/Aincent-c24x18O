"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui";
import { buildTestLetterMail, sendLetterMail } from "@/lib/letter-mail-client";
import {
  QQ_MAIL_ADDRESS_PATTERN,
  QQ_MAIL_AUTH_CODE_PATTERN,
  clearLetterMailConfig,
  loadLetterMailConfig,
  saveLetterMailConfig,
} from "@/lib/letter-storage";
import type { LetterMailConfig } from "@/lib/letter-types";

type LetterMailSettingsProps = {
  onNotice?: (message: string) => void;
};

type Feedback = { tone: "ok" | "error"; text: string } | null;

function validate(address: string, authCode: string): string | null {
  if (!QQ_MAIL_ADDRESS_PATTERN.test(address)) return "请填写 QQ 邮箱地址（@qq.com / @foxmail.com / @vip.qq.com）。";
  if (!QQ_MAIL_AUTH_CODE_PATTERN.test(authCode)) return "授权码应为 16 位字母，请检查是否复制完整。";
  return null;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

export function LetterMailSettings({ onNotice }: LetterMailSettingsProps) {
  const [config, setConfig] = useState<LetterMailConfig | null>(null);
  const [address, setAddress] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const saved = loadLetterMailConfig();
    setConfig(saved);
    setAddress(saved?.address ?? "");
    setAuthCode(saved?.authCode ?? "");
  }, []);

  const normalizedAddress = address.trim().toLowerCase();
  const normalizedCode = authCode.replace(/\s+/g, "");
  const dirty = normalizedAddress !== (config?.address ?? "") || normalizedCode !== (config?.authCode ?? "");

  const handleSave = () => {
    const error = validate(normalizedAddress, normalizedCode);
    if (error) {
      setFeedback({ tone: "error", text: error });
      return;
    }
    // 改了邮箱或授权码，之前的「已验证」不再作数
    const next = saveLetterMailConfig({
      address: normalizedAddress,
      authCode: normalizedCode,
      verifiedAt: dirty ? undefined : config?.verifiedAt,
    });
    setConfig(next);
    setFeedback({ tone: "ok", text: "已保存。建议发一封测试信确认能收到。" });
    onNotice?.("QQ 邮箱已保存");
  };

  const handleTest = async () => {
    if (testing) return;
    const error = validate(normalizedAddress, normalizedCode);
    if (error) {
      setFeedback({ tone: "error", text: error });
      return;
    }
    setTesting(true);
    setFeedback(null);
    const result = await sendLetterMail({ address: normalizedAddress, authCode: normalizedCode }, buildTestLetterMail());
    setTesting(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    // 测试通过说明这组邮箱和授权码可用，顺手保存
    const next = saveLetterMailConfig({
      address: normalizedAddress,
      authCode: normalizedCode,
      verifiedAt: new Date().toISOString(),
    });
    setConfig(next);
    setFeedback({ tone: "ok", text: `测试信已发出，去 ${normalizedAddress} 收件箱看看。没看到的话也翻一下垃圾箱。` });
  };

  const handleClear = () => {
    clearLetterMailConfig();
    setConfig(null);
    setAddress("");
    setAuthCode("");
    setFeedback(null);
    setConfirmClear(false);
    onNotice?.("QQ 邮箱已清除");
  };

  const status = !config
    ? { tone: "off", text: "未配置" }
    : config.verifiedAt
      ? { tone: "on", text: `已验证 · ${formatTime(config.verifiedAt)}` }
      : { tone: "warn", text: "已保存，未发过测试信" };

  return (
    <section className="lt-mail-panel" aria-labelledby="lt-mail-title">
      <h2 id="lt-mail-title" className="lt-mail-title">QQ 邮箱</h2>

      <div className="lt-mail-field">
        <span className="lt-mail-label">状态</span>
        <div className={`lt-mail-status lt-mail-status-${status.tone}`}>
          <span className="lt-mail-status-dot" aria-hidden="true" />
          {status.text}
        </div>
      </div>

      <label className="lt-mail-field">
        <span className="lt-mail-label">QQ 邮箱地址</span>
        <input
          className="lt-mail-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="如 xxx@qq.com"
          value={address}
          onChange={event => setAddress(event.target.value)}
        />
      </label>

      <label className="lt-mail-field">
        <span className="lt-mail-label">SMTP 授权码</span>
        <span className="lt-mail-input-wrap">
          <input
            className="lt-mail-input"
            type={showCode ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="不是 QQ 登录密码"
            value={authCode}
            onChange={event => setAuthCode(event.target.value)}
          />
          <button
            type="button"
            className="lt-mail-eye"
            onClick={() => setShowCode(value => !value)}
            aria-label={showCode ? "隐藏授权码" : "显示授权码"}
          >
            {showCode ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>

      <p className="lt-mail-hint">
        授权码 ≠ QQ 登录密码<br />
        获取方法：QQ 邮箱设置 → 账户 → POP3/SMTP 服务 → 开启并生成授权码<br />
        授权码只保存在这台设备上，不会写进备份文件。
      </p>

      {feedback ? (
        <p className={`lt-mail-feedback lt-mail-feedback-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}

      <div className="lt-mail-actions">
        <button
          type="button"
          className="lt-mail-btn lt-mail-btn-danger"
          onClick={() => setConfirmClear(true)}
          disabled={!config && !address && !authCode}
        >
          清除
        </button>
        <button type="button" className="lt-mail-btn" onClick={handleSave} disabled={!dirty}>
          保存
        </button>
      </div>
      <button type="button" className="lt-mail-btn lt-mail-btn-primary" onClick={() => void handleTest()} disabled={testing}>
        {testing ? <><Loader2 size={16} className="animate-spin" /> 正在发送…</> : "发送测试信"}
      </button>

      {confirmClear ? (
        <ConfirmDialog
          title="清除 QQ 邮箱？"
          message="清除后，角色写的信只会留在手机里，不再投递到 QQ 邮箱。已有的信不受影响。"
          variant="danger"
          confirmLabel="清除"
          cancelLabel="取消"
          onConfirm={handleClear}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </section>
  );
}
