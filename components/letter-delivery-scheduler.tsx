"use client";

import { useEffect } from "react";

import { startLetterDeliveryService } from "@/lib/letter-delivery-service";

/** 在应用运行期间把到点的信投递到 QQ 邮箱。没配邮箱时每次检查直接返回。 */
export function LetterDeliveryScheduler() {
  useEffect(() => startLetterDeliveryService(), []);
  return null;
}
