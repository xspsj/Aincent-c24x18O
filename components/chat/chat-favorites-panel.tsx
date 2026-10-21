"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Star, Trash2, ChevronLeft, MessageSquare } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import {
    loadAllFavorites,
    loadFavoritesByContact,
    removeFavorite,
    type FavoriteItem,
} from "@/lib/chat-favorites-storage";
import { loadChatContacts } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";

type ChatFavoritesPanelProps = {
    /** 如果传入则默认过滤到该角色的收藏 */
    defaultContactId?: string;
    onBack: () => void;
};

// 消息类型中文标签
const MEDIA_TYPE_LABELS: Record<string, string> = {
    image: "图片",
    audio: "语音",
    video: "视频",
    sticker: "表情",
    red_packet: "红包",
    transfer: "转账",
    gift: "礼物",
    location: "位置",
    contact_card: "名片",
    music_share: "音乐分享",
    xiaohongshu_note_share: "小红书",
    app_card: "应用卡片",
    quote: "引用消息",
    media_file: "文件",
};

function getPreviewText(item: FavoriteItem): string {
    if (item.mediaType) {
        if (item.mediaType === "audio") {
            const label = item.mediaData?.label;
            return label ? `[语音] ${label}` : "[语音]";
        }
        if (item.mediaType === "image") {
            const desc = item.mediaData?.label || item.mediaData?.imageGenerationPrompt;
            return desc ? `[图片] ${desc}` : "[图片]";
        }
        const typeLabel = MEDIA_TYPE_LABELS[item.mediaType] || item.mediaType;
        const extra = item.mediaData?.label || item.mediaData?.giftName || item.mediaData?.musicTitle || "";
        return extra ? `[${typeLabel}] ${extra}` : `[${typeLabel}]`;
    }
    return item.content || "(空消息)";
}

function formatFavoriteTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function FavoriteItemCard({
    item,
    onDelete,
}: {
    item: FavoriteItem;
    onDelete: (id: string) => void;
}) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const preview = getPreviewText(item);
    const senderName = item.role === "user" ? (item.userName || "我") : item.characterName;
    const avatarSrc = item.role === "user" ? item.userAvatar : item.characterAvatar;

    return (
        <div className="bg-[var(--c-card)] rounded-2xl mx-4 mb-3 overflow-hidden"
             style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
            {/* 头部：角色信息 + 时间 */}
            <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 border-b border-[color-mix(in_srgb,var(--c-card-border)_15%,transparent)]">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-[var(--c-input)] shrink-0 flex items-center justify-center">
                    {avatarSrc ? (
                        <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <ChatFallbackAvatar />
                    )}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="ts-13 font-semibold text-[var(--c-text-title)] truncate leading-tight">
                        {senderName}
                        {item.isGroup && item.groupName && (
                            <span className="ts-11 font-normal text-[var(--c-text)] opacity-60 ml-1">
                                · {item.groupName}
                            </span>
                        )}
                    </span>
                    <span className="ts-11 text-[var(--c-text)] opacity-50 leading-tight">
                        {new Date(item.originalCreatedAt).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                    </span>
                </div>
                <span className="ts-11 text-[var(--c-text)] opacity-40 shrink-0">
                    {formatFavoriteTime(item.favoritedAt)}收藏
                </span>
            </div>

            {/* 消息内容预览 */}
            <div className="px-4 py-3">
                {item.mediaType === "image" && item.fixedBlob ? (
                    <img
                        src={item.fixedBlob}
                        alt="收藏图片"
                        className="max-w-full rounded-lg max-h-[180px] object-contain"
                    />
                ) : (
                    <p className="ts-14 text-[var(--c-text)] leading-relaxed whitespace-pre-wrap break-words line-clamp-6">
                        {preview}
                    </p>
                )}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-between px-4 pb-3">
                <div className="flex items-center gap-1">
                    {item.mediaType && (
                        <span className="ts-11 text-[var(--c-text)] opacity-40 bg-[var(--c-input)] px-2 py-0.5 rounded-full">
                            {MEDIA_TYPE_LABELS[item.mediaType] || item.mediaType}
                        </span>
                    )}
                </div>
                {confirmDelete ? (
                    <div className="flex items-center gap-2">
                        <button
                            className="ts-12 text-[var(--c-text)] opacity-60 px-2 py-1"
                            onClick={() => setConfirmDelete(false)}
                        >
                            取消
                        </button>
                        <button
                            className="ts-12 text-[var(--c-danger)] font-semibold px-2 py-1"
                            onClick={() => onDelete(item.id)}
                        >
                            确认删除
                        </button>
                    </div>
                ) : (
                    <button
                        className="flex items-center gap-1 ts-12 text-[var(--c-text)] opacity-40 active:opacity-70 p-1"
                        onClick={() => setConfirmDelete(true)}
                        aria-label="取消收藏"
                    >
                        <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                )}
            </div>
        </div>
    );
}

type ContactTab = { contactId: string; name: string; avatar?: string; count: number };

export function ChatFavoritesPanel({ defaultContactId, onBack }: ChatFavoritesPanelProps) {
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeContactId, setActiveContactId] = useState<string | null>(defaultContactId || null);

    // 构建角色 Tab 列表
    const contactTabs = useMemo<ContactTab[]>(() => {
        const countMap = new Map<string, number>();
        const nameMap = new Map<string, string>();
        const avatarMap = new Map<string, string | undefined>();

        for (const item of favorites) {
            const cid = item.contactId;
            countMap.set(cid, (countMap.get(cid) || 0) + 1);
            if (!nameMap.has(cid)) {
                nameMap.set(cid, item.isGroup ? (item.groupName || item.characterName) : item.characterName);
                avatarMap.set(cid, item.characterAvatar);
            }
        }

        // 再从通讯录补充没出现在收藏里的角色（以防有但空收藏）
        const tabs: ContactTab[] = Array.from(countMap.entries()).map(([contactId, count]) => ({
            contactId,
            name: nameMap.get(contactId) || contactId,
            avatar: avatarMap.get(contactId),
            count,
        }));
        tabs.sort((a, b) => b.count - a.count);
        return tabs;
    }, [favorites]);

    const displayedFavorites = useMemo(() => {
        if (!activeContactId) return favorites;
        return favorites.filter(f => f.contactId === activeContactId);
    }, [favorites, activeContactId]);

    const loadFavorites = useCallback(async () => {
        setLoading(true);
        try {
            const all = await loadAllFavorites();
            setFavorites(all);
        } catch (err) {
            console.error("[ChatFavorites] 加载失败:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadFavorites();
    }, [loadFavorites]);

    const handleDelete = useCallback(async (id: string) => {
        try {
            await removeFavorite(id);
            setFavorites(prev => prev.filter(f => f.id !== id));
        } catch (err) {
            console.error("[ChatFavorites] 删除失败:", err);
        }
    }, []);

    return (
        <PageShell title="专属收藏夹" onBack={onBack} className="absolute inset-0 z-[100]">
            {/* 角色 Tab 筛选 */}
            {contactTabs.length > 0 && (
                <div className="sticky top-0 z-10 bg-[var(--c-page-body-bg)] px-4 pt-2 pb-3 flex gap-2 overflow-x-auto scrollbar-none border-b border-[color-mix(in_srgb,var(--c-card-border)_20%,transparent)]">
                    <button
                        onClick={() => setActiveContactId(null)}
                        className={`shrink-0 px-3 py-1.5 rounded-full ts-13 font-semibold transition-all ${
                            !activeContactId
                                ? "bg-[var(--c-icon-active)] text-white"
                                : "bg-[var(--c-input)] text-[var(--c-text)]"
                        }`}
                    >
                        全部 {favorites.length > 0 && <span className="opacity-70">({favorites.length})</span>}
                    </button>
                    {contactTabs.map(tab => (
                        <button
                            key={tab.contactId}
                            onClick={() => setActiveContactId(tab.contactId === activeContactId ? null : tab.contactId)}
                            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full ts-13 font-semibold transition-all ${
                                activeContactId === tab.contactId
                                    ? "bg-[var(--c-icon-active)] text-white"
                                    : "bg-[var(--c-input)] text-[var(--c-text)]"
                            }`}
                        >
                            {tab.avatar ? (
                                <img src={tab.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                            ) : null}
                            <span className="truncate max-w-[80px]">{tab.name}</span>
                            <span className="opacity-60">({tab.count})</span>
                        </button>
                    ))}
                </div>
            )}

            {/* 列表主体 */}
            <div className="pt-3 pb-8">
                {loading ? (
                    <div className="flex justify-center items-center py-20 opacity-40">
                        <span className="ts-14 text-[var(--c-text)]">加载中...</span>
                    </div>
                ) : displayedFavorites.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-40">
                        <Star size={36} strokeWidth={1.25} className="text-[var(--c-icon)]" />
                        <span className="ts-14 text-[var(--c-text)]">
                            {activeContactId ? "这个角色还没有收藏" : "还没有收藏任何消息"}
                        </span>
                        {!activeContactId && (
                            <span className="ts-12 text-[var(--c-text)] opacity-70 text-center px-8 leading-relaxed">
                                在聊天室长按气泡，选择「收藏」即可保存精彩对白
                            </span>
                        )}
                    </div>
                ) : (
                    displayedFavorites.map(item => (
                        <FavoriteItemCard
                            key={item.id}
                            item={item}
                            onDelete={handleDelete}
                        />
                    ))
                )}
            </div>
        </PageShell>
    );
}
