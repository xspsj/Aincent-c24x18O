// components/chat/chat-avatar-panel.tsx
// 聊天独立网络头像仓储与换装管理面板（全屏沉浸式）
"use client";

import { useState, useEffect } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { User, Image as ImageIcon, Plus, Trash2, Check, Sparkles, RefreshCw } from "lucide-react";
import {
    getCharacterChatAvatars,
    addCharacterChatAvatar,
    removeCharacterChatAvatar,
    type ChatAvatarItem,
} from "@/lib/chat-avatar-storage";
import { loadCharacters, saveCharacters } from "@/lib/character-storage";
import { resolveUserIdentity, loadUserIdentities, saveUserIdentities } from "@/lib/settings-storage";
import { loadChatSessions, saveChatSessions, type ChatSession } from "@/lib/chat-storage";

interface ChatAvatarPanelProps {
    onBack: () => void;
    sessionId?: string;
}

export function ChatAvatarPanel({ onBack, sessionId }: ChatAvatarPanelProps) {
    const characters = loadCharacters();
    const [selectedCharId, setSelectedCharId] = useState<string>(characters[0]?.id || "");
    const [avatars, setAvatars] = useState<ChatAvatarItem[]>([]);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);

    // 用户全局身份资料
    const [userIdentity, setUserIdentity] = useState(() => resolveUserIdentity(undefined, "chat"));
    // 用户当前聊天专属网头
    const [userChatAvatar, setUserChatAvatar] = useState<string>("");

    // 新增头像表单
    const [newDesc, setNewDesc] = useState("");
    const [uploading, setUploading] = useState(false);

    // 刷新数据
    const refreshData = () => {
        const loadedSessions = loadChatSessions();
        setSessions(loadedSessions);
        if (selectedCharId) {
            setAvatars(getCharacterChatAvatars(selectedCharId));
            const sess = loadedSessions.find(s => s.contactId === selectedCharId || s.id === sessionId);
            if (sess) {
                setCurrentSession(sess);
                setUserChatAvatar(sess.customUserAvatar || "");
            }
        }
        setUserIdentity(resolveUserIdentity(undefined, "chat"));
    };

    useEffect(() => {
        refreshData();
    }, [selectedCharId, sessionId]);

    const activeChar = characters.find(c => c.id === selectedCharId);

    // 上传新头像进角色专属库
    const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedCharId) return;
        setUploading(true);
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const defaultDesc = newDesc.trim() || `${activeChar?.name || "角色"}的新头像`;
            addCharacterChatAvatar(selectedCharId, dataUrl, defaultDesc, "manual");
            setNewDesc("");
            refreshData();
        } catch {
            alert("图片上传失败");
        } finally {
            setUploading(false);
        }
    };

    // 为角色换上该专属头像（仅在聊天App生效）
    const handleSetCharChatAvatar = (item: ChatAvatarItem) => {
        if (!currentSession) return;
        const updatedSessions = sessions.map(s => {
            if (s.id === currentSession.id) {
                return {
                    ...s,
                    customCharAvatar: item.url,
                    customCharAvatarDesc: item.description,
                };
            }
            return s;
        });
        saveChatSessions(updatedSessions);
        setSessions(updatedSessions);
        setCurrentSession(prev => prev ? { ...prev, customCharAvatar: item.url, customCharAvatarDesc: item.description } : null);
        window.dispatchEvent(new CustomEvent("chat-sessions-updated"));
    };

    // 恢复角色卡全局默认头像
    const handleResetCharChatAvatar = () => {
        if (!currentSession) return;
        const updatedSessions = sessions.map(s => {
            if (s.id === currentSession.id) {
                const next = { ...s };
                delete next.customCharAvatar;
                delete next.customCharAvatarDesc;
                return next;
            }
            return s;
        });
        saveChatSessions(updatedSessions);
        setSessions(updatedSessions);
        setCurrentSession(prev => {
            if (!prev) return null;
            const next = { ...prev };
            delete next.customCharAvatar;
            delete next.customCharAvatarDesc;
            return next;
        });
        window.dispatchEvent(new CustomEvent("chat-sessions-updated"));
    };

    // 用户更换自己在当前聊天的专属网络头像
    const handleUserChatAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentSession) return;
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const updatedSessions = sessions.map(s => {
                if (s.id === currentSession.id) {
                    return { ...s, customUserAvatar: dataUrl };
                }
                return s;
            });
            saveChatSessions(updatedSessions);
            setUserChatAvatar(dataUrl);
            window.dispatchEvent(new CustomEvent("chat-sessions-updated"));
            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: currentSession.id } }));
            window.dispatchEvent(new CustomEvent("chat-open-session", { detail: { sessionId: currentSession.id } }));
        } catch {
            alert("更换失败");
        }
    };

    // 重置用户自己的聊天头像为全局默认
    const handleResetUserChatAvatar = () => {
        if (!currentSession) return;
        const updatedSessions = sessions.map(s => {
            if (s.id === currentSession.id) {
                const next = { ...s };
                delete next.customUserAvatar;
                return next;
            }
            return s;
        });
        saveChatSessions(updatedSessions);
        setUserChatAvatar("");
        window.dispatchEvent(new CustomEvent("chat-sessions-updated"));
        window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: currentSession.id } }));
        window.dispatchEvent(new CustomEvent("chat-open-session", { detail: { sessionId: currentSession.id } }));
    };

    // 仅修改角色卡主图（完全保留各阶段好感度立绘与全部字段）
    const handleUpdateCharacterCardAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeChar) return;
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const allChars = loadCharacters();
            const updatedChars = allChars.map(c => {
                if (c.id === activeChar.id) {
                    return { ...c, avatar: dataUrl, updatedAt: new Date().toISOString() };
                }
                return c;
            });
            saveCharacters(updatedChars);
            alert("角色卡主头像已成功更新（好感度立绘完全保留）");
            refreshData();
        } catch (err) {
            alert("保存失败：" + String(err));
        }
    };

    // 修改我自己的全局个人资料主头像（修复 saveUserIdentities 报错）
    const handleUpdateMyProfileAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const currentIdentity = resolveUserIdentity(undefined, "chat");
            const allIdentities = loadUserIdentities();
            const updated = allIdentities.map(item => {
                if (item.id === currentIdentity?.id || (!currentIdentity && item.id === allIdentities[0]?.id)) {
                    return { ...item, avatarUrl: dataUrl };
                }
                return item;
            });
            saveUserIdentities(updated.length > 0 ? updated : [{ id: "identity-1", name: "我", avatarUrl: dataUrl, bio: "", gender: "保密", age: "未知", occupation: "", customSettings: "" }]);
            alert("我的个人资料头像已更新");
            refreshData();
        } catch (err) {
            alert("保存失败：" + String(err));
        }
    };

    return (
        <PageShell title="聊天独立网络头像" onBack={onBack} className="fixed inset-0 z-[120] bg-[var(--c-page-bg,#000)]">
            <div className="flex flex-col h-full bg-[var(--c-page-body-bg)] overflow-hidden">
                {/* 角色切换条 */}
                <div className="px-5 pt-3 pb-2 flex items-center gap-2 overflow-x-auto shrink-0 no-scrollbar border-b border-[var(--c-card-border)]/30">
                    {characters.map(c => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedCharId(c.id)}
                            className="ui-chip text-xs px-3 py-1 shrink-0"
                            {...(selectedCharId === c.id ? { "data-selected": "" } : {})}
                        >
                            {c.name}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto px-5 pt-3 pb-20 flex flex-col gap-5">
                    {/* 模块1：当前聊天中生效的网络头像 */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--c-text-title)]">
                                {activeChar?.name} 当前聊天的网络形象
                            </span>
                            {currentSession?.customCharAvatar && (
                                <button
                                    type="button"
                                    onClick={handleResetCharChatAvatar}
                                    className="text-xs text-[var(--c-danger)] bg-transparent border-none cursor-pointer flex items-center gap-1 active:scale-95"
                                >
                                    <RefreshCw size={12} /> 还原角色卡默认
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-full overflow-hidden bg-black/5 shrink-0 border-2 border-[var(--c-card-border)] shadow-inner">
                                <img
                                    src={currentSession?.customCharAvatar || activeChar?.avatar || ""}
                                    alt="Chat Avatar"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div className="flex flex-col gap-1 min-w-0 flex-1">
                                <span className="text-sm font-bold text-[var(--c-text-title)] truncate">
                                    {currentSession?.customCharAvatar ? "已换上聊天网络头像" : "当前使用角色卡默认头像"}
                                </span>
                                <span className="text-xs text-[var(--c-text)] opacity-70 line-clamp-2">
                                    {currentSession?.customCharAvatarDesc || "暂无描述。换上专属头像后，角色会知道自己换上了什么。"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 模块2：角色的网络头像私有库 */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <div>
                            <span className="text-xs font-bold text-[var(--c-text-title)] block">
                                {activeChar?.name} 的网络头像库 ({avatars.length})
                            </span>
                            <span className="text-[11px] text-[var(--c-text)] opacity-50 block mt-0.5">
                                在聊天中给 TA 发图片，TA 触发换头像时也会自动存入这里
                            </span>
                        </div>

                        {/* 上传新头像进库 */}
                        <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-black/5 dark:bg-white/5">
                            <input
                                type="text"
                                placeholder="输入头像描述（例：你送给我的圣诞自拍）"
                                value={newDesc}
                                onChange={e => setNewDesc(e.target.value)}
                                className="ui-input text-xs w-full h-8 px-2"
                            />
                            <label className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--c-icon-active)] text-white text-xs font-semibold cursor-pointer active:scale-98 transition-transform">
                                <Plus size={14} /> 上传新头像到角色库
                                <input type="file" accept="image/*" onChange={handleUploadAvatar} className="hidden" disabled={uploading} />
                            </label>
                        </div>

                        {/* 头像列表 */}
                        <div className="grid grid-cols-3 gap-3 pt-1">
                            {avatars.map(item => {
                                const isCurrent = currentSession?.customCharAvatar === item.url;
                                return (
                                    <div
                                        key={item.id}
                                        className={`flex flex-col gap-1.5 p-2 rounded-xl bg-black/5 dark:bg-white/5 border transition-all ${
                                            isCurrent ? "border-[var(--c-icon-active)] shadow-sm" : "border-transparent"
                                        }`}
                                    >
                                        <div className="relative aspect-square rounded-lg overflow-hidden bg-black/10">
                                            <img src={item.url} alt="" className="w-full h-full object-cover" />
                                            {isCurrent && (
                                                <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[var(--c-icon-active)] text-white flex items-center justify-center shadow">
                                                    <Check size={12} strokeWidth={3} />
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-[var(--c-text)] opacity-75 truncate text-center" title={item.description}>
                                            {item.description}
                                        </span>
                                        <div className="flex gap-1 mt-auto">
                                            <button
                                                type="button"
                                                onClick={() => handleSetCharChatAvatar(item)}
                                                className={`flex-1 py-1 rounded text-[10px] font-semibold border-none cursor-pointer active:scale-95 transition-transform ${
                                                    isCurrent
                                                        ? "bg-[var(--c-icon-active)] text-white"
                                                        : "bg-black/10 dark:bg-white/10 text-[var(--c-text)]"
                                                }`}
                                            >
                                                {isCurrent ? "生效中" : "换上"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    removeCharacterChatAvatar(selectedCharId, item.id);
                                                    refreshData();
                                                }}
                                                className="w-6 py-1 rounded text-[10px] bg-black/10 dark:bg-white/10 text-[var(--c-danger)] flex items-center justify-center border-none cursor-pointer active:scale-95"
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 模块3：我在这场聊天的专属网络头像 */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--c-text-title)]">我在这场聊天的网络形象</span>
                            {userChatAvatar && (
                                <button
                                    type="button"
                                    onClick={handleResetUserChatAvatar}
                                    className="text-xs text-[var(--c-danger)] bg-transparent border-none cursor-pointer flex items-center gap-1 active:scale-95"
                                >
                                    <RefreshCw size={12} /> 恢复个人资料默认
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full overflow-hidden bg-black/5 shrink-0 border border-[var(--c-card-border)]">
                                <img
                                    src={userChatAvatar || userIdentity?.avatarUrl || ""}
                                    alt="My Chat Avatar"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div className="flex flex-col gap-1 flex-1">
                                <span className="text-xs font-semibold text-[var(--c-text)]">
                                    {userChatAvatar ? "已换上聊天独立网头（聊天室气泡即刻生效）" : "跟随个人资料全局头像"}
                                </span>
                                <label className="text-xs text-[var(--c-icon-active)] font-bold cursor-pointer inline-flex items-center gap-1">
                                    <ImageIcon size={14} /> 选一张换上专属网络头像
                                    <input type="file" accept="image/*" onChange={handleUserChatAvatarUpload} className="hidden" />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* 模块4：底层本体资料维护（清晰区分：角色卡本体 与 我的人设资料） */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <span className="text-xs font-bold text-[var(--c-text-title)]">底层本体资料维护</span>

                        {/* 修改角色卡本体主图 */}
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center justify-between p-3 rounded-xl bg-black/5 dark:bg-white/5 cursor-pointer active:scale-98 transition-transform">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold text-[var(--c-text)]">修改角色卡全局主图（{activeChar?.name}）</span>
                                    <span className="text-[11px] text-[var(--c-text)] opacity-50">
                                        仅替换角色卡本体封面，完全保留 Lv1、Lv2 等各阶段好感度立绘
                                    </span>
                                </div>
                                <span className="text-xs font-bold text-[var(--c-icon-active)] shrink-0">点击选择</span>
                                <input type="file" accept="image/*" onChange={handleUpdateCharacterCardAvatar} className="hidden" />
                            </label>

                            {/* 修改我的人设资料头像 */}
                            <label className="flex items-center justify-between p-3 rounded-xl bg-black/5 dark:bg-white/5 cursor-pointer active:scale-98 transition-transform">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold text-[var(--c-text)]">修改我的人设资料头像（我的个人资料）</span>
                                    <span className="text-[11px] text-[var(--c-text)] opacity-50">
                                        更新你自己的全局默认头像与人设形象
                                    </span>
                                </div>
                                <span className="text-xs font-bold text-[var(--c-icon-active)] shrink-0">点击选择</span>
                                <input type="file" accept="image/*" onChange={handleUpdateMyProfileAvatar} className="hidden" />
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}
