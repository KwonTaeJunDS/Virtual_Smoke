import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "Virtual Cigarette Interaction System",
  description: "A private, local AR smoking interaction built for real-time performance.",
  openGraph: {
    title: "Virtual Cigarette Interaction System",
    description: "Real-time AR interaction powered entirely on your device.",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "Virtual Cigarette — Real-Time AR Interaction" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Virtual Cigarette Interaction System",
    description: "Real-time AR interaction powered entirely on your device.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
