// 信件（手记 → 信件）的数据结构。
//
// 每封信属于一个角色（characterId），按角色分开存放。
// 「立即送达 / 定时送达」由角色写信时自己决定：
//   - immediate：写完即可拆阅，并投递到用户配置的 QQ 邮箱；
//   - scheduled：在 unlockAt 之前处于「待拆封」，手机里看不到正文，
//     到点后才可拆阅，同时投递到 QQ 邮箱。

export type LetterDeliveryMode = "immediate" | "scheduled";

/** 信是怎么来的：角色自主决定写的，还是用户设的写信节奏触发的。 */
export type LetterTrigger = "self" | "timer" | "manual";

/** 投递到现实 QQ 邮箱的状态。 */
export type LetterMailStatus =
  | "none"     // 没配邮箱，只存在手机里
  | "pending"  // 等待投递（定时信未到点，或到点后等网页打开时补发）
  | "sent"     // 已投递
  | "failed";  // 投递失败（会在下次检查时重试，超过上限后停止）

/** 预留：回信。第一版不实现，只占住字段，后续加回信时不用迁移数据。 */
export type LetterReply = {
  id: string;
  body: string;
  createdAt: string;
};

export type Letter = {
  id: string;
  characterId: string;
  characterName: string;
  title: string;
  /** 信纸正文，保留换行。 */
  body: string;
  /** 落款，如「想你的 某某」。可空。 */
  signature: string;
  deliveryMode: LetterDeliveryMode;
  /** 可拆阅时间（ISO）。immediate 时等于 createdAt。 */
  unlockAt: string;
  trigger: LetterTrigger;
  /** 用户第一次拆开这封信的时间；未拆过为空。 */
  openedAt?: string;
  mailStatus: LetterMailStatus;
  mailSentAt?: string;
  mailError?: string;
  mailAttempts: number;
  /** 预留：回信。 */
  replies: LetterReply[];
  createdAt: string;
  updatedAt: string;
};

export type LetterInput = {
  characterId: string;
  characterName: string;
  title: string;
  body: string;
  signature?: string;
  deliveryMode: LetterDeliveryMode;
  /** scheduled 时必填；immediate 时忽略。 */
  unlockAt?: string;
  trigger?: LetterTrigger;
};

/** 用户配置的 QQ 邮箱。只存在本机 IndexedDB，不进备份文件。 */
export type LetterMailConfig = {
  address: string;
  authCode: string;
  /** 最近一次「发送测试信」成功的时间，用来显示「已验证」。 */
  verifiedAt?: string;
  updatedAt: string;
};
