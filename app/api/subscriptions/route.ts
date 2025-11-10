import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Route fonctionne ✅ (mock depuis Vercel)",
    items: [
      {
        subscriptionId: "demo-uuid",
        status: "TO_BE_SENT",
        createdDate: new Date().toISOString(),
        productName: "Léa fonds performant",
      },
    ],
  });
}
