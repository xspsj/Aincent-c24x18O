import { saveChatImageToIndexedDB } from "./chat-asset-storage";
import { loadChatMessages, syncChatGeneratedImagePromptText, updateChatMessage, type ChatMessage } from "./chat-storage";
import { generatedImageFilename, generateImageFromConfiguredApi } from "./image-generation-service";
import { photoTypeToReferenceFlags, referenceFlagsToPhotoType, resolvePhotoType, type PhotoType } from "./rich-message-parser";
import { updateMomentPost } from "./moments-storage";
import type { MomentPost } from "./moments-types";

// ── 后台生图任务登记 ──
// 生图与聊天回复解耦后，图片在后台独立生成，可能持续几分钟。
// 这里登记「本页面里正在生成的消息」：消息标记为生成中、却不在这里面，说明请求已经随
// 页面刷新/关闭丢失（孤儿任务），进入聊天室时把它标为失败，避免一直卡在「图片接收中」。
const activeChatImageGenerations = new Set<string>();

export function isChatImageGenerationActive(messageId: string): boolean {
    return activeChatImageGenerations.has(messageId);
}

/**
 * 把这个会话里「标记生成中但实际没有请求在跑」的照片标为失败，返回被改动的消息。
 * 进行中的请求有自己的超时（直连 360 秒 / 服务端 180 秒），到时会自己落为失败；
 * 这里只处理请求已丢失的情况，失败后照片显示描述，点开可重新生成。
 */
export function failOrphanedPendingChatImages(sessionId: string): ChatMessage[] {
    const changed: ChatMessage[] = [];
    for (const message of loadChatMessages(sessionId)) {
        if (message.mediaType !== "image" || message.mediaData?.imageGenerationStatus !== "pending") continue;
        if (activeChatImageGenerations.has(message.id)) continue;
        const failed = updateChatMessage(message.id, {
            mediaData: {
                ...message.mediaData,
                imageGenerationStatus: "failed",
                imageGenerationError: "图片生成中断（页面刷新或关闭），可点开重新生成",
            },
        });
        if (failed) changed.push(failed);
    }
    return changed;
}

function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function dispatchChatMessagesUpdated(sessionId: string, message: ChatMessage): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("chat-messages-updated", {
        detail: { sessionId, message },
    }));
}

function dispatchMomentsUpdated(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("moments-updated"));
}

export function createPendingChatGeneratedImageData(
    mediaData: ChatMessage["mediaData"] | undefined,
    description?: string,
): ChatMessage["mediaData"] {
    const label = (description || mediaData?.label || "").trim();
    return {
        ...mediaData,
        label,
        imageGenerationStatus: "pending",
        imageGenerationError: undefined,
    };
}

export function isPendingChatGeneratedImageMessage(message: Pick<ChatMessage, "mediaType" | "mediaData">): boolean {
    return message.mediaType === "image" && message.mediaData?.imageGenerationStatus === "pending";
}

export async function generateAndApplyChatGeneratedImage(
    message: ChatMessage,
    characterId?: string,
    options?: { signal?: AbortSignal; description?: string; useReferenceImage?: boolean; useUserReferenceImage?: boolean; photoType?: PhotoType },
): Promise<ChatMessage> {
    const previousDescription = message.mediaData?.label?.trim() || "";
    const description = (options?.description ?? previousDescription).trim();
    if (!description) throw new Error("缺少图片描述，无法重新生成");

    // 照片类型是唯一依据：显式传入的类型 > 显式传入的两个勾选 > 消息里已存的类型（旧消息按旧开关推算）
    const previousType = resolvePhotoType(message.mediaData);
    const photoType: PhotoType = options?.photoType
        ?? (options?.useReferenceImage !== undefined || options?.useUserReferenceImage !== undefined
            ? referenceFlagsToPhotoType(
                options?.useReferenceImage ?? photoTypeToReferenceFlags(previousType).useReferenceImage,
                options?.useUserReferenceImage ?? photoTypeToReferenceFlags(previousType).useUserReferenceImage,
            )
            : previousType);
    const { useReferenceImage: effectiveUseReference, useUserReferenceImage: effectiveUseUserReference } = photoTypeToReferenceFlags(photoType);
    const typeFields = {
        photoType,
        useReferenceImage: effectiveUseReference,
        useUserReferenceImage: effectiveUseUserReference,
    };

    // 群聊里 char 指发这条消息的角色；你在群聊发的照片用弹窗里选的成员（存在 recipientId）
    const effectiveCharacterId = message.senderCharacterId || message.mediaData?.recipientId || characterId;

    if ((previousDescription && previousDescription !== description) || photoType !== previousType) {
        syncChatGeneratedImagePromptText(message.id, previousDescription, description, photoType);
    }

    // 登记为进行中：在第一个 await 之前同步完成，进入聊天室的孤儿检查不会误判
    activeChatImageGenerations.add(message.id);
    try {
        // 重试路径：先落库为 pending 并广播，气泡立刻切到"生成中"态（首次生图本来就是 pending，无需重写）。
        // 之后无论成功/失败都会再写一次状态，不会卡在 pending。
        if (message.mediaData?.imageGenerationStatus !== "pending") {
            const marked = updateChatMessage(message.id, {
                mediaData: {
                    ...message.mediaData,
                    label: description,
                    ...typeFields,
                    imageGenerationStatus: "pending",
                    imageGenerationError: undefined,
                },
            });
            if (marked) dispatchChatMessagesUpdated(marked.sessionId, marked);
        }

        try {
            const generated = await generateImageFromConfiguredApi({
                description,
                characterId: effectiveCharacterId,
                useReferenceImage: effectiveUseReference,
                useUserReferenceImage: effectiveUseUserReference,
                signal: options?.signal,
            });
            if (!generated) throw new Error("生图配置未启用或不完整");

            const fileName = generatedImageFilename(description, generated.mimeType);
            const previousData = message.mediaData ?? {};
            const nextData: ChatMessage["mediaData"] = {
                ...previousData,
                label: description,
                fileType: "image",
                fileName,
                ...typeFields,
                imageGenerationMediaRef: generated.mediaRef,
                imageGenerationPrompt: generated.prompt,
                imageGenerationUsedReference: generated.usedReferenceImage,
                imageGenerationStatus: "generated",
                imageGenerationError: undefined,
            };
            const updated = updateChatMessage(message.id, {
                content: fileName,
                mediaType: "media_file",
                mediaUrl: generated.dataUrl,
                mediaData: nextData,
            });
            if (!updated) throw new Error("原消息不存在，无法替换图片");
            dispatchChatMessagesUpdated(updated.sessionId, updated);
            return updated;
        } catch (error) {
            const failed = updateChatMessage(message.id, {
                mediaData: {
                    ...message.mediaData,
                    label: description,
                    ...typeFields,
                    imageGenerationStatus: "failed",
                    imageGenerationError: errorToMessage(error),
                },
            });
            if (failed) dispatchChatMessagesUpdated(failed.sessionId, failed);
            throw error;
        }
    } finally {
        activeChatImageGenerations.delete(message.id);
    }
}

export async function retryChatGeneratedImage(
    message: ChatMessage,
    characterId?: string,
    nextDescription?: string,
    useReferenceImage?: boolean,
    useUserReferenceImage?: boolean,
    photoType?: PhotoType,
): Promise<ChatMessage> {
    return generateAndApplyChatGeneratedImage(message, characterId, {
        description: nextDescription,
        useReferenceImage,
        useUserReferenceImage,
        photoType,
    });
}

/** 读朋友圈帖子的照片类型：优先用 photoType，旧帖按两个旧开关推算 */
export function resolveMomentPhotoType(post: Pick<MomentPost, "photoType" | "photoUseReferenceImage" | "photoUseUserReferenceImage">): PhotoType {
    return resolvePhotoType({
        photoType: post.photoType,
        useReferenceImage: post.photoUseReferenceImage,
        useUserReferenceImage: post.photoUseUserReferenceImage,
    });
}

export async function retryMomentGeneratedPhoto(
    post: MomentPost,
    nextDescription?: string,
    useReferenceImage?: boolean,
    photoType?: PhotoType,
): Promise<MomentPost> {
    const description = (nextDescription ?? post.photoDescription)?.trim();
    if (!description) throw new Error("缺少图片描述，无法重新生成");

    // 同聊天：显式类型 > 旧的角色勾选 > 帖子已存的类型
    const previousType = resolveMomentPhotoType(post);
    const effectiveType: PhotoType = photoType
        ?? (useReferenceImage !== undefined
            ? referenceFlagsToPhotoType(useReferenceImage, photoTypeToReferenceFlags(previousType).useUserReferenceImage)
            : previousType);
    const flags = photoTypeToReferenceFlags(effectiveType);
    const typeFields = {
        photoType: effectiveType,
        photoUseReferenceImage: flags.useReferenceImage,
        photoUseUserReferenceImage: flags.useUserReferenceImage,
    };

    // 同聊天：重试先置 pending 并广播，卡片立刻显示"图片生成中…"；成功/失败都会再写状态。
    updateMomentPost(post.id, {
        photoDescription: description,
        ...typeFields,
        photoGenerationStatus: "pending",
        photoGenerationError: undefined,
    });
    dispatchMomentsUpdated();

    try {
        const generated = await generateImageFromConfiguredApi({
            description,
            characterId: post.authorType === "character" ? post.authorId : undefined,
            useReferenceImage: flags.useReferenceImage,
            useUserReferenceImage: flags.useUserReferenceImage,
        });
        if (!generated) throw new Error("生图配置未启用或不完整");

        const assetId = await saveChatImageToIndexedDB(generated.blob);
        const updated = updateMomentPost(post.id, {
            photoUrl: `asset://${assetId}`,
            photoDescription: description,
            ...typeFields,
            photoGenerationStatus: "generated",
            photoGenerationPrompt: generated.prompt,
            photoGenerationError: undefined,
        });
        if (!updated) throw new Error("原朋友圈不存在，无法替换图片");
        dispatchMomentsUpdated();
        return updated;
    } catch (error) {
        updateMomentPost(post.id, {
            photoDescription: description,
            ...typeFields,
            photoGenerationStatus: "failed",
            photoGenerationError: errorToMessage(error),
        });
        dispatchMomentsUpdated();
        throw error;
    }
}
