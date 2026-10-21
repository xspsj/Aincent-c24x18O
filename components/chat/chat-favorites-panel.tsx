"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Star, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import {
    loadAllFavorites,
    removeFavorite,
    type FavoriteItem,
    type CombinedMessageSnapshot,
} from "@/lib/chat-favorites-storage";

// ── 工具函数 ──────────────────────────────

type ChatFavoritesPanelProps = {
    /** 传入则只展示该角色的收藏，且不渲染 Tab 筛选栏（单角色专属模式） */
    defaultContactId?: string;
    /** 页面标题，不传则根据 defaultContactId 自动决定 */
    title?: string;
    onBack: () => void;
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
    image: "图片", audio: "语音", video: "视频", sticker: "表情",
    red_packet: "红包", transfer: "转账", gift: "礼物", location: "位置",
    contact_card: "名片", music_share: "音乐分享", xiaohongshu_note_share: "小红书",
    app_card: "应用卡片", quote: "引用消息", media_file: "文件",
};

function getPreviewText(
    mediaType: FavoriteItem["mediaType"],
    content: string,
    mediaData?: FavoriteItem["mediaData"]
): string {
    if (mediaType) {
        if (mediaType === "audio") {
            const label = mediaData?.label;
            return label ? `[语音] ${label}` : "[语音]";
        }
        if (mediaType === "image") {
            const desc = mediaData?.label || mediaData?.imageGenerationPrompt;
            return desc ? `[图片] ${desc}` : "[图片]";
        }
        const typeLabel = MEDIA_TYPE_LABELS[mediaType] || mediaType;
        const extra = mediaData?.label || mediaData?.giftName || mediaData?.musicTitle || "";
        return extra ? `[${typeLabel}] ${extra}` : `[${typeLabel}]`;
    }
    return content || "(空消息)";
}

function formatFavoriteTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

// ── 合并收藏展开后每条消息的行 ──────────────

function CombinedMessageRow({
    cm,
    userName,
    characterName,
    characterAvatar,
    userAvatar,
}: {
    cm: CombinedMessageSnapshot;
    userName?: string;
    characterName: string;
    characterAvatar?: string;
    userAvatar?: string;
}) {
    const isUser = cm.role === "user";
    const name = cm.senderName || (isUser ? (userName || "我") : characterName);
    const avatarSrc = isUser ? userAvatar : (characterAvatar || undefined);
    const preview = getPreviewText(cm.mediaType, cm.content, cm.mediaData);

    return (
        <div className={`flex gap-2 py-2 items-start ${isUser ? "flex-row-reverse" : "flex-row"}`}>
            {/* 头像 — self-start 防止被内容撑高后垂直居中遮住名字 */}
            <div className="w-7 h-7 rounded-full bg-[var(--c-input)] shrink-0 self-start flex items-center justify-center overflow-hidden mt-[2px]">
                {avatarSrc
                    ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                    : <ChatFallbackAvatar />}
            </div>
            <div className={`flex flex-col max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
                <span className="ts-11 text-[var(--c-text)] opacity-50 mb-0.5 leading-tight">{name}</span>
                {cm.fixedBlob && cm.mediaType === "image" ? (
                    <img
                        src={cm.fixedBlob}
                        alt="图片"
                        className="max-w-full rounded-xl max-h-[120px] object-contain"
                    />
                ) : (
                    <div className={`ts-13 text-[var(--c-text)] leading-relaxed px-3 py-1.5 rounded-2xl whitespace-pre-wrap break-words ${
                        isUser
                            ? "bg-[var(--c-icon-active)]/15 rounded-tr-md"
                            : "bg-[var(--c-input)] rounded-tl-md"
                    }`}>
                        {preview}
                    </div>
                )}
                <span className="ts-10 text-[var(--c-text)] opacity-30 mt-0.5">
                    {new Date(cm.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
            </div>
        </div>
    );
}

// ── 单条收藏卡片 ──────────────────────────

function FavoriteItemCard({
    item,
    onDelete,
}: {
    item: FavoriteItem;
    onDelete: (id: string) => void;
}) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const avatarSrc = item.role === "user" ? item.userAvatar : item.characterAvatar;
    const senderName = item.role === "user" ? (item.userName || "我") : item.characterName;

    // 卡片头部显示名：合并收藏显示聊天对象名，单条显示发言人
    const headerName = item.isCombined
        ? (item.isGroup ? (item.groupName || item.characterName) : item.characterName)
        : senderName;
    const headerAvatar = item.isCombined ? item.characterAvatar : avatarSrc;

    return (
        <div
            className="bg-[var(--c-card)] rounded-2xl mx-4 mb-3 overflow-hidden"
            style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
        >
            {/* 头部：角色信息 + 收藏时间 */}
            <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 border-b border-[color-mix(in_srgb,var(--c-card-border)_15%,transparent)]">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-[var(--c-input)] shrink-0 flex items-center justify-center">
                    {headerAvatar
                        ? <img src={headerAvatar} alt="" className="w-full h-full object-cover" />
                        : <ChatFallbackAvatar />}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="ts-13 font-semibold text-[var(--c-text-title)] truncate leading-tight">
                        {headerName}
                        {item.isGroup && item.groupName && !item.isCombined && (
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

            {/* 内容 */}
            <div className="px-4 py-3">
                {item.isCombined ? (
                    <div className="flex flex-col gap-0.5">
                        {/* 折叠/展开按钮 */}
                        <button
                            className="flex items-center gap-1.5 ts-12 text-[var(--c-icon-active)] font-medium mb-1 self-start"
                            onClick={() => setExpanded(v => !v)}
                        >
                            <span className="bg-[var(--c-icon-active)]/10 px-2 py-0.5 rounded-full">
                                📋 合并消息 · {item.combinedMessages?.length ?? 0} 条
                            </span>
                            {expanded
                                ? <ChevronUp size={13} strokeWidth={2} />
                                : <ChevronDown size={13} strokeWidth={2} />}
                        </button>
                        {/* 折叠态：摘要预览 */}
                        {!expanded && (
                            <p className="ts-13 text-[var(--c-text)] opacity-70 leading-relaxed line-clamp-2">
                                {item.content}
                            </p>
                        )}
                        {/* 展开态：逐条气泡，传入头像 */}
                        {expanded && item.combinedMessages?.map((cm, i) => (
                            <CombinedMessageRow
                                key={i}
                                cm={cm}
                                userName={item.userName}
                                characterName={item.characterName}
                                characterAvatar={item.characterAvatar}
                                userAvatar={item.userAvatar}
                            />
                        ))}
                    </div>
                ) : item.mediaType === "image" && item.fixedBlob ? (
                    <img
                        src={item.fixedBlob}
                        alt="收藏图片"
                        className="max-w-full rounded-xl max-h-[180px] object-contain"
                    />
                ) : (
                    <p className="ts-14 text-[var(--c-text)] leading-relaxed whitespace-pre-wrap break-words line-clamp-6">
                        {getPreviewText(item.mediaType, item.content, item.mediaData)}
                    </p>
                )}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-between px-4 pb-3">
                <div>
                    {!item.isCombined && item.mediaType && (
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

// ── Tab 筛选 ──────────────────────────────

type ContactTab = { contactId: string; name: string; count: number };

// ── 主组件 ────────────────────────────────

export function ChatFavoritesPanel({ defaultContactId, title, onBack }: ChatFavoritesPanelProps) {
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeContactId, setActiveContactId] = useState<string | null>(defaultContactId || null);

    // 是否是「单角色专属模式」：传入了 defaultContactId 且没有 title 传入时认为是专属
    // 也可以由调用方直接传 title 来明确区分
    const isSingleMode = !!defaultContactId;
    const pageTitle = title ?? (isSingleMode ? "专属收藏夹" : "收藏夹");

    // Tab 列表：单角色模式下不显示筛选栏
    const contactTabs = useMemo<ContactTab[]>(() => {
        if (isSingleMode) return [];
        const countMap = new Map<string, number>();
        const nameMap = new Map<string, string>();
        for (const item of favorites) {
            const cid = item.contactId;
            countMap.set(cid, (countMap.get(cid) || 0) + 1);
            if (!nameMap.has(cid)) {
                nameMap.set(cid, item.isGroup
                    ? (item.groupName || item.characterName)
                    : item.characterName);
            }
        }
        return Array.from(countMap.entries())
            .map(([contactId, count]) => ({ contactId, name: nameMap.get(contactId) || contactId, count }))
            .sort((a, b) => b.count - a.count);
    }, [favorites, isSingleMode]);

    // 展示列表：单角色模式只展示该角色收藏，全局模式按 Tab 过滤
    const displayedFavorites = useMemo(() => {
        if (activeContactId) return favorites.filter(f => f.contactId === activeContactId);
        return favorites;
    }, [favorites, activeContactId]);

    const loadFavorites = useCallback(async () => {
        setLoading(true);
        try {
            setFavorites(await loadAllFavorites());
        } catch (err) {
            console.error("[ChatFavorites] 加载失败:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void loadFavorites(); }, [loadFavorites]);

    const handleDelete = useCallback(async (id: string) => {
        try {
            await removeFavorite(id);
            setFavorites(prev => prev.filter(f => f.id !== id));
        } catch (err) {
            console.error("[ChatFavorites] 删除失败:", err);
        }
    }, []);

    return (
        <PageShell title={pageTitle} onBack={onBack} className="absolute inset-0 z-[100]">
            {/* Tab 筛选栏：仅全局模式且有多个角色时显示 */}
            {!isSingleMode && contactTabs.length > 1 && (
                <div className="sticky top-0 z-10 bg-[var(--c-page-body-bg)] px-4 pt-2 pb-3 flex gap-2 overflow-x-auto scrollbar-none border-b border-[color-mix(in_srgb,var(--c-card-border)_20%,transparent)]">
                    <button
                        onClick={() => setActiveContactId(null)}
                        className={`shrink-0 px-3 py-1.5 rounded-full ts-13 font-semibold transition-all ${
                            !activeContactId
                                ? "bg-[var(--c-icon-active)] text-white"
                                : "bg-[var(--c-input)] text-[var(--c-text)]"
                        }`}
                    >
                        全部 <span className="opacity-70">({favorites.length})</span>
                    </button>
                    {contactTabs.map(tab => (
                        <button
                            key={tab.contactId}
                            onClick={() => setActiveContactId(
                                tab.contactId === activeContactId ? null : tab.contactId
                            )}
                            className={`shrink-0 px-3 py-1.5 rounded-full ts-13 font-semibold transition-all ${
                                activeContactId === tab.contactId
                                    ? "bg-[var(--c-icon-active)] text-white"
                                    : "bg-[var(--c-input)] text-[var(--c-text)]"
                            }`}
                        >
                            <span className="truncate max-w-[80px] inline-block align-bottom">{tab.name}</span>
                            <span className="opacity-60 ml-1">({tab.count})</span>
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
                                长按气泡选择「收藏」，可单条或多选合并保存
                            </span>
                        )}
                    </div>
                ) : (
                    displayedFavorites.map(item => (
                        <FavoriteItemCard key={item.id} item={item} onDelete={handleDelete} />
                    ))
                )}
            </div>
        </PageShell>
    );
}
