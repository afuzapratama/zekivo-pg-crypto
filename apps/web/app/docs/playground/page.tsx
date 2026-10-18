import Playground from "./playground";
import DevnetPlayground from "./devnet-playground";
export default function Page() {
  if (
    process.env.APP_ENV === "staging" &&
    process.env.SOLANA_CLUSTER === "devnet"
  ) {
    const apiUrl = process.env.API_PUBLIC_URL;
    if (!apiUrl || new URL(apiUrl).protocol !== "https:")
      return <p>Konfigurasi URL API staging belum tersedia.</p>;
    return <DevnetPlayground apiUrl={new URL(apiUrl).origin} />;
  }
  return <Playground />;
}
