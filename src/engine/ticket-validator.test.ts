import { describe, it, expect } from "vitest";
import { validateTicket } from "./ticket-validator.js";

describe("validateTicket", () => {
  const validTicket = {
    title: "Add OAuth2 support",
    description:
      "## Goal\n\nImplement OAuth2 for Google and Apple providers.\n\n## Acceptance Criteria\n\n- [ ] POST /auth/oauth returns JWT\n- [ ] Invalid codes return 401",
    assignee: "me",
    cycle: "current",
    project: "MVP Launch",
    labels: ["Feature"],
    estimate: 3,
  };

  it("passes valid full ticket", () => {
    const result = validateTicket(validTicket);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails on missing assignee", () => {
    const result = validateTicket({ ...validTicket, assignee: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("assignee"))).toBe(true);
  });

  it("fails on missing cycle", () => {
    const result = validateTicket({ ...validTicket, cycle: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("fails on missing project for full ticket", () => {
    const result = validateTicket({ ...validTicket, project: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("project"))).toBe(true);
  });

  it("allows missing project for sub-ticket", () => {
    const result = validateTicket({
      ...validTicket,
      project: undefined,
      parentId: "parent-123",
      description: "Sub-task detail",
    });
    expect(result.errors.some((e) => e.includes("project"))).toBe(false);
  });

  it("fails on empty labels", () => {
    const result = validateTicket({ ...validTicket, labels: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("label"))).toBe(true);
  });

  it("fails on zero estimate", () => {
    const result = validateTicket({ ...validTicket, estimate: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("estimate"))).toBe(true);
  });

  it("fails on short description", () => {
    const result = validateTicket({ ...validTicket, description: "Too short" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Too short"))).toBe(true);
  });

  it("fails on missing AC heading", () => {
    const result = validateTicket({
      ...validTicket,
      description:
        "## Goal\n\nSomething long enough to pass the character check and has enough content.\n\n## Details\n\nMore details here for structure.",
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Acceptance Criteria"))
    ).toBe(true);
  });

  it("relaxes description for sub-tickets", () => {
    const result = validateTicket({
      title: "Sub task",
      description: "Brief",
      assignee: "me",
      cycle: "current",
      labels: ["Feature"],
      estimate: 1,
      parentId: "parent-123",
    });
    expect(result.valid).toBe(true);
  });
});
