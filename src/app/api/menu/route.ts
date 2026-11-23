import { NextResponse } from "next/server";
import {
  getProductsFromMySql,
  getCategoriesFromMySql,
  getProductOptionsFromMySql,
  getBusinessSettingsFromMySql,
} from "@/lib/mysql";

export const dynamic = "force-dynamic";

export async function GET() {
  const [products, categories, options, settings] = await Promise.all([
    getProductsFromMySql(),
    getCategoriesFromMySql(),
    getProductOptionsFromMySql(),
    getBusinessSettingsFromMySql(),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        categories,
        products,
        options,
        settings,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}
