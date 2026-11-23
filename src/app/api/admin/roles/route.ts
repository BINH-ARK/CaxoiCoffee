import { NextResponse } from "next/server";
import {
  getRolesAndPermissionsFromMySql,
  toggleRolePermissionInMySql,
  updateStaffInMySql,
  createStaffInMySql,
  deleteStaffInMySql,
  recordAuditLogInMySql,
} from "@/lib/mysql";
import { getTrustedClientIp, requireStaffAuth } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffAuth(request, {
    roles: ["SUPER_ADMIN"],
    permission: "system.manage_roles",
  });
  if (!auth.ok) return auth.response;

  const rbacData = await getRolesAndPermissionsFromMySql();
  return NextResponse.json({
    success: true,
    data: rbacData,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireStaffAuth(request, {
    roles: ["SUPER_ADMIN"],
    permission: "system.manage_roles",
  });
  if (!auth.ok) return auth.response;
  const ip = getTrustedClientIp(request);

  try {
    const body = await request.json();
    const { action } = body;

    // 1. Toggle or update permission for a role in SQLite
    if (action === "TOGGLE_ROLE_PERMISSION") {
      const { roleId, permissionCode } = body;

      const result = await toggleRolePermissionInMySql(roleId, permissionCode);
      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }

      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action: "RBAC_PERMISSION_TOGGLED",
        targetType: "ROLE",
        targetId: String(roleId),
        summary: `Thay đổi quyền [${permissionCode}] cho vai trò ${roleId}`,
        ipAddress: ip,
      });

      const rbacData = await getRolesAndPermissionsFromMySql();
      const updatedRole = rbacData.roles.find((r) => r.roleId === roleId);

      return NextResponse.json({
        success: true,
        message: result.message,
        data: updatedRole,
      });
    }

    // 2. Update staff user details (FullName, Role, PIN, Status, Phone, Email, Password) in SQLite
    if (action === "UPDATE_STAFF") {
      const { staffId, fullName, role, pin, isActive, phone, email, password } = body;
      if (!staffId || typeof staffId !== "string") {
        return NextResponse.json(
          { success: false, message: "Thiếu mã tài khoản nhân viên." },
          { status: 400 }
        );
      }

      const result = await updateStaffInMySql(
        staffId,
        { fullName, role, pin, isActive, phone, email, password },
        auth.staff.id
      );
      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message || "Lỗi cập nhật nhân viên trong MySQL" },
          { status: 400 }
        );
      }

      const rbacData = await getRolesAndPermissionsFromMySql();
      const updatedStaff = rbacData.staff.find((s) => s.id === staffId);

      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action: "STAFF_UPDATED",
        targetType: "STAFF",
        targetId: staffId,
        summary: `Cập nhật nhân viên @${updatedStaff?.username || staffId}${role ? ` (vai trò: ${role})` : ""}${password ? " [đổi mật khẩu]" : ""}${pin ? " [đổi PIN KDS]" : ""}`,
        ipAddress: ip,
      });

      return NextResponse.json({
        success: true,
        message: result.message || "Đã cập nhật thông tin nhân viên thành công!",
        data: updatedStaff,
      });
    }

    // 3. Delete staff member from SQLite
    if (action === "DELETE_STAFF") {
      const { staffId } = body;
      if (!staffId || typeof staffId !== "string") {
        return NextResponse.json(
          { success: false, message: "Thiếu mã tài khoản nhân viên." },
          { status: 400 }
        );
      }

      const result = await deleteStaffInMySql(staffId, auth.staff.id);
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 400 });
      }

      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action: "STAFF_DELETED",
        targetType: "STAFF",
        targetId: staffId,
        summary: result.message,
        ipAddress: ip,
      });

      return NextResponse.json({
        success: true,
        message: result.message,
      });
    }

    // 4. Create new staff member in SQLite
    if (action === "CREATE_STAFF") {
      const { username, fullName, role, phone, email, pin, password } = body;

      if (!username || !fullName || !role) {
        return NextResponse.json(
          { success: false, message: "Vui lòng điền đầy đủ tên đăng nhập, họ tên và vai trò." },
          { status: 400 }
        );
      }

      const cleanUsername = String(username).trim();
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(cleanUsername)) {
        return NextResponse.json(
          {
            success: false,
            message: "Tên đăng nhập chỉ gồm chữ, số, dấu chấm/gạch (3–32 ký tự).",
          },
          { status: 400 }
        );
      }

      const rbacData = await getRolesAndPermissionsFromMySql();
      if (rbacData.staff.some((s) => s.username.toLowerCase() === cleanUsername.toLowerCase())) {
        return NextResponse.json(
          { success: false, message: "Tên đăng nhập này đã tồn tại trong CSDL MySQL." },
          { status: 400 }
        );
      }

      const result = await createStaffInMySql({
        username: cleanUsername,
        fullName: String(fullName).trim(),
        role,
        phone,
        email,
        pin,
        password,
      });

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message || "Lỗi tạo tài khoản nhân viên trong MySQL" },
          { status: 400 }
        );
      }

      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action: "STAFF_CREATED",
        targetType: "STAFF",
        targetId: cleanUsername.toLowerCase(),
        summary: `Tạo tài khoản nhân viên @${cleanUsername.toLowerCase()} (vai trò: ${role})`,
        ipAddress: ip,
      });

      const updatedRbac = await getRolesAndPermissionsFromMySql();
      const newStaff = updatedRbac.staff.find(
        (s) => s.username.toLowerCase() === cleanUsername.toLowerCase()
      );

      return NextResponse.json({
        success: true,
        message: result.message || `Đã tạo tài khoản nhân viên "${fullName}" vào MySQL thành công!`,
        data: newStaff,
      });
    }

    return NextResponse.json({ success: false, message: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "Lỗi cập nhật phân quyền" },
      { status: 500 }
    );
  }
}
