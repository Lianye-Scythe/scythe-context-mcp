// Account-level failures are distinct from retrieval/answer failures.
export function isQuotaBlocked(events) {
  return !events.some((event) => event.type === "turn.completed") && events.some((event) => {
    const message = event.type === "error" ? event.message : event.type === "turn.failed" ? event.error?.message : undefined;
    return typeof message === "string" && /hit your usage limit|usage_limit_reached|insufficient_quota/i.test(message);
  });
}

export function mayResumeQuotaRun(run, events) {
  return !run.checks.completed && run.commandCalls === 0 && run.usage === null && isQuotaBlocked(events);
}

export function lookupOperational(commands, trace, group) {
  // An rg exclude such as --glob '!.scythe-context/**' is not a CLI invocation.
  const invoked = commands.some((item) => /scythe-context["']?\s+(?:context|search|status|doctor|related|index)\b/.test(item.command ?? ""));
  return (!invoked || trace.length > 0) && trace.every((call) => call.exitCode === 0 && call.outputChars > 0 &&
    (!["context", "search"].includes(call.args[0]) || call.effectiveMode === group));
}
