import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GradHunt — Entry-Level Jobs & Internships in India",
  description:
    "Discover early-career opportunities and internships in India, aggregated directly from company job boards and public listings.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white">
        {children}
      </body>
    </html>
  );
}
