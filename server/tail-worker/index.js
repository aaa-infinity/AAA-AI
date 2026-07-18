// aaa-ai-bot-tail: receives tail events from aaa-ai-bot.
// Requires Workers Paid plan to connect (tail_consumers in wrangler.toml).
export default {
  async tail(events, env) {
    for (const e of events) {
      if (e.outcome === "exception" || e.outcome === "canceled") {
        console.error("TAIL", e.outcome, JSON.stringify(e.logs?.slice(-5)));
      }
    }
  }
};
