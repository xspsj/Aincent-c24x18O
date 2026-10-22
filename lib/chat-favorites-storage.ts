// lib/chat-favorites-storage.ts
// 专属收藏夹：独立于聊天室生命周期的永久消息资产保险箱。
// 收藏时深度克隆消息快照，聊天室删除/修剪/重抽均不影响收藏夹内容。

import Dexie from "dexie";
import type { ChatMessage } from "./chat-storage";
import { isMediaStoreRef, loadMediaBlob } from "./media-cache-storage";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";

// ── 数据类型 ──────────────────────────────

/** 合并收藏中每一条消息的快照 */
export type CombinedMessageSnapshot = {
    role: ChatMessage["role"];
    senderName?: string;
    content: string;
    mediaType?: ChatMessage["mediaType"];
    mediaData?: ChatMessage["mediaData"];
    createdAt: string;
    fixedBlob?: string; // 该条消息的图片/音频固化数据（base64 data URL）
};

export type FavoriteItem = {
    id: string;               // 收藏记录唯一 ID
    originalMessageId: string;
    sessionId: string;
    contactId: string;        // 角色 ID（单聊=contactId，群聊=session.id）
    characterName: string;
    characterAvatar?: string;
    userAvatar?: string;
    userName?: string;
    isGroup: boolean;
    groupName?: string;
    role: ChatMessage["role"];
    mediaType: ChatMessage["mediaType"];
    content: string;
    mediaData?: ChatMessage["mediaData"];
    mediaUrl?: string;
    fixedBlob?: string;       // 单条消息的图片/音频固化 base64 data URL
    // 合并收藏
    isCombined?: boolean;
    combinedMessages?: CombinedMessageSnapshot[];
    originalCreatedAt: string;
    favoritedAt: string;
    note?: string;
};

// ── Dexie 数据库 ──────────────────────────

class FavoritesDatabase extends Dexie {
    favorites!: Dexie.Table<FavoriteItem, string>;

    constructor() {
        super("AiPhoneFavoritesDB");
        this.version(1).stores({
            favorites: "id, contactId, favoritedAt, sessionId",
        });
    }
}

const favDb = new FavoritesDatabase();

// ── 媒体固化工具 ──────────────────────────

/**
 * 尝试把消息里的图片/音频提取成 base64 data URL 固化存储。
 * 失败时静默返回 undefined，不阻断收藏。
 *
 * 支持的媒体类型：
 * - audio（语音条）：mediaUrl 直接就是 data URL，存下来就好
 * - image（AI 生成图/用户上传图）：走图片路径多条分支
 */
async function tryFixMediaBlob(msg: ChatMessage): Promise<string | undefined> {
    // ── 语音固化：最简单的路径 ────────────────
    // Minimax 合成后的音频和用户录制的语音都直接存为 data: URL 在 mediaUrl 里
    if (msg.mediaType === "audio") {
        const url = msg.mediaUrl;
        if (!url) return undefined;
        // 已经是 base64 data URL：直接存，不需要任何转换
        if (url.startsWith("data:")) return url;
        // blob: URL（用户录音尚未落库时可能是这种形式）：fetch 转 base64
        if (url.startsWith("blob:")) {
            try {
                const resp = await fetch(url);
                const blob = await resp.blob();
                return blobToBase64DataUrl(blob, blob.type || "audio/mpeg");
            } catch { return undefined; }
        }
        return undefined;
    }

    // ── 图片固化 ───────────────────────────────
    if (msg.mediaType !== "image") return undefined;

    const url = msg.mediaUrl || msg.mediaData?.imageGenerationMediaRef;
    if (!url) return undefined;

    try {
        // 路径1: media-store:// 引用 → 从 MediaCacheDB 读 Blob
        if (isMediaStoreRef(url)) {
            const result = await loadMediaBlob(url);
            if (!result) return undefined;
            return blobToBase64DataUrl(result.blob, result.mimeType);
        }
        // 路径2: IDB asset key（chat-asset-storage）→ 直接返回 data URL
        if (!url.startsWith("http") && !url.startsWith("data:") && !url.startsWith("blob:")) {
            const dataUrl = await getChatImageFromIndexedDB(url);
            if (dataUrl) return dataUrl;
        }
        // 路径3: blob: URL → fetch 转 base64
        if (url.startsWith("blob:")) {
            const resp = await fetch(url);
            const blob = await resp.blob();
            return blobToBase64DataUrl(blob, blob.type);
        }
        // 路径4: data: URL → 直接用
        if (url.startsWith("data:")) return url;
    } catch { /* 静默 */ }

    return undefined;
}

function blobToBase64DataUrl(blob: Blob, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(new Blob([blob], { type: mimeType || blob.type }));
    });
}

function generateFavoriteId(): string {
    return `fav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 写入：单条收藏 ────────────────────────

export async function addFavorite(
    msg: ChatMessage,
    meta: {
        contactId: string;
        characterName: string;
        characterAvatar?: string;
        userAvatar?: string;
        userName?: string;
        isGroup: boolean;
        groupName?: string;
    }
): Promise<FavoriteItem> {
    const fixedBlob = await tryFixMediaBlob(msg);

    const item: FavoriteItem = {
        id: generateFavoriteId(),
        originalMessageId: msg.id,
        sessionId: msg.sessionId,
        contactId: meta.contactId,
        characterName: meta.characterName,
        characterAvatar: meta.characterAvatar,
        userAvatar: meta.userAvatar,
        userName: meta.userName,
        isGroup: meta.isGroup,
        groupName: meta.groupName,
        role: msg.role,
        mediaType: msg.mediaType,
        content: msg.content,
        mediaData: msg.mediaData ? JSON.parse(JSON.stringify(msg.mediaData)) : undefined,
        mediaUrl: msg.mediaUrl,
        fixedBlob,
        isCombined: false,
        originalCreatedAt: msg.createdAt,
        favoritedAt: new Date().toISOString(),
    };
    await favDb.favorites.put(item);
    return item;
}

// ── 写入：合并收藏（多条） ─────────────────

export async function addCombinedFavorite(
    msgs: ChatMessage[],
    meta: {
        contactId: string;
        characterName: string;
        characterAvatar?: string;
        userAvatar?: string;
        userName?: string;
        isGroup: boolean;
        groupName?: string;
        getSenderName: (msg: ChatMessage) => string;
    }
): Promise<FavoriteItem> {
    if (msgs.length === 0) throw new Error("消息列表不能为空");

    // 并行固化所有媒体（图片 + 语音）
    const fixedBlobs = await Promise.all(msgs.map(m => tryFixMediaBlob(m)));

    const combinedMessages: CombinedMessageSnapshot[] = msgs.map((m, i) => ({
        role: m.role,
        senderName: meta.getSenderName(m),
        content: m.content,
        mediaType: m.mediaType,
        mediaData: m.mediaData ? JSON.parse(JSON.stringify(m.mediaData)) : undefined,
        createdAt: m.createdAt,
        fixedBlob: fixedBlobs[i],
    }));

    // 摘要预览：前两条
    const previewParts = combinedMessages.slice(0, 2).map(cm => {
        const name = cm.senderName || (cm.role === "user" ? "我" : meta.characterName);
        const text = cm.mediaType === "audio"
            ? `[语音${cm.mediaData?.label ? ` ${cm.mediaData.label}` : ""}]`
            : cm.mediaType
                ? `[${cm.mediaType}]`
                : cm.content.slice(0, 20);
        return `${name}: ${text}`;
    });
    const summary = previewParts.join(" / ") + (msgs.length > 2 ? ` 等${msgs.length}条` : "");

    const first = msgs[0];
    const item: FavoriteItem = {
        id: generateFavoriteId(),
        originalMessageId: first.id,
        sessionId: first.sessionId,
        contactId: meta.contactId,
        characterName: meta.characterName,
        characterAvatar: meta.characterAvatar,
        userAvatar: meta.userAvatar,
        userName: meta.userName,
        isGroup: meta.isGroup,
        groupName: meta.groupName,
        role: first.role,
        mediaType: undefined,
        content: summary,
        isCombined: true,
        combinedMessages,
        originalCreatedAt: first.createdAt,
        favoritedAt: new Date().toISOString(),
    };
    await favDb.favorites.put(item);
    return item;
}

// ── 删除 ──────────────────────────────────

export async function removeFavorite(id: string): Promise<void> {
    await favDb.favorites.delete(id);
}

// ── 读取 ──────────────────────────────────

export async function loadAllFavorites(): Promise<FavoriteItem[]> {
    const all = await favDb.favorites.toArray();
    return all.sort((a, b) => b.favoritedAt.localeCompare(a.favoritedAt));
}

export async function loadFavoritesByContact(contactId: string): Promise<FavoriteItem[]> {
    const results = await favDb.favorites
        .where("contactId")
        .equals(contactId)
        .toArray();
    return results.sort((a, b) => b.favoritedAt.localeCompare(a.favoritedAt));
}

export async function getFavoritesCount(): Promise<number> {
    return favDb.favorites.count();
}
