import type { Metadata } from "next";
import { Courier_Prime, Geist, Geist_Mono, Inter } from "next/font/google";
import "@mdxeditor/editor/style.css";
import "@/styles/globals.css";
import "@/styles/markdown-editor.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

// Screenplays only, so it is not preloaded on every page.
const courierPrime = Courier_Prime({
  preload: false,
  style: ["normal", "italic"],
  variable: "--font-screenplay",
  weight: ["400", "700"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VizStats Reader",
  description:
    "Read Markdown, PDFs, screenplays and diagrams in your browser. Nothing is uploaded.",
  icons: {
    icon: [
      // Theme-aware SVG favicon (preferred by modern browsers).
      {
        url: "/assets/icon-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/assets/icon.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
      // PNG fallback for browsers without SVG favicon support.
      {
        url: "/assets/icon-dark.png",
        type: "image/png",
        sizes: "512x400",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/assets/icon.png",
        type: "image/png",
        sizes: "512x399",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    shortcut: [{ url: "/assets/icon.png", type: "image/png" }],
    apple: [
      { url: "/assets/icon.png", sizes: "512x399", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        courierPrime.variable,
        "font-sans",
        inter.variable,
      )}
    >
      <body className="min-h-screen">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
