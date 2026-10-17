// Project-owned test token; never use on mainnet or represent as Tether USDT.
export const DEVNET_MOCK_USDT_MINT =
  "9o25cywLXMQ2gFM7EynHQer3C7qExxqWw4FJ32Hg2gQa";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export function assertEnabledAssets(
  tokens: { asset: string }[],
  enabled = "USDT,USDC",
) {
  const expected = enabled.split(",");
  if (
    tokens.length !== expected.length ||
    expected.some((asset) => !tokens.some((token) => token.asset === asset))
  )
    throw new Error("Enabled token configurations do not match");
}
