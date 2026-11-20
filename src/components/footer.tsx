import React from "react";

export function Footer() {
  return (
    <footer className="border-t border-zinc-800/80 bg-zinc-950 py-8 text-xs text-zinc-500 mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-400">GradHunt</span>
          <span>—</span>
          <span>Curated entry-level positions and internships in India</span>
        </div>

        <div className="text-zinc-500">
          Source feeds: Greenhouse, Lever, Ashby &amp; National Career Service
        </div>
      </div>
    </footer>
  );
}
