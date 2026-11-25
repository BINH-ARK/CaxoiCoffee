"use client";

import React from "react";
import {
  TrendingUp,
  Truck,
  Landmark,
  Coffee,
  Tag,
  Shield,
  Settings,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

export type AdminTabKey =
  | "DASHBOARD"
  | "ORDERS"
  | "PAYOS"
  | "MENU"
  | "PROMOTIONS"
  | "RBAC"
  | "SETTINGS"
  | "DATABASE";

interface AdminSidebarProps {
  activeTab: AdminTabKey;
  onTabChange: (tab: AdminTabKey) => void;
  productCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

interface SidebarNavItem {
  id: AdminTabKey;
  label: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
  iconColor: string;
}

export default function AdminSidebar({
  activeTab,
  onTabChange,
  productCount = 5,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}: AdminSidebarProps) {
  const businessItems: SidebarNavItem[] = [
    {
      id: "DASHBOARD",
      label: "Doanh thu & Tổng quan",
      icon: TrendingUp,
      activeClass: "bg-blue-600 text-white shadow-md ring-1 ring-blue-400/50",
      iconColor: "text-blue-400",
    },
    {
      id: "ORDERS",
      label: "Đơn hàng & Vận chuyển",
      icon: Truck,
      activeClass: "bg-orange-600 text-white shadow-md ring-1 ring-orange-400/50",
      iconColor: "text-orange-400",
    },
    {
      id: "PAYOS",
      label: "Thanh toán & payOS",
      icon: Landmark,
      activeClass: "bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400/50",
      iconColor: "text-indigo-300",
    },
    {
      id: "MENU",
      label: "Thực đơn",
      badge: `${productCount} món`,
      icon: Coffee,
      activeClass: "bg-caramel text-white shadow-md ring-1 ring-pink-300/50",
      iconColor: "text-amber-300",
    },
    {
      id: "PROMOTIONS",
      label: "Khuyến mãi",
      icon: Tag,
      activeClass: "bg-pink-600 text-white shadow-md ring-1 ring-pink-400/50",
      iconColor: "text-pink-400",
    },
  ];

  const systemItems: SidebarNavItem[] = [
    {
      id: "RBAC",
      label: "Phân quyền (RBAC)",
      icon: Shield,
      activeClass: "bg-caramel text-white shadow-md ring-1 ring-pink-300/50",
      iconColor: "text-amber-400",
    },
    {
      id: "SETTINGS",
      label: "Cài đặt Quán & Trang chủ",
      icon: Settings,
      activeClass: "bg-caramel text-white shadow-md ring-1 ring-pink-300/50",
      iconColor: "text-stone-300",
    },
    {
      id: "DATABASE",
      label: "Sao Lưu & CSDL",
      icon: Database,
      activeClass: "bg-emerald-600 text-white shadow-md ring-1 ring-emerald-400/50",
      iconColor: "text-emerald-400",
    },
  ];

  const handleSelect = (tab: AdminTabKey) => {
    onTabChange(tab);
    onCloseMobile();
  };

  const renderGroup = (title: string, items: SidebarNavItem[], compact: boolean) => (
    <div className="space-y-1">
      {!compact ? (
        <div className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-pink-200/50 select-none">
          {title}
        </div>
      ) : (
        <div className="mx-3 my-2 h-px bg-white/10" />
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item.id)}
            title={compact ? `${item.label}${item.badge ? ` (${item.badge})` : ""}` : undefined}
            className={`group relative w-full flex items-center ${
              compact ? "justify-center px-2 py-2.5" : "justify-between px-3 py-2.5"
            } rounded-xl text-xs font-bold transition-all ${
              isActive
                ? item.activeClass
                : "text-stone-300 hover:text-white hover:bg-white/10"
            }`}
          >
            <div className={`flex items-center ${compact ? "justify-center" : "gap-2.5 min-w-0"}`}>
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive ? "text-white" : item.iconColor
                }`}
              />
              {!compact && <span className="truncate">{item.label}</span>}
            </div>
            {!compact && item.badge && (
              <span
                className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md shrink-0 ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-white/10 text-pink-200/80"
                }`}
              >
                {item.badge}
              </span>
            )}

            {/* Floating tooltip when collapsed on desktop */}
            {compact && (
              <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-lg bg-[#160B07] px-2.5 py-1.5 text-[11px] font-bold text-white shadow-xl border border-pink-900/40 opacity-0 group-hover:opacity-100 transition-opacity">
                {item.label}
                {item.badge ? ` (${item.badge})` : ""}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {/* DESKTOP COLLAPSIBLE VERTICAL SIDEBAR */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 sticky top-16 h-[calc(100vh-4rem)] bg-[#1A0D09] text-white border-r border-pink-900/30 shadow-lg transition-all duration-200 ease-in-out z-30 ${
          isCollapsed ? "w-[72px]" : "w-64"
        }`}
      >
        {/* Top Collapse / Expand Control */}
        <div
          className={`flex items-center border-b border-white/10 px-3 py-2.5 ${
            isCollapsed ? "justify-center" : "justify-between"
          }`}
        >
          {!isCollapsed && (
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-pink-200/80">
              Menu Quản Trị
            </span>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            title={isCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-pink-200 hover:text-white transition-colors"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto overflow-x-visible p-2.5 space-y-3">
          {renderGroup("Kinh doanh & Bán hàng", businessItems, isCollapsed)}
          {renderGroup("Hệ thống & Cài đặt", systemItems, isCollapsed)}
        </nav>

        {/* Bottom quick toggle hint */}
        <div className="border-t border-white/10 p-2.5">
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`w-full flex items-center ${
              isCollapsed ? "justify-center" : "justify-center gap-2"
            } py-2 px-2.5 rounded-xl text-[11px] font-bold text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors`}
            title={isCollapsed ? "Phóng to menu" : "Thu nhỏ menu"}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-pink-300" />
            ) : (
              <>
                <PanelLeftClose className="w-3.5 h-3.5 text-pink-300" />
                <span>Thu gọn menu</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* MOBILE / TABLET SLIDE-OVER SIDEBAR */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#1A0D09] text-white h-full shadow-2xl border-r border-pink-900/40 flex flex-col z-10">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10">
              <span className="text-xs font-black uppercase tracking-wider text-pink-200">
                Menu Quản Trị Cà Xòi
              </span>
              <button
                type="button"
                onClick={onCloseMobile}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-4">
              {renderGroup("Kinh doanh & Bán hàng", businessItems, false)}
              {renderGroup("Hệ thống & Cài đặt", systemItems, false)}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
