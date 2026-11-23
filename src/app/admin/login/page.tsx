"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  Shield,
  KeyRound,
  User,
  Lock,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Touchpad,
  RefreshCw,
  Eye,
  EyeOff,
  UserPlus,
  Mail,
  Phone,
  HelpCircle,
} from "lucide-react";

type AuthMode = "CREDENTIALS" | "PIN" | "REGISTER" | "FORGOT";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "";
  const initialMode = searchParams.get("mode") === "register" ? "REGISTER" : "CREDENTIALS";

  const [activeTab, setActiveTab] = useState<AuthMode>(initialMode);

  // Login states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Register states
  const [regFullName, setRegFullName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regRole, setRegRole] = useState<"SUPER_ADMIN" | "STORE_MANAGER" | "BARISTA" | "CASHIER">("SUPER_ADMIN");
  const [regPhone, setRegPhone] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);

  // Forgot password states
  const [forgotStep, setForgotStep] = useState<"REQUEST" | "VERIFY">("REQUEST");
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [showForgotConfirmPassword, setShowForgotConfirmPassword] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const switchMode = (nextMode: AuthMode) => {
    setActiveTab(nextMode);
    setErrorMsg("");
    setSuccessMsg("");
    if (nextMode === "FORGOT") {
      setForgotStep("REQUEST");
      setForgotUsername(username.trim());
      setForgotOtp("");
      setForgotNewPassword("");
      setForgotConfirmPassword("");
      setDevOtpHint(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setIsLoading(true);

    try {
      const payload =
        activeTab === "PIN"
          ? { loginType: "PIN", pin: pin.trim() }
          : { loginType: "CREDENTIALS", username: username.trim(), password };

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Đăng nhập thất bại");
      }

      const role = data.user.role;
      const isSafeRedirect =
        /^\/(admin|kds)(\/[a-zA-Z0-9/_-]*)?$/.test(redirectPath) &&
        !redirectPath.startsWith("//") &&
        !redirectPath.includes("\\");

      // Smart redirection (anti-open-redirect)
      if (isSafeRedirect) {
        if ((role === "BARISTA" || role === "CASHIER") && redirectPath.startsWith("/admin")) {
          router.push("/kds");
        } else {
          router.push(redirectPath);
        }
      } else if (role === "BARISTA" || role === "CASHIER") {
        router.push("/kds");
      } else {
        router.push("/admin");
      }
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Có lỗi xảy ra khi đăng nhập.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (regPassword.trim().length < 8) {
      setErrorMsg("Mật khẩu phải có tối thiểu 8 ký tự.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setErrorMsg("Mật khẩu xác nhận không khớp.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: regFullName.trim(),
          username: regUsername.trim().toLowerCase(),
          role: regRole,
          phone: regPhone.trim(),
          email: regEmail.trim(),
          password: regPassword,
          confirmPassword: regConfirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Đăng ký tài khoản thất bại.");
      }

      // Chuyển sang khung Đăng nhập & điền sẵn tên đăng nhập vừa tạo
      const createdUsername = regUsername.trim().toLowerCase();
      setUsername(createdUsername);
      setPassword("");
      setRegFullName("");
      setRegUsername("");
      setRegPhone("");
      setRegEmail("");
      setRegPassword("");
      setRegConfirmPassword("");
      setActiveTab("CREDENTIALS");
      setSuccessMsg(
        data.message || `Đăng ký tài khoản @${createdUsername} thành công! Mời bạn đăng nhập.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || "Có lỗi xảy ra khi đăng ký.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setDevOtpHint(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REQUEST_OTP",
          username: forgotUsername.trim().toLowerCase(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Không thể gửi mã OTP khôi phục.");
      }

      if (data.devOtp) {
        setDevOtpHint(String(data.devOtp));
      }
      setSuccessMsg(data.message || "Đã tạo mã OTP 6 số. Vui lòng nhập OTP và mật khẩu mới.");
      setForgotStep("VERIFY");
    } catch (err: any) {
      setErrorMsg(err.message || "Có lỗi xảy ra khi gửi yêu cầu quên mật khẩu.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (forgotNewPassword.trim().length < 8) {
      setErrorMsg("Mật khẩu mới phải có tối thiểu 8 ký tự.");
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setErrorMsg("Mật khẩu xác nhận không khớp.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RESET_PASSWORD",
          username: forgotUsername.trim().toLowerCase(),
          otp: forgotOtp.trim(),
          newPassword: forgotNewPassword,
          confirmPassword: forgotConfirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Không thể đặt lại mật khẩu.");
      }

      setUsername(forgotUsername.trim().toLowerCase());
      setPassword("");
      setDevOtpHint(null);
      setActiveTab("CREDENTIALS");
      setSuccessMsg(data.message || "Đặt lại mật khẩu thành công! Mời bạn đăng nhập.");
    } catch (err: any) {
      setErrorMsg(err.message || "Có lỗi xảy ra khi đặt lại mật khẩu.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-4">
      {/* Back to Customer Store */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-coffee-700 hover:text-caramel transition-colors bg-white px-3 py-1.5 rounded-xl border border-coffee-200 shadow-sm"
        >
          <ArrowRight className="w-3.5 h-3.5 rotate-180" />
          <span>Về trang bán hàng (Khách)</span>
        </Link>
        <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
          🔐 Khu Vực Nội Bộ
        </span>
      </div>

      <div className="bg-white rounded-3xl border border-coffee-100 shadow-xl overflow-hidden animate-fade-in">
        {/* Header Banner */}
        <div className="bg-coffee-950 bg-gradient-to-br from-coffee-950 via-coffee-900 to-coffee-800 text-white p-6 sm:p-7 text-center relative border-b border-coffee-800/60">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-pink-300 shadow-md bg-[#FFD1E3] mx-auto mb-3 relative">
            <Image
              src="/images/ca-xoi-logo.jpg"
              alt="Logo Cà Xòi"
              fill
              sizes="56px"
              className="object-cover"
            />
          </div>
          <h1 className="text-xl font-black tracking-tight">Cổng Quản Trị & Pha Chế Cà Xòi</h1>
          <p className="text-xs text-pink-200 mt-1">Tỉnh như sáo, báo như Xòi • Đà Nẵng</p>
        </div>

        {/* Tab Switcher: Đăng ký Admin -> Đăng nhập -> Mã PIN */}
        {activeTab !== "FORGOT" && (
          <div className="grid grid-cols-3 gap-1 p-2 bg-coffee-50 border-b border-coffee-100">
            <button
              type="button"
              onClick={() => switchMode("REGISTER")}
              className={`py-2 px-1.5 text-[11px] sm:text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 ${
                activeTab === "REGISTER"
                  ? "bg-white text-caramel shadow-sm ring-1 ring-pink-200"
                  : "text-coffee-600 hover:text-coffee-900"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span>Đăng ký Admin</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode("CREDENTIALS")}
              className={`py-2 px-1.5 text-[11px] sm:text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 ${
                activeTab === "CREDENTIALS"
                  ? "bg-white text-coffee-900 shadow-sm"
                  : "text-coffee-600 hover:text-coffee-900"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>Đăng nhập</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode("PIN")}
              className={`py-2 px-1.5 text-[11px] sm:text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 ${
                activeTab === "PIN"
                  ? "bg-white text-coffee-900 shadow-sm"
                  : "text-coffee-600 hover:text-coffee-900"
              }`}
            >
              <Touchpad className="w-3.5 h-3.5 text-caramel shrink-0" />
              <span>Mã PIN</span>
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="px-6 pt-5 space-y-2 empty:hidden">
          {errorMsg && (
            <div className="bg-red-50 text-red-700 text-xs font-semibold p-3 rounded-xl border border-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="bg-emerald-50 text-emerald-800 text-xs font-semibold p-3 rounded-xl border border-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* 1. REGISTER ADMIN FORM */}
        {activeTab === "REGISTER" ? (
          <form onSubmit={handleRegister} className="p-6 pt-4 space-y-3.5">
            <div className="text-center pb-1">
              <h2 className="text-sm font-black text-coffee-900 flex items-center justify-center gap-1.5">
                <Shield className="w-4 h-4 text-caramel" />
                <span>Đăng ký tài khoản Admin mới</span>
              </h2>
              <p className="text-[11px] text-coffee-500 mt-0.5">
                Tạo tài khoản quản trị trước, sau đó hệ thống sẽ chuyển sang bước đăng nhập.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-coffee-700 mb-1">
                  Họ và tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  placeholder="VD: Nguyễn Minh Xòi"
                  value={regFullName}
                  onChange={(e) => setRegFullName(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-coffee-700 mb-1">
                  Tên đăng nhập <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    minLength={3}
                    placeholder="VD: admin_xoi"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-coffee-700 mb-1">Vai trò quản trị</label>
              <select
                value={regRole}
                onChange={(e) => setRegRole(e.target.value as any)}
                className="w-full text-xs px-3 py-2.5 rounded-xl border border-coffee-200 bg-white focus:outline-none focus:ring-2 focus:ring-caramel/40 font-semibold text-coffee-900"
              >
                <option value="SUPER_ADMIN">Chủ quán (SUPER_ADMIN)</option>
                <option value="STORE_MANAGER">Quản lý cửa hàng (STORE_MANAGER)</option>
                <option value="BARISTA">Nhân viên pha chế (BARISTA)</option>
                <option value="CASHIER">Thu ngân (CASHIER)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-coffee-700 mb-1">Số điện thoại</label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    placeholder="VD: 0905249733"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-coffee-700 mb-1">Email (khôi phục MK)</label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    placeholder="VD: admin@gmail.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-coffee-700 mb-1">
                Mật khẩu (tối thiểu 8 ký tự) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showRegPassword ? "text" : "password"}
                  required
                  minLength={8}
                  placeholder="Nhập mật khẩu..."
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full text-xs pl-9 pr-9 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                />
                <button
                  type="button"
                  onClick={() => setShowRegPassword((prev) => !prev)}
                  aria-label={showRegPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors"
                >
                  {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-coffee-700 mb-1">
                Xác nhận mật khẩu <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showRegConfirmPassword ? "text" : "password"}
                  required
                  minLength={8}
                  placeholder="Nhập lại mật khẩu..."
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  className="w-full text-xs pl-9 pr-9 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                />
                <button
                  type="button"
                  onClick={() => setShowRegConfirmPassword((prev) => !prev)}
                  aria-label={showRegConfirmPassword ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors"
                >
                  {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-pink-600 via-rose-500 to-pink-600 hover:brightness-105 text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4" />
              <span>{isLoading ? "Đang tạo tài khoản..." : "Đăng Ký & Chuyển Sang Đăng Nhập"}</span>
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => switchMode("CREDENTIALS")}
                className="text-[11px] font-bold text-coffee-600 hover:text-caramel transition-colors"
              >
                Đã có tài khoản? <span className="underline">Đăng nhập ngay</span>
              </button>
            </div>
          </form>
        ) : activeTab === "FORGOT" ? (
          /* 2. FORGOT PASSWORD FORM */
          <div className="p-6 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => switchMode("CREDENTIALS")}
                className="inline-flex items-center gap-1 text-xs font-bold text-coffee-600 hover:text-coffee-900 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Quay lại Đăng nhập</span>
              </button>
              <span className="text-[11px] font-bold text-caramel bg-pink-50 px-2.5 py-0.5 rounded-full border border-pink-200">
                Bước {forgotStep === "REQUEST" ? "1/2" : "2/2"}
              </span>
            </div>

            <div className="text-center">
              <h2 className="text-sm font-black text-coffee-900 flex items-center justify-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-caramel" />
                <span>Khôi phục mật khẩu Admin</span>
              </h2>
              <p className="text-[11px] text-coffee-500 mt-0.5">
                {forgotStep === "REQUEST"
                  ? "Nhập tên đăng nhập để nhận mã OTP 6 số đặt lại mật khẩu."
                  : "Nhập mã OTP 6 số và thiết lập mật khẩu mới cho tài khoản."}
              </p>
            </div>

            {devOtpHint && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-center space-y-1">
                <p className="text-[11px] font-semibold text-amber-800">
                  Mã OTP nội bộ (chế độ local chưa bật Gmail SMTP):
                </p>
                <p className="font-mono text-xl font-black tracking-[0.35em] text-coffee-950">
                  {devOtpHint}
                </p>
              </div>
            )}

            {forgotStep === "REQUEST" ? (
              <form onSubmit={handleForgotRequestOtp} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-coffee-700 mb-1">
                    Tên đăng nhập cần khôi phục
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      placeholder="VD: admin hoặc manager"
                      value={forgotUsername}
                      onChange={(e) => setForgotUsername(e.target.value)}
                      className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-coffee-800 hover:bg-coffee-900 text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
                >
                  <span>{isLoading ? "Đang tạo mã OTP..." : "Gửi mã OTP khôi phục"}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleForgotResetPassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-coffee-700 mb-1">
                    Mã OTP 6 số
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="Nhập 6 chữ số OTP"
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value.replace(/[^\d]/g, ""))}
                    className="w-full text-center font-mono text-lg tracking-[0.35em] py-2 px-3 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-coffee-700 mb-1">
                    Mật khẩu mới (tối thiểu 8 ký tự)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showForgotNewPassword ? "text" : "password"}
                      required
                      minLength={8}
                      placeholder="Nhập mật khẩu mới..."
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      className="w-full text-xs pl-9 pr-9 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotNewPassword((prev) => !prev)}
                      aria-label={showForgotNewPassword ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors"
                    >
                      {showForgotNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-coffee-700 mb-1">
                    Xác nhận mật khẩu mới
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showForgotConfirmPassword ? "text" : "password"}
                      required
                      minLength={8}
                      placeholder="Nhập lại mật khẩu mới..."
                      value={forgotConfirmPassword}
                      onChange={(e) => setForgotConfirmPassword(e.target.value)}
                      className="w-full text-xs pl-9 pr-9 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotConfirmPassword((prev) => !prev)}
                      aria-label={
                        showForgotConfirmPassword ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors"
                    >
                      {showForgotConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-pink-600 via-rose-500 to-pink-600 hover:brightness-105 text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
                >
                  <span>{isLoading ? "Đang cập nhật..." : "Xác nhận đặt lại mật khẩu"}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        ) : (
          /* 3. LOGIN FORM (CREDENTIALS OR PIN) */
          <form onSubmit={handleLogin} className="p-6 pt-4 space-y-4">
            {activeTab === "CREDENTIALS" ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-coffee-700 mb-1">
                    Tên đăng nhập
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      placeholder="VD: admin hoặc manager"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-coffee-700">Mật khẩu</label>
                    <button
                      type="button"
                      onClick={() => switchMode("FORGOT")}
                      className="text-[11px] font-bold text-caramel hover:text-caramel-dark hover:underline transition-colors"
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-coffee-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full text-xs pl-9 pr-9 py-2.5 rounded-xl border border-coffee-200 focus:outline-none focus:ring-2 focus:ring-caramel/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <label className="block text-xs font-bold text-coffee-700">
                  Nhập mã PIN (4–6 số):
                </label>
                <div className="relative w-52 mx-auto">
                  <input
                    type={showPin ? "text" : "password"}
                    maxLength={6}
                    required
                    placeholder="••••••"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full text-center font-mono text-2xl tracking-[0.4em] py-2 pl-3 pr-10 rounded-xl border-2 border-caramel/50 focus:outline-none focus:border-caramel bg-amber-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((prev) => !prev)}
                    aria-label={showPin ? "Ẩn mã PIN" : "Hiện mã PIN"}
                    title={showPin ? "Ẩn mã PIN" : "Hiện mã PIN"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors"
                  >
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-coffee-500">
                  Dùng để mở khóa nhanh Tablet quầy bar trong 1 giây mà không cần gõ mật khẩu.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-coffee-800 hover:bg-coffee-900 text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
            >
              <span>{isLoading ? "Đang xác thực..." : "Đăng Nhập"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {activeTab === "CREDENTIALS" && (
              <div className="pt-1 flex items-center justify-between gap-2 text-[11px] border-t border-coffee-100">
                <button
                  type="button"
                  onClick={() => switchMode("REGISTER")}
                  className="font-bold text-caramel hover:text-caramel-dark hover:underline inline-flex items-center gap-1 pt-2"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Đăng ký tài khoản Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("FORGOT")}
                  className="font-semibold text-coffee-500 hover:text-coffee-800 hover:underline pt-2"
                >
                  Quên mật khẩu?
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="p-8 text-center text-xs text-coffee-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-caramel" />
            <span>Đang tải form đăng nhập...</span>
          </div>
        }
      >
        <LoginFormContent />
      </Suspense>
    </div>
  );
}
