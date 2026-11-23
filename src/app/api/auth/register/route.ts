import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: "Tính năng đăng ký tài khoản đã bị vô hiệu hóa.",
    },
    { status: 403 }
  );
}
