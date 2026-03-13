"use client";

import dynamic from "next/dynamic";

const PinballGame = dynamic(() => import("@/components/PinballGame"), {
  ssr: false,
  loading: () => (
    <div className="w-screen h-screen bg-[#0a0a2e] flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">☕</div>
        <p className="text-white/60 text-lg">로딩 중...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <PinballGame />;
}
