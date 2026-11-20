import React from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";

export function Navbar() {
  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/90 sticky top-0 z-40 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-zinc-100 hover:text-white transition-colors"
        >
          <div className="size-7 rounded-md bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-zinc-200">
            <Briefcase className="size-3.5" />
          </div>
          <span className="font-semibold text-base tracking-tight">
            GradHunt
          </span>
          <span className="text-zinc-500 text-xs hidden sm:inline-block border-l border-zinc-800 pl-2.5">
            India
          </span>
        </Link>

        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span className="hidden md:inline-block text-zinc-400">
            Greenhouse • Lever • Ashby • SmartRecruiters • Recruitee • Pinpoint
          </span>
        </div>
      </div>
    </header>
  );
}
