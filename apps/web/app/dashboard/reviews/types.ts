export const reviewLabels: Record<string, string> = {
  open: "Belum ditangani",
  in_progress: "Sedang ditinjau",
  closed: "Review ditutup",
};
export const reasonLabels: Record<string, string> = {
  unmatched: "Belum cocok invoice",
  partial: "Kurang bayar",
  overpaid: "Lebih bayar",
  late: "Pembayaran terlambat",
  duplicate_payment: "Pembayaran ganda",
  ambiguous_reference: "Referensi ambigu",
  reference_conflict: "Konflik referensi",
  inactive_attempt: "Pilihan aset belum aktif",
  predates_invoice: "Transfer sebelum invoice",
};
export type ReviewTransfer = {
  id: string;
  signature: string;
  instruction_path: string;
  slot: string;
  block_time: string;
  mint: string;
  destination: string;
  amount: string;
  asset: string | null;
  disposition: string;
  invoice_id: string | null;
  project_id: string | null;
  project_name: string | null;
  order_id: string | null;
  review_status: string;
  review_version: number;
  updated_at: string | null;
};
export type ReviewDetail = {
  transfer: ReviewTransfer;
  notes: {
    id: string;
    tenant_id: string;
    object_id: string;
    from_status: string;
    to_status: string;
    version: number;
    reason: string;
    created_at: string;
  }[];
  next_note_cursor: string | null;
};
