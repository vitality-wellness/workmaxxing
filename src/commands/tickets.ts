import { Command } from "commander";
import { readFileSync } from "node:fs";
import { parsePlan } from "../integrations/plan-parser.js";
import {
  planToTicketSpecs,
  formatTicketPreview,
} from "../integrations/ticket-creator.js";
import { validateTicket, type TicketInput } from "../engine/ticket-validator.js";

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
