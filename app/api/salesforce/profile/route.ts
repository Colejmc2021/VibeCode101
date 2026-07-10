import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SalesforceContactRecord = {
  Name?: string;
  Account?: {
    Name?: string;
  };
};

type SalesforceQueryResponse = {
  records?: SalesforceContactRecord[];
};

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("sf_access_token")?.value ?? process.env.SALESFORCE_ACCESS_TOKEN;
  const rawInstanceUrl = cookieStore.get("sf_instance_url")?.value ?? process.env.SALESFORCE_INSTANCE_URL;
  const instanceUrl = rawInstanceUrl?.replace(".lightning.force.com", ".my.salesforce.com");
  const apiVersion = process.env.SALESFORCE_API_VERSION ?? "v64.0";
  const contactId = process.env.SALESFORCE_CONTACT_ID;

  if (!accessToken || !instanceUrl) {
    return NextResponse.json(
      {
        connected: false,
        error: "No Salesforce session found. Sign in with Salesforce first.",
      },
      { status: 401 },
    );
  }

  const soql = contactId
    ? `SELECT Name, Account.Name FROM Contact WHERE Id = '${contactId}' LIMIT 1`
    : "SELECT Name, Account.Name FROM Contact WHERE Name != null ORDER BY LastModifiedDate DESC LIMIT 1";
  const queryUrl = new URL(`/services/data/${apiVersion}/query`, instanceUrl);
  queryUrl.searchParams.set("q", soql);

  const response = await fetch(queryUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        connected: false,
        error: "Salesforce query failed. Re-authenticate to refresh session.",
      },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as SalesforceQueryResponse;
  const record = payload.records?.[0];

  return NextResponse.json({
    connected: true,
    profile: {
      name: record?.Name ?? "Unknown Contact",
      company: record?.Account?.Name ?? "No Account",
      tier: "Live",
    },
  });
}
