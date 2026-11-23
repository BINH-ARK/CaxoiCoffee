import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { CartProvider } from "@/context/CartContext";
import { BusinessSettingsProvider } from "@/context/BusinessSettingsContext";
import Header from "@/components/Header";
import StickyCartBar from "@/components/StickyCartBar";
import CustomerFooter from "@/components/CustomerFooter";
import XanhSmFloatingButton from "@/components/XanhSmFloatingButton";

export const metadata: Metadata = {
  title: "Cà Xòi • Trạm Cấp Cứu Cơn Buồn Ngủ Công Sở | Đà Nẵng",
  description: "Cà Xòi: Tỉnh như sáo, báo như Xòi! Trạm cấp cứu cơn buồn ngủ công sở, giao siêu tốc Hải Châu, Thanh Khê, Ngũ Hành Sơn, Đà Nẵng. Hotline: 0905 249 733.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <head>
        <Script src="/suppress-ext-errors.js" strategy="beforeInteractive" />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-cream flex flex-col antialiased selection:bg-caramel/20 selection:text-coffee-900"
      >
        <BusinessSettingsProvider>
          <CartProvider>
            <Header />
            <main className="flex-1 pb-20">{children}</main>
            <StickyCartBar />
            <XanhSmFloatingButton />
            <CustomerFooter />
          </CartProvider>
        </BusinessSettingsProvider>
      </body>
    </html>
  );
}
