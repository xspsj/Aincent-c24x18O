"use client";

import { useEffect } from "react";

import { startLetterDeliveryService } from "@/lib/letter-delivery-service";
import { startLetterTimerService } from "@/lib/letter-timer-service";

/** 在应用运行期间把到点的信投递到 QQ 邮箱，并运行写信节奏定时巡检。 */
export function LetterDeliveryScheduler() {
  useEffect(() => {
    const stopDelivery = startLetterDeliveryService();
    const stopTimer = startLetterTimerService();
    return () => {
      stopDelivery();
      stopTimer();
    };
  }, []);
  return null;
}
