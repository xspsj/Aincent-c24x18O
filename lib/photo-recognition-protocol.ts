/**
 * 识图记忆标记协议：[识图:描述1|描述2|...]
 *
 * 用户发真实照片（非角色生图）时，llm-prompt-assembler 会在 prompt 里要求角色顺手
 * 用这个标记写下它看到的画面内容。标记本身不展示给用户，只用于静默回写进对应照片
 * 消息的 mediaData.label / mediaData.images[].label，取代原来的空占位"图片"。
 *
 * 图片本体还在时，AI 的感知始终以直接看图（视觉通道）为准；这条描述只在图片以后被
 * 清理（用户清理存储、导出转移等场景）后，作为唯一留存下来的文字记忆兜底。
 *
 * 多张图（合并图集）按 | 分隔，顺序对应 mediaData.images 数组的顺序。
 */

const PHOTO_RECOGNITION_RE = /\[识图\s*[:：]\s*([^\]\r\n]+)\]/;
const PHOTO_RECOGNITION_RE_GLOBAL = /\[识图\s*[:：]\s*([^\]\r\n]+)\]/g;

export type PhotoRecognitionResult = {
    /** 按 | 拆分后的每张图描述，已 trim，过滤空项 */
    descriptions: string[];
    /** 原始标记文本（用于从显示文本里剥离） */
    raw: string;
};

/** 从角色回复原文中提取识图标记（只取第一个，一轮回复只应该有一个） */
export function extractPhotoRecognition(text: string): PhotoRecognitionResult | null {
    const match = text.match(PHOTO_RECOGNITION_RE);
    if (!match) return null;
    const descriptions = match[1]
        .split("|")
        .map(part => part.trim())
        .filter(Boolean);
    if (descriptions.length === 0) return null;
    return { descriptions, raw: match[0] };
}

/** 从显示文本里剥离识图标记，不让它出现在聊天气泡里 */
export function stripPhotoRecognition(text: string): string {
    if (!PHOTO_RECOGNITION_RE.test(text)) return text;
    return text
        .replace(PHOTO_RECOGNITION_RE_GLOBAL, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
