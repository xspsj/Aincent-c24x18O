"use client";

import { useEffect, useState } from "react";
import { Check, Mail, Plus, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import {
  addLetterSafeContact,
  clearLetterMailConfig,
  deleteLetterSafeContact,
  loadLetterMailConfig,
  loadLetterSafeContacts,
  loadLetterUserInbox,
  saveLetterMailConfig,
  saveLetterUserInbox,
} from "@/lib/letter-storage";
import type { LetterMailConfig, LetterSafeContact } from "@/lib/letter-types";
import { buildTestLetterMail, sendLetterMail } from "@/lib/letter-mail-client";
import { ConfirmDialog } from "@/components/ui/modal";

type CharMailboxSettingsProps = {
  onNotice: (msg: string) => void;
};

export function CharMailboxSettings({ onNotice }: CharMailboxSettingsProps) {
  // ── 卡片 1：我的接收邮箱 ──
  const [userInbox, setUserInbox] = useState("");
  const [userInboxSaved, setUserInboxSaved] = useState(false);

  // ── 卡片 2：角色专属发信邮箱 ──
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [charEmail, setCharEmail] = useState("");
  const [charAuthCode, setCharAuthCode] = useState("");
  const [showAuthCode, setShowAuthCode] = useState(false);
  const [charVerifiedAt, setCharVerifiedAt] = useState<string | undefined>();
  const [testing, setTesting] = useState(false);
  const [charStatusMsg, setCharStatusMsg] = useState("");
  const [confirmClearChar, setConfirmClearChar] = useState(false);

  // ── 卡片 3：安全通讯录白名单 ──
  const [contacts, setContacts] = useState<LetterSafeContact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactRelation, setNewContactRelation] = useState("");
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);

  // 初始化加载
  useEffect(() => {
    const inbox = loadLetterUserInbox();
    if (inbox) setUserInbox(inbox.address);

    const chars = loadCharacters();
    setCharacters(chars);
    if (chars.length > 0) {
      setSelectedCharId(chars[0].id);
    }

    setContacts(loadLetterSafeContacts());
  }, []);

  // 切换角色时刷新该角色的发信配置
  useEffect(() => {
    if (!selectedCharId) return;
    const cfg = loadLetterMailConfig(selectedCharId);
    if (cfg) {
      setCharEmail(cfg.address);
      setCharAuthCode(cfg.authCode);
      setCharVerifiedAt(cfg.verifiedAt);
    } else {
      setCharEmail("");
      setCharAuthCode("");
      setCharVerifiedAt(undefined);
    }
    setCharStatusMsg("");
  }, [selectedCharId]);

  // 保存我的接收邮箱
  const handleSaveInbox = () => {
    const clean = userInbox.trim().toLowerCase();
    if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      onNotice("邮箱格式不正确");
      return;
    }
    saveLetterUserInbox(clean);
    setUserInboxSaved(true);
    setTimeout(() => setUserInboxSaved(false), 2000);
    onNotice("已保存接收邮箱");
  };

  // 保存角色发信邮箱
  const handleSaveCharMail = () => {
    if (!selectedCharId) return;
    const addr = charEmail.trim().toLowerCase();
    const code = charAuthCode.trim();
    if (!addr || !code) {
      onNotice("请填写完整的发件邮箱和授权码");
      return;
    }
    saveLetterMailConfig(selectedCharId, {
      address: addr,
      authCode: code,
      verifiedAt: charVerifiedAt,
    });
    onNotice("已保存该角色的发件邮箱");
  };

  // 清除角色发信配置
  const handleClearCharMail = () => {
    if (!selectedCharId) return;
    clearLetterMailConfig(selectedCharId);
    setCharEmail("");
    setCharAuthCode("");
    setCharVerifiedAt(undefined);
    setConfirmClearChar(false);
    onNotice("已清除该角色的邮箱配置");
  };

  // 测试发信（从角色发信邮箱寄到我的接收邮箱）
  const handleTestSend = async () => {
    const addr = charEmail.trim().toLowerCase();
    const code = charAuthCode.trim();
    const target = userInbox.trim().toLowerCase();

    if (!addr || !code) {
      onNotice("请先填写发信邮箱和授权码");
      return;
    }
    if (!target) {
      onNotice("请先在上方设置你的接收邮箱，以便收取测试信");
      return;
    }

    const curChar = characters.find(c => c.id === selectedCharId);
    const charName = curChar?.name || "角色";

    setTesting(true);
    setCharStatusMsg("");
    try {
      const testMail = buildTestLetterMail();
      testMail.fromName = charName;
      testMail.toAddress = target;

      const res = await sendLetterMail({ address: addr, authCode: code }, testMail);
      if (res.status === "ok") {
        const now = new Date().toISOString();
        setCharVerifiedAt(now);
        saveLetterMailConfig(selectedCharId, { address: addr, authCode: code, verifiedAt: now });
        setCharStatusMsg("测试邮件已成功寄出，请查收你的接收邮箱！");
        onNotice("测试邮件已送达！");
      } else if (res.status === "uncertain") {
        setCharStatusMsg(res.error);
      } else {
        setCharStatusMsg(res.error);
        onNotice("测试发信失败");
      }
    } finally {
      setTesting(false);
    }
  };

  // 添加联系人
  const handleAddContact = () => {
    const name = newContactName.trim();
    const email = newContactEmail.trim().toLowerCase();
    if (!name || !email) {
      onNotice("请填写联系人姓名和邮箱");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      onNotice("邮箱格式不正确");
      return;
    }
    const created = addLetterSafeContact({
      name,
      address: email,
      relation: newContactRelation.trim() || undefined,
    });
    setContacts(prev => [...prev, created]);
    setShowAddContact(false);
    setNewContactName("");
    setNewContactEmail("");
    setNewContactRelation("");
    onNotice(`已添加联系人 ${name}`);
  };

  // 删除联系人
  const handleDeleteContact = (id: string) => {
    deleteLetterSafeContact(id);
    setContacts(prev => prev.filter(c => c.id !== id));
    setContactToDelete(null);
    onNotice("已移除联系人");
  };

  const selectedChar = characters.find(c => c.id === selectedCharId);

  return (
    <div className="flex flex-col gap-5 text-[14px] leading-relaxed text-[#333]">
      {/* ── 卡片 1：我的接收邮箱 ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-black/5 flex flex-col gap-3">
        <div>
          <div className="font-semibold text-[15px] flex items-center justify-between">
            <span>我的接收邮箱</span>
            {userInboxSaved && <span className="text-[12px] text-emerald-600 flex items-center gap-1"><Check size={14} />已保存</span>}
          </div>
          <div className="text-[12px] text-black/45 mt-0.5">
            角色给你写信或发邮件时，系统默认寄送的目标地址。
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="email"
            value={userInbox}
            onChange={e => setUserInbox(e.target.value)}
            placeholder="如 your_email@qq.com"
            className="flex-1 px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-[14px] outline-none focus:border-black/30"
          />
          <button
            type="button"
            onClick={handleSaveInbox}
            className="px-4 py-2 bg-black text-white rounded-xl text-[13px] font-medium active:scale-95 transition-transform"
          >
            保存
          </button>
        </div>
      </div>

      {/* ── 卡片 2：角色专属发信邮箱 ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-black/5 flex flex-col gap-3.5">
        <div>
          <div className="font-semibold text-[15px] flex items-center justify-between">
            <span>角色发信邮箱</span>
            {charVerifiedAt && (
              <span className="text-[11px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-medium">
                已验证
              </span>
            )}
          </div>
          <div className="text-[12px] text-black/45 mt-0.5">
            每个角色的发信身份物理隔离，绝不串号。
          </div>
        </div>

        {/* 角色横向滚动选择器 */}
        {characters.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {characters.map(char => {
              const active = char.id === selectedCharId;
              const hasCfg = Boolean(loadLetterMailConfig(char.id)?.address);
              return (
                <button
                  key={char.id}
                  type="button"
                  onClick={() => setSelectedCharId(char.id)}
                  className={`px-3 py-1.5 rounded-xl text-[12px] font-medium shrink-0 flex items-center gap-1 transition-all ${
                    active
                      ? "bg-black text-white shadow-sm"
                      : "bg-black/[0.04] text-black/70 hover:bg-black/[0.08]"
                  }`}
                >
                  <span>{char.name}</span>
                  {hasCfg && <span className={active ? "text-emerald-300" : "text-emerald-600"}>✔</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-[12px] text-black/40 py-2">暂无可配置的角色</div>
        )}

        {selectedChar && (
          <div className="flex flex-col gap-3 pt-1 border-t border-black/5">
            <div className="text-[13px] font-medium text-black/80">
              {selectedChar.name} 的发信邮箱
            </div>

            <div className="flex flex-col gap-2.5">
              <div>
                <label className="text-[12px] text-black/50 mb-1 block">发件邮箱地址</label>
                <input
                  type="email"
                  value={charEmail}
                  onChange={e => setCharEmail(e.target.value)}
                  placeholder="如 char_qq@qq.com"
                  className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-[14px] outline-none focus:border-black/30"
                />
              </div>

              <div>
                <label className="text-[12px] text-black/50 mb-1 block">SMTP 授权码</label>
                <div className="relative flex items-center">
                  <input
                    type={showAuthCode ? "text" : "password"}
                    value={charAuthCode}
                    onChange={e => setCharAuthCode(e.target.value)}
                    placeholder="16 位 SMTP 授权码"
                    className="w-full pl-3 pr-10 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-[14px] outline-none focus:border-black/30 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAuthCode(prev => !prev)}
                    className="absolute right-2.5 text-black/40 hover:text-black/70 p-1"
                  >
                    {showAuthCode ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            {charStatusMsg && (
              <div className="text-[12px] p-2.5 rounded-xl bg-black/[0.03] border border-black/5 text-black/70">
                {charStatusMsg}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmClearChar(true)}
                disabled={!charEmail && !charAuthCode}
                className="px-3 py-2 border border-rose-200 text-rose-600 rounded-xl text-[13px] font-medium active:scale-95 transition-transform disabled:opacity-40"
              >
                清除
              </button>
              <button
                type="button"
                onClick={handleSaveCharMail}
                className="flex-1 py-2 bg-black/[0.06] hover:bg-black/[0.1] text-black font-medium rounded-xl text-[13px] active:scale-95 transition-transform"
              >
                保存
              </button>
              <button
                type="button"
                onClick={handleTestSend}
                disabled={testing}
                className="flex-1 py-2 bg-black text-white font-medium rounded-xl text-[13px] active:scale-95 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                <span>测试发信</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 卡片 3：安全通讯录白名单 ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-black/5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-[15px]">安全通讯录（白名单）</div>
            <div className="text-[12px] text-black/45 mt-0.5">
              除你之外，允许角色主动联络的收件人，防止向陌生人滥发。
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAddContact(true)}
            className="p-1.5 rounded-xl bg-black/[0.05] hover:bg-black/[0.09] active:scale-95 text-black/70"
            title="添加联系人"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* 联系人列表 */}
        <div className="flex flex-col gap-2 pt-1">
          {/* 常驻第一位：我 */}
          <div className="p-3 bg-black/[0.02] border border-black/5 rounded-xl flex items-center justify-between">
            <div className="flex flex-col">
              <div className="text-[13px] font-medium flex items-center gap-1.5">
                <span>我（用户本人）</span>
                <span className="text-[10px] bg-black/10 text-black/60 px-1.5 py-0.2 rounded font-normal">默认</span>
              </div>
              <div className="text-[11px] text-black/40 mt-0.5">
                {userInbox || "尚未配置接收邮箱"}
              </div>
            </div>
          </div>

          {/* 外部添加的联系人 */}
          {contacts.map(c => (
            <div key={c.id} className="p-3 bg-black/[0.02] border border-black/5 rounded-xl flex items-center justify-between">
              <div className="flex flex-col">
                <div className="text-[13px] font-medium flex items-center gap-1.5">
                  <span>{c.name}</span>
                  {c.relation && (
                    <span className="text-[11px] text-black/40 font-normal">
                      · {c.relation}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-black/45 font-mono mt-0.5">{c.address}</div>
              </div>
              <button
                type="button"
                onClick={() => setContactToDelete(c.id)}
                className="text-black/30 hover:text-rose-500 p-1.5 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 清除角色邮箱确认框 */}
      {confirmClearChar && (
        <ConfirmDialog
          title="清除发件邮箱配置"
          message={`确认清除 ${selectedChar?.name || "该角色"} 的发件邮箱与授权码？清除后 TA 将无法向外部寄出邮件。`}
          variant="danger"
          confirmLabel="确认清除"
          onConfirm={handleClearCharMail}
          onCancel={() => setConfirmClearChar(false)}
        />
      )}

      {/* 删除联系人确认框 */}
      {contactToDelete && (
        <ConfirmDialog
          title="移除联系人"
          message="确认将此联系人从安全白名单中移除？移除后角色将无法再向该邮箱发信。"
          variant="danger"
          confirmLabel="移除"
          onConfirm={() => handleDeleteContact(contactToDelete)}
          onCancel={() => setContactToDelete(null)}
        />
      )}

      {/* 添加联系人小弹窗 */}
      {showAddContact && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-[340px] p-5 shadow-xl flex flex-col gap-4">
            <h3 className="font-semibold text-[16px]">添加安全联系人</h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[12px] text-black/50 mb-1 block">姓名 / 称呼</label>
                <input
                  type="text"
                  value={newContactName}
                  onChange={e => setNewContactName(e.target.value)}
                  placeholder="如：张教授 / 林姐"
                  className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-[14px] outline-none"
                />
              </div>
              <div>
                <label className="text-[12px] text-black/50 mb-1 block">邮箱地址</label>
                <input
                  type="email"
                  value={newContactEmail}
                  onChange={e => setNewContactEmail(e.target.value)}
                  placeholder="如：zhang@university.edu"
                  className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-[14px] outline-none"
                />
              </div>
              <div>
                <label className="text-[12px] text-black/50 mb-1 block">关系 / 背景（可选）</label>
                <input
                  type="text"
                  value={newContactRelation}
                  onChange={e => setNewContactRelation(e.target.value)}
                  placeholder="如：大学导师，语气需礼貌"
                  className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-[14px] outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddContact(false)}
                className="flex-1 py-2 bg-black/[0.05] rounded-xl text-[13px] font-medium"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddContact}
                className="flex-1 py-2 bg-black text-white rounded-xl text-[13px] font-medium"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
