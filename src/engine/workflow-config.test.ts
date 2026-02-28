import { describe, it, expect } from "vitest";
import {
  getWorkflowConfig,
  getFeatureStageNames,
  getTicketStageNames,
} from "./workflow-config.js";

describe("workflow config", () => {
  it("returns feature stages", () => {
    const names = getFeatureStageNames();
    expect(names).toContain("SPECCING");
    expect(names).toContain("PLANNING");
    expect(names).toContain("REVIEWING");
    expect(names).toContain("TICKETING");
    expect(names).toContain("EXECUTING");
    expect(names).toContain("SHIPPING");
    expect(names).toContain("IDLE");
  });

  it("returns ticket stages", () => {
    const names = getTicketStageNames();
    expect(names).toContain("QUEUED");
    expect(names).toContain("INVESTIGATING");
    expect(names).toContain("IMPLEMENTING");
    expect(names).toContain("CODE_REVIEWING");
    expect(names).toContain("CROSS_REFING");
    expect(names).toContain("FIXING");
    expect(names).toContain("VERIFYING_ACS");
    expect(names).toContain("DONE");
  });

  it("every stage has a description", () => {
    const config = getWorkflowConfig();
    for (const [name, stage] of Object.entries(config.stages)) {
      expect(stage.description, `${name} missing description`).toBeTruthy();
    }
    for (const [name, stage] of Object.entries(config.ticketStages)) {
      expect(stage.description, `${name} missing description`).toBeTruthy();
    }
  });

  it("every non-terminal stage has a nextStage that exists", () => {
    const config = getWorkflowConfig();
    for (const [name, stage] of Object.entries(config.stages)) {
      if (stage.nextStage !== null) {
        expect(
          config.stages[stage.nextStage],
          `${name}.nextStage "${stage.nextStage}" does not exist`
        ).toBeDefined();
      }
    }
    for (const [name, stage] of Object.entries(config.ticketStages)) {
      if (stage.nextStage !== null) {
        expect(
          config.ticketStages[stage.nextStage],
          `${name}.nextStage "${stage.nextStage}" does not exist`
        ).toBeDefined();
      }
    }
  });

  it("IDLE is terminal (no nextStage)", () => {
    const config = getWorkflowConfig();
    expect(config.stages["IDLE"]?.nextStage).toBeNull();
  });

  it("DONE is terminal for ticket stages", () => {
    const config = getWorkflowConfig();
    expect(config.ticketStages["DONE"]?.nextStage).toBeNull();
  });
});
