"use client";

import { ChevronLeft } from "lucide-react";

import { LetterMailSettings } from "./letter-mail-settings";

type LettersAppProps = {
  onBack: () => void;
  onNotice?: (message: string) => void;
};

// 第 1 步：先只放 QQ 邮箱设置，用来验证发信通道。
// 第 2 步在这里加角色切换、信件列表、阅读和删除；第 3 步换成抽屉与拆信动画。
export function LettersApp({ onBack, onNotice }: LettersAppProps) {
  return (
    <section className="diary-app lt-app">
      <header className="diary-app-header">
        <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回手记">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1>信件</h1>
          <p>角色寄给你的信</p>
        </div>
        <span className="diary-header-spacer" />
      </header>

      <main className="lt-body">
        <LetterMailSettings onNotice={onNotice} />
        <p className="lt-placeholder">信件抽屉还在施工，先把邮箱配好、发一封测试信试试。</p>
      </main>
    </section>
  );
}
