// 信件（手记 → 信件）的数据结构。
//
// 每封信属于一个角色（characterId），按角色分开存放。
// 「立即送达 / 定时送达」由角色写信时自己决定：
//   - immediate：写完即可拆阅，并投递到用户配置的 QQ 邮箱；
//   - scheduled：在 unlockAt 之前处于「待拆封」，手机里看不到正文，
//     到点后才可拆阅，同时投递到 QQ 邮箱。

export type LetterDeliveryMode = "immediate" | "scheduled";

/** 信是怎么来的：角色自主决定写的、用户设的写信节奏触发的、手动/测试放入的。 */
export type LetterTrigger = "self" | "timer" | "manual";

/** 角色写信的定时设置（参考手记定时器设计）。 */
export type LetterTimerSettings = {
  /** 是否开启节奏区间限制（未开启时仅靠角色自己想写时触发）。 */
  enabled: boolean;
  /** 检查/节奏间隔小时（默认 72 小时，即 3 天）。 */
  intervalHours: number;
  /** 允许自动写信的角色 ID 列表；空数组表示全部角色。 */
  characterIds: string[];
  /** 每个角色上次运行/检查的时间戳。 */
  lastRunAtByCharacter: Record<string, string>;
};

export const DEFAULT_LETTER_TIMER_SETTINGS: LetterTimerSettings = {
  enabled: false,
  intervalHours: 72,
  characterIds: [],
  lastRunAtByCharacter: {},
};

/** 投递到现实 QQ 邮箱的状态。 */
export type LetterMailStatus =
  | "none"       // 没配邮箱，只存在手机里
  | "pending"    // 等待投递（定时信未到点，或到点后等网页打开时补发）
  | "sending"    // 正在投递
  | "sent"       // 已投递
  | "uncertain"  // 正文已交给 QQ，但没等到回执：可能已经寄到。不自动重试，交给用户判断
  | "failed";    // 确定没寄出（如授权码错）。自动重试，超过上限后停止

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
  /** 最近一次开始投递的时间，用于重试间隔与判断「投递中途关了网页」。 */
  mailLastAttemptAt?: string;
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
