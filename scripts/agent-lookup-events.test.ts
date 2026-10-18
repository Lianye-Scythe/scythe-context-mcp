import { describe, expect, it } from "vitest";
import { isQuotaBlocked, mayResumeQuotaRun, lookupOperational } from "./agent-lookup-events.mjs";

describe("agent lookup quota interruption", () => {
  const blocked = [{ type: "turn.failed", error: { message: "You’ve hit your usage limit." } }];
  it("recognizes account quota rejection without treating provider/answer failures as quota", () => {
    expect(isQuotaBlocked(blocked)).toBe(true);
    expect(isQuotaBlocked([{ type: "error", message: "HTTP 429 from embedding provider" }])).toBe(false);
    expect(isQuotaBlocked([{ type: "turn.completed", usage: {} }, ...blocked])).toBe(false);
  });
  it("permits resuming only quota-blocked runs that performed no work", () => {
    const run = { checks: { completed: false }, commandCalls: 0, usage: null };
    expect(mayResumeQuotaRun(run, blocked)).toBe(true);
    expect(mayResumeQuotaRun({ ...run, commandCalls: 1 }, blocked)).toBe(false);
    expect(mayResumeQuotaRun({ ...run, usage: { input_tokens: 1 } }, blocked)).toBe(false);
    expect(mayResumeQuotaRun(run, [{ type: "error", message: "incorrect answer" }])).toBe(false);
  });
  it("distinguishes an rg exclude glob from a failed or downgraded Scythe invocation", () => {
    expect(lookupOperational([{ command: "rg file_name_ext . --glob '!.scythe-context/**'" }], [], "hybrid")).toBe(true);
    const commands = [{ command: '"/tmp/bench-bin/scythe-context" context query' }];
    expect(lookupOperational(commands, [], "hybrid")).toBe(false);
    const call = { args: ["context"], exitCode: 0, outputChars: 100, effectiveMode: "keyword" };
    expect(lookupOperational(commands, [call], "hybrid")).toBe(false);
    expect(lookupOperational(commands, [{ ...call, effectiveMode: "hybrid" }], "hybrid")).toBe(true);
  });
});
