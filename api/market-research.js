export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST to request market research." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI research is not configured yet. Add GROQ_API_KEY to the Probon Vercel project environment variables, then redeploy."
    });
  }

  const body = req.body || {};
  const asset = typeof body.asset === "string" ? body.asset.trim().slice(0, 180) : "";
  const snapshot = typeof body.snapshot === "string" ? body.snapshot.trim().slice(0, 8000) : "";
  if (!asset || !snapshot) {
    return res.status(400).json({ error: "Provide an Arc token or pair and a market snapshot." });
  }

  const prompt = [
    "You are Probon's Arc Mainnet market research assistant.",
    "Analyze only the Arc Mainnet token/pair named by the user. Do not claim you fetched live data.",
    "All figures are user-supplied and may be stale or inaccurate. Explicitly distinguish reported facts from interpretations.",
    "Do not invent price history, on-chain facts, liquidity, volume, contract safety, or news.",
    "Give a concise, useful report with these headings: Market read; Signals worth watching; Potential opportunity (conditional, not a recommendation); Key risks; What to verify next.",
    "If the supplied snapshot lacks important information, state what is missing instead of guessing.",
    "Do not guarantee returns or present the analysis as financial advice."
  ].join("\n");

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Arc Mainnet asset/pair: " + asset + "\n\nMarket snapshot supplied by user:\n" + snapshot }
        ]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: "The AI provider could not complete the research request. Try again later." });
    }
    const analysis = data?.choices?.[0]?.message?.content;
    if (typeof analysis !== "string" || !analysis.trim()) {
      return res.status(502).json({ error: "The AI provider returned an empty analysis. Try again." });
    }
    return res.status(200).json({ analysis: analysis.trim() });
  } catch {
    return res.status(502).json({ error: "Could not reach the AI research provider. Try again later." });
  }
}
