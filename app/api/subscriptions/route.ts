import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch(
  "https://developv4.kyc34.com/service-person/v1/persons/clients/operations/subscriptions/overview?page=0&size=5&sort=updatedDate,desc",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://developv4.kyc34.com",
      "Referer": "https://developv4.kyc34.com/subscriptionsFollowUp",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "Cookie": `_ugeuid=SOMETHING_SOMETHING; accessToken=${process.env.SOURCE_API_TOKEN?.replace("Bearer ", "")}`,
    },
    body: JSON.stringify({
      status: [],
      personTypes: ["INDIVIDUAL"],
      internal: false,
      timeZone: "Europe/Paris",
      partIds: [], // tu peux mettre quelques UUID si nécessaires
    }),
  }
);


  console.log("TOKEN USED:", process.env.SOURCE_API_TOKEN?.slice(0, 50) + "...");


  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Source API error ${res.status}`, details: text }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
