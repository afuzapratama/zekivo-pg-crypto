import type { Metadata } from "next";
import Checkout from "./checkout";
export const metadata: Metadata = {
  title: "Bayar · Zekivo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Pay({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Checkout key={token} token={token} />;
}
