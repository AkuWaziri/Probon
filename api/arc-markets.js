export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET to search Arc markets." });
  }

  const query = typeof req.query?.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  if (!query) return res.status(400).json({ error: "Enter a token symbol, name, or contract address." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(query), {
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: "The Arc market-data provider is temporarily unavailable." });
    }

    const payload = await upstream.json();
    const now = new Date().toISOString();
    const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
    const markets = pairs
      .filter(pair => String(pair?.chainId || "").toLowerCase() === "arc")
      .map(pair => {
        const numOrNull = value => {
          if (value === null || value === undefined || value === "") return null;
          const number = Number(value);
          return Number.isFinite(number) ? number : null;
        };
        const baseSymbol = String(pair?.baseToken?.symbol || "UNKNOWN").slice(0, 32);
        const quoteSymbol = String(pair?.quoteToken?.symbol || "UNKNOWN").slice(0, 32);
        const priceUsd = typeof pair?.priceUsd === "string" && Number.isFinite(Number(pair.priceUsd)) ? pair.priceUsd : null;
        const change24h = numOrNull(pair?.priceChange?.h24);
        const volume24h = numOrNull(pair?.volume?.h24);
        const liquidityUsd = numOrNull(pair?.liquidity?.usd);
        const fdv = numOrNull(pair?.fdv);
        const buys24h = numOrNull(pair?.txns?.h24?.buys);
        const sells24h = numOrNull(pair?.txns?.h24?.sells);
        const pairAddress = String(pair?.pairAddress || "");
        const dexId = String(pair?.dexId || "Unknown DEX").slice(0, 60);
        const url = typeof pair?.url === "string" && pair.url.startsWith("https://") ? pair.url : "https://dexscreener.com/arc/" + encodeURIComponent(pairAddress);
        const pairLabel = baseSymbol + "/" + quoteSymbol;
        const lines = [
          "Source: DexScreener public market-data API",
          "Network: Arc Mainnet (chain ID 5042; chain ID label from provider: arc)",
          "Observed at (UTC): " + now,
          "Pair: " + pairLabel,
          "DEX: " + dexId,
          "Pair contract: " + pairAddress,
          "Token contract: " + String(pair?.baseToken?.address || "unavailable"),
          "Quote token contract: " + String(pair?.quoteToken?.address || "unavailable"),
          "Price USD: " + (priceUsd ?? "unavailable"),
          "24h price change (%): " + (change24h ?? "unavailable"),
          "24h volume USD: " + (volume24h ?? "unavailable"),
          "Liquidity USD: " + (liquidityUsd ?? "unavailable"),
          "FDV USD: " + (fdv ?? "unavailable"),
          "24h buys: " + (buys24h ?? "unavailable"),
          "24h sells: " + (sells24h ?? "unavailable"),
          "Market URL: " + url
        ];
        return { pairAddress, pairLabel, baseSymbol, quoteSymbol, priceUsd, change24h, volume24h, liquidityUsd, fdv, buys24h, sells24h, dexId, url, snapshot: lines.join("\n"), _volume: volume24h ?? -1 };
      })
      .filter(market => market.pairAddress)
      .sort((a, b) => b._volume - a._volume)
      .slice(0, 8)
      .map(({ _volume, ...market }) => market);

    return res.status(200).json({ network: "Arc Mainnet", chainId: 5042, source: "DexScreener", updatedAt: now, markets });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return res.status(502).json({ error: aborted ? "Arc market-data request timed out. Try again." : "Could not retrieve live Arc market data right now." });
  } finally {
    clearTimeout(timeout);
  }
}
