// lib/chat-favorites-storage.ts
// 专属收藏夹：独立于聊天室生命周期的永久消息资产保险箱。
// 收藏时深度克隆消息快照，聊天室删除/修剪/重抽均不影响收藏夹内容。

import Dexie from "dexie";
import type { ChatMessage } from "./chat-storage";

// ── 数据类型 ──────────────────────────────

export type FavoriteItem = {
    id: string;               // 收藏记录唯一 ID（与原消息 ID 无关）
    originalMessageId: string; // 原消息 ID（仅供参考，消息可能已被删）
    sessionId: string;        // 原会话 ID（仅供参考）
    contactId: string;        // 角色 ID（单聊=contactId，群聊=群 session.contactId）
    characterName: string;    // 角色/群聊名称快照
    characterAvatar?: string; // 角色头像快照（URL/base64，可选）
    userAvatar?: string;      // 用户头像快照（可选）
    userName?: string;        // 用户名快照
    isGroup: boolean;
    groupName?: string;
    role: ChatMessage["role"]; // 消息角色
    mediaType: ChatMessage["mediaType"]; // 消息媒体类型
    content: string;          // 消息正文
    mediaData?: ChatMessage["mediaData"]; // 媒体数据（完整克隆）
    mediaUrl?: string;        // 原始 mediaUrl（图片/音频引用，克隆后存 fixedBlob）
    fixedBlob?: string;       // 图片/音频的 base64 固化数据（第一期仅为占位，第二期写入）
    originalCreatedAt: string; // 原消息发送时间
    favoritedAt: string;      // 收藏时间
    note?: string;            // 用户备注（预留）
};

// ── Dexie 数据库（在 chat-db.ts 之外独立建库，零耦合） ──

class FavoritesDatabase extends Dexie {
    favorites!: Dexie.Table<FavoriteItem, string>;

    constructor() {
        super("AiPhoneFavoritesDB");
        this.version(1).stores({
            // 主键 id；按 contactId + favoritedAt 建索引供列表筛选/排序
            favorites: "id, contactId, favoritedAt, sessionId",
        });
    }
}

const favDb = new FavoritesDatabase();

// ── 工具函数 ──────────────────────────────

function generateFavoriteId(): string {
    return `fav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 写入 ──────────────────────────────────

/**
 * 将一条 ChatMessage 深度克隆后写入收藏夹。
 * 返回已保存的 FavoriteItem；失败时抛出错误。
 */
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
        // 深度克隆 mediaData，彻底脱离原始引用
        mediaData: msg.mediaData ? JSON.parse(JSON.stringify(msg.mediaData)) : undefined,
        mediaUrl: msg.mediaUrl,
        originalCreatedAt: msg.createdAt,
        favoritedAt: new Date().toISOString(),
    };
    await favDb.favorites.put(item);
    return item;
}

/**
 * 删除一条收藏记录（按收藏 ID）。
 */
export async function removeFavorite(id: string): Promise<void> {
    await favDb.favorites.delete(id);
}

// ── 读取 ──────────────────────────────────

/**
 * 加载所有收藏，按收藏时间倒序。
 */
export async function loadAllFavorites(): Promise<FavoriteItem[]> {
    const all = await favDb.favorites.toArray();
    return all.sort((a, b) => b.favoritedAt.localeCompare(a.favoritedAt));
}

/**
 * 按 contactId 过滤收藏，按收藏时间倒序。
 */
export async function loadFavoritesByContact(contactId: string): Promise<FavoriteItem[]> {
    const results = await favDb.favorites
        .where("contactId")
        .equals(contactId)
        .toArray();
    return results.sort((a, b) => b.favoritedAt.localeCompare(a.favoritedAt));
}

/**
 * 检查某条原始消息是否已被收藏（按 originalMessageId）。
 */
export async function isMessageFavorited(originalMessageId: string): Promise<boolean> {
    const count = await favDb.favorites
        .where("id")
        .startsWith("fav_") // 全表扫描退路
        .filter(item => item.originalMessageId === originalMessageId)
        .count();
    return count > 0;
}

/**
 * 获取收藏总数。
 */
export async function getFavoritesCount(): Promise<number> {
    return favDb.favorites.count();
}
