// components/chat/chat-avatar-panel.tsx
// 聊天独立网络头像仓储与换装管理面板
"use client";

import { useState, useEffect } from "react";
import { PageShell } from "@/components/ui/page-shell";
import { User, Image as ImageIcon, Plus, Trash2, Check, Sparkles, RefreshCw } from "lucide-react";
import {
    getCharacterChatAvatars,
    addCharacterChatAvatar,
    removeCharacterChatAvatar,
    updateCharacterChatAvatarDesc,
    type ChatAvatarItem,
} from "@/lib/chat-avatar-storage";
import { loadCharacters, saveCharacter } from "@/lib/character-storage";
import { resolveUserIdentity, saveUserIdentity } from "@/lib/settings-storage";
import { loadChatSessions, saveChatSessions, type ChatSession } from "@/lib/chat-storage";
import { saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";

interface ChatAvatarPanelProps {
    onBack: () => void;
    sessionId?: string; // 可选的特定会话
}

export function ChatAvatarPanel({ onBack, sessionId }: ChatAvatarPanelProps) {
    const characters = loadCharacters();
    const [selectedCharId, setSelectedCharId] = useState<string>(characters[0]?.id || "");
    const [avatars, setAvatars] = useState<ChatAvatarItem[]>([]);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);

    // 用户聊天独立头像
    const userIdentity = resolveUserIdentity(undefined, "chat");
    const [userChatAvatar, setUserChatAvatar] = useState<string>("");

    // 新增头像表单
    const [newDesc, setNewDesc] = useState("");
    const [uploading, setUploading] = useState(false);

    // 加载会话与头像库
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
    };

    useEffect(() => {
        refreshData();
    }, [selectedCharId, sessionId]);

    const activeChar = characters.find(c => c.id === selectedCharId);

    // 上传并收纳到专属头像库
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
            const defaultDesc = newDesc.trim() || `${activeChar?.name || "角色"}的精选自拍`;
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

    // 用户更换自己在该聊天的独立网络头像
    const handleUserAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        } catch {
            alert("更换失败");
        }
    };

    // 重置用户自己的聊天头像为全局身份头像
    const handleResetUserAvatar = () => {
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
    };

    // 仅修改角色卡主图（完全保留角色卡的好感度立绘和其余字段）
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
            // 严格保持角色卡其他字段与各阶段好感度配置，仅覆盖主 avatar
            const updatedChar = { ...activeChar, avatar: dataUrl, updatedAt: new Date().toISOString() };
            saveCharacter(updatedChar);
            alert("角色卡主头像已更新（好感度立绘完全保留）");
        } catch {
            alert("保存失败");
        }
    };

    return (
        <PageShell title="聊天独立网络头像" onBack={onBack} className="absolute inset-0 z-[100]">
            <div className="flex flex-col h-full bg-[var(--c-page-body-bg)] overflow-hidden">
                {/* 角色选择栏 */}
                <div className="px-5 pt-3 pb-2 flex items-center gap-2 overflow-x-auto shrink-0 no-scrollbar">
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

                <div className="flex-1 overflow-y-auto px-5 pt-2 pb-16 flex flex-col gap-5">
                    {/* 状态总览卡片 */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--c-text-title)]">当前聊天中生效的头像</span>
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

                    {/* 角色的网络头像仓储库 */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-xs font-bold text-[var(--c-text-title)] block">
                                    {activeChar?.name} 的网络头像库 ({avatars.length})
                                </span>
                                <span className="text-[11px] text-[var(--c-text)] opacity-50 block mt-0.5">
                                    在聊天室中给 TA 发图片，TA 触发换头像时也会自动存入这里
                                </span>
                            </div>
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

                        {/* 头像网格 */}
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

                    {/* 我在这场聊天的网络头像 */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--c-text-title)]">我在这场聊天的网络头像</span>
                            {userChatAvatar && (
                                <button
                                    type="button"
                                    onClick={handleResetUserAvatar}
                                    className="text-xs text-[var(--c-danger)] bg-transparent border-none cursor-pointer flex items-center gap-1 active:scale-95"
                                >
                                    <RefreshCw size={12} /> 恢复全局资料头像
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full overflow-hidden bg-black/5 shrink-0 border border-[var(--c-card-border)]">
                                <img
                                    src={userChatAvatar || userIdentity?.avatarUrl || ""}
                                    alt="My Avatar"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div className="flex flex-col gap-1 flex-1">
                                <span className="text-xs font-semibold text-[var(--c-text)]">
                                    {userChatAvatar ? "已自定义聊天网头（仅当前会话）" : "跟随个人资料默认头像"}
                                </span>
                                <label className="text-xs text-[var(--c-icon-active)] font-bold cursor-pointer inline-flex items-center gap-1">
                                    <ImageIcon size={14} /> 选一张换上网络头像
                                    <input type="file" accept="image/*" onChange={handleUserAvatarUpload} className="hidden" />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* 修改本体资料的独立入口（保留Lv1/Lv2配置） */}
                    <div className="bg-[var(--c-card)] rounded-[22px] p-4 flex flex-col gap-3 border border-[var(--c-card-border)]/40 shadow-sm">
                        <span className="text-xs font-bold text-[var(--c-text-title)]">角色卡与资料修改（底层本体）</span>
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center justify-between p-3 rounded-xl bg-black/5 dark:bg-white/5 cursor-pointer active:scale-98 transition-transform">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold text-[var(--c-text)]">修改角色卡全局主图</span>
                                    <span className="text-[11px] text-[var(--c-text)] opacity-50">
                                        仅替换角色卡主头像，完全保留 Lv1、Lv2 等各阶段好感度立绘
                                    </span>
                                </div>
                                <span className="text-xs font-bold text-[var(--c-icon-active)] shrink-0">点击选择</span>
                                <input type="file" accept="image/*" onChange={handleUpdateCharacterCardAvatar} className="hidden" />
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}
