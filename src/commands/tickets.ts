import { Command } from "commander";
import { readFileSync } from "node:fs";
import { parsePlan } from "../integrations/plan-parser.js";
import {
  planToTicketSpecs,
  formatTicketPreview,
} from "../integrations/ticket-creator.js";
import { validateTicket, type TicketInput } from "../engine/ticket-validator.js";
import { getDb } from "../store/db.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { TicketWorkflowRepo } from "../store/ticket-workflow-repo.js";
import { GateRepo } from "../store/gate-repo.js";
import { getTicketGateNames } from "../engine/workflow-config.js";

export const ticketsCommand = new Command("tickets").description(
  "Parse plans and validate tickets"
);

ticketsCommand
  .command("preview")
  .description("Preview what tickets would be created from a plan")
  .argument("<plan-file>", "Path to the markdown plan file")
  .option("--json", "Output as structured JSON (for Claude to create via Linear MCP)")
  .action((planFile: string, opts: { json?: boolean }) => {
    let markdown: string;
    try {
      markdown = readFileSync(planFile, "utf-8");
    } catch {
      console.error(`Error: Cannot read plan file: ${planFile}`);
      process.exit(2);
    }

    const plan = parsePlan(markdown);
    const specs = planToTicketSpecs(plan);

    if (specs.length === 0) {
      console.error("Error: No steps found in plan.");
      process.exit(1);
    }

    if (opts.json) {
      console.log(
        JSON.stringify({
          planTitle: plan.title,
          ticketCount: specs.length,
          subTicketCount: specs.reduce(
            (sum, s) => sum + s.subTickets.length,
            0
          ),
          specs,
        })
      );
    } else {
      console.log(formatTicketPreview(specs));
    }
  });

ticketsCommand
  .command("validate")
  .description("Validate ticket fields before creation")
  .option("--json <input>", "Ticket input as JSON string")
  .action((opts: { json?: string }) => {
    if (!opts.json) {
      console.error("Error: --json <input> is required");
      process.exit(2);
    }

    let input: TicketInput;
    try {
      input = JSON.parse(opts.json) as TicketInput;
    } catch {
      console.error("Error: Invalid JSON input");
      process.exit(2);
    }

    const result = validateTicket(input);

    console.log(JSON.stringify(result));
    process.exit(result.valid ? 0 : 1);
  });

ticketsCommand
  .command("list")
  .description("List tracked ticket_workflows for the current workflow")
  .option("-w, --workflow <id>", "Workflow ID (defaults to POWR_WF env)")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((opts: { workflow?: string; repo: string; json?: boolean }) => {
    const db = getDb();
    const workflows = new WorkflowRepo(db);
    const ticketWorkflows = new TicketWorkflowRepo(db);
    const gates = new GateRepo(db);

    const workflowId = opts.workflow ?? process.env.POWR_WF;
    let workflow;
    if (workflowId) {
      workflow = workflows.getById(workflowId);
    } else {
      workflow = workflows.findActiveForRepo(opts.repo);
    }

    if (!workflow) {
      console.error("Error: No active workflow found.");
      process.exit(1);
    }

    const tickets = ticketWorkflows.listForWorkflow(workflow.id);
    const ticketGateNames = getTicketGateNames();

    if (opts.json) {
      const data = tickets.map((tw) => {
        const passedNames = gates.getPassedNamesForTicket(workflow.id, tw.id);
        return {
          ticketId: tw.ticketId,
          stage: tw.stage,
          gatesPassed: ticketGateNames.filter((g) => passedNames.has(g)),
          gatesMissing: ticketGateNames.filter((g) => !passedNames.has(g)),
        };
      });
      console.log(JSON.stringify({ workflowId: workflow.id, total: tickets.length, tickets: data }, null, 2));
    } else {
      console.log(`Workflow: ${workflow.featureName} (${workflow.id})`);
      console.log(`Tracked tickets: ${tickets.length}\n`);
      for (const tw of tickets) {
        const passedNames = gates.getPassedNamesForTicket(workflow.id, tw.id);
        const passed = ticketGateNames.filter((g) => passedNames.has(g)).length;
        const total = ticketGateNames.length;
        const status = tw.stage === "DONE" ? "✅" : `⏳ ${tw.stage}`;
        console.log(`  ${tw.ticketId.padEnd(12)} ${status.padEnd(25)} gates: ${passed}/${total}`);
      }
    }
  });

ticketsCommand
  .command("remove")
  .description("Remove a tracked ticket_workflow (for phantom/stale entries)")
  .argument("<ticket-id>", "Ticket ID to remove (e.g., POWR-738)")
  .option("-w, --workflow <id>", "Workflow ID (defaults to POWR_WF env)")
  .option("--repo <path>", "Repository path", process.cwd())
  .action((ticketId: string, opts: { workflow?: string; repo: string }) => {
    const db = getDb();
    const workflows = new WorkflowRepo(db);
    const ticketWorkflows = new TicketWorkflowRepo(db);

    const workflowId = opts.workflow ?? process.env.POWR_WF;
    let workflow;
    if (workflowId) {
      workflow = workflows.getById(workflowId);
    } else {
      workflow = workflows.findActiveForRepo(opts.repo);
    }

    if (!workflow) {
      console.error("Error: No active workflow found.");
      process.exit(1);
    }

    const deleted = ticketWorkflows.deleteByTicketId(workflow.id, ticketId);
    if (deleted) {
      console.log(`Removed ${ticketId} from workflow tracking.`);
    } else {
      console.error(`Error: ${ticketId} not found in workflow ${workflow.id}.`);
      process.exit(1);
    }
  });
