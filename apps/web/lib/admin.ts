import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export class AdminApiError extends Error {
  constructor(public status: number) {
    super("Admin API unavailable");
  }
}
export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(
    new URL(
      `/admin/${path}`,
      process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
    ),
    {
      headers: { cookie: (await cookies()).toString() },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  ).catch(() => {
    throw new AdminApiError(503);
  });
  if (response.status === 401 || response.status === 403) redirect("/login");
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json();
}
export type AdminSession = {
  reauthentication_required?: boolean;
  role: string;
  csrf_token: string;
  permissions: string[];
};
export type Project = { id: string; name: string };
export type InvoiceSummary = {
  project_name?: string;
  project_id?: string;
  id: string;
  order_id: string;
  asset: string;
  status: string;
  amount: string;
  payable_amount: string;
  created_at: string;
  expires_at: string;
  invoice_version: number;
  cluster: string;
};
export type InvoicePage = {
  items: InvoiceSummary[];
  next_cursor: string | null;
};
export type Overview = {
  environment: string;
  cluster: string;
  counts: Record<string, string>;
  gross_received: { asset: string; amount: string }[];
  as_of: string;
};
export type InvoiceDetail = {
  invoice: InvoiceSummary & {
    project_name: string;
    project_id: string;
    mint: string;
    recipient: string;
  };
  transfers: {
    id?: string;
    asset: string | null;
    signature: string;
    instruction_path: string;
    slot: string;
    block_time: string;
    mint: string;
    amount: string;
    disposition: string;
  }[];
  events: { event_id: string; event_type: string; created_at: string }[];
  attempts: {
    id: string;
    asset: string;
    mint: string;
    recipient: string;
    payable_amount: string;
    activated_at: string | null;
    payment_enabled: boolean;
  }[];
  deliveries: {
    id: string;
    event_id: string;
    status: string;
    attempt_count: number;
    last_http_status: number | null;
    delivered_at: string | null;
  }[];
  has_more: { transfers: boolean; events: boolean; deliveries: boolean };
  next_cursors?: {
    transfers: string | null;
    events: string | null;
    deliveries: string | null;
  };
};
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
export const tokenLabel = (asset: string, cluster: string) =>
  cluster === "devnet" && asset === "USDT" ? "Mock USDT" : asset;
export function explorerSignature(signature: string, cluster: string) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster === "devnet" ? "?cluster=devnet" : cluster === "localnet" ? "?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899" : ""}`;
}

export type Operations = {
  cluster: string;
  environment: string;
  as_of: string;
  finalized_head: string;
  rpc: string;
  monitoring: boolean;
  wallets: {
    asset: string;
    mint: string;
    recipient: string;
    token_account: string;
    balance: string;
    checkpoint_slot: string | null;
    checkpoint_updated_at: string | null;
    state: string;
    lag_slots: string | null;
    age_seconds: number | null;
  }[];
};
