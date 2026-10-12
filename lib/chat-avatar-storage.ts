// lib/chat-avatar-storage.ts
// 角色独立网络头像仓储系统（聊天专属，不污染角色卡本体与各阶段好感度立绘）
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const CHAR_AVATAR_VAULT_KEY = "ai_phone_char_avatar_vault_v1";
registerKvMigration(CHAR_AVATAR_VAULT_KEY);

export interface ChatAvatarItem {
    id: string;
    url: string;             // base64 / blob URL / 外部 URL
    description: string;     // 简短描述，例如："你发给我戴围巾的雪人自拍"
    source: "user_sent" | "manual"; // 来源：聊天中收到换上 / 手动上传
    createdAt: string;       // ISO 时间
}

/** characterId → ChatAvatarItem[] */
type CharAvatarVault = Record<string, ChatAvatarItem[]>;

function readVault(): CharAvatarVault {
    if (typeof window === "undefined") return {};
    try {
        const raw = kvGet(CHAR_AVATAR_VAULT_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeVault(vault: CharAvatarVault): void {
    if (typeof window === "undefined") return;
    kvSet(CHAR_AVATAR_VAULT_KEY, JSON.stringify(vault));
}

/** 获取角色的专属头像库 */
export function getCharacterChatAvatars(characterId: string): ChatAvatarItem[] {
    if (!characterId) return [];
    const vault = readVault();
    return vault[characterId] || [];
}

/** 为角色添加一个专属头像 */
export function addCharacterChatAvatar(
    characterId: string,
    url: string,
    description: string,
    source: "user_sent" | "manual" = "manual"
): ChatAvatarItem {
    const vault = readVault();
    const list = vault[characterId] || [];
    
    // 如果已有相同 URL 的头像，更新描述并移到最前
    const existingIdx = list.findIndex(item => item.url === url);
    if (existingIdx !== -1) {
        list[existingIdx].description = description || list[existingIdx].description;
        const item = list[existingIdx];
        list.splice(existingIdx, 1);
        list.unshift(item);
        vault[characterId] = list;
        writeVault(vault);
        return item;
    }

    const newItem: ChatAvatarItem = {
        id: `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        url,
        description: description.trim() || "聊天专属头像",
        source,
        createdAt: new Date().toISOString(),
    };
    list.unshift(newItem);
    vault[characterId] = list;
    writeVault(vault);
    return newItem;
}

/** 删除角色的某个专属头像 */
export function removeCharacterChatAvatar(characterId: string, avatarId: string): void {
    const vault = readVault();
    const list = vault[characterId] || [];
    vault[characterId] = list.filter(item => item.id !== avatarId);
    writeVault(vault);
}

/** 更新某个头像的描述 */
export function updateCharacterChatAvatarDesc(characterId: string, avatarId: string, description: string): void {
    const vault = readVault();
    const list = vault[characterId] || [];
    const target = list.find(item => item.id === avatarId);
    if (target) {
        target.description = description.trim();
        writeVault(vault);
    }
}
