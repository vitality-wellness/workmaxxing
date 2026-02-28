import { Command } from "commander";
import { readFileSync } from "node:fs";
import { parsePlan } from "../integrations/plan-parser.js";
import {
  planToTicketSpecs,
  formatTicketPreview,
  createTicketsInLinear,
} from "../integrations/ticket-creator.js";
import { getLinearClient } from "../integrations/linear-client.js";
import { getDb } from "../store/db.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { GateRepo } from "../store/gate-repo.js";
import { AuditRepo } from "../store/audit-repo.js";

export const ticketsCommand = new Command("tickets").description(
  "Create and manage Linear tickets from plans"
);

ticketsCommand
  .command("create-from-plan")
  .description("Decompose an implementation plan into Linear tickets")
  .argument("<plan-file>", "Path to the markdown plan file")
  .requiredOption("--team <id>", "Linear team ID")
  .option("--project <id>", "Linear project ID")
  .option("--milestone <id>", "Linear milestone ID")
  .option("--cycle <id>", "Linear cycle ID")
  .option("--dry-run", "Preview tickets without creating them")
  .option("--json", "Output as JSON")
  .option("--repo <path>", "Repository path", process.cwd())
  .action(
    async (
      planFile: string,
      opts: {
        team: string;
        project?: string;
        milestone?: string;
        cycle?: string;
        dryRun?: boolean;
        json?: boolean;
        repo: string;
      }
    ) => {
      // Read and parse plan
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

      // Dry run: just show the preview
      if (opts.dryRun) {
        if (opts.json) {
          console.log(
            JSON.stringify({
              dryRun: true,
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
        return;
      }

      // Create tickets in Linear
      const client = getLinearClient();
      try {
        const created = await createTicketsInLinear(client, specs, {
          teamId: opts.team,
          projectId: opts.project,
          milestoneId: opts.milestone,
          cycleId: opts.cycle,
        });

        // Record gate if workflow is active
        const db = getDb();
        const workflows = new WorkflowRepo(db);
        const gates = new GateRepo(db);
        const audit = new AuditRepo(db);

        const workflow = workflows.findActiveForRepo(opts.repo);
        if (workflow) {
          gates.record({
            workflowId: workflow.id,
            gateName: "tickets_created",
            evidence: {
              ticketIds: created.map((t) => t.identifier),
              count: created.length,
            },
          });

          audit.log({
            workflowId: workflow.id,
            eventType: "tickets_created_from_plan",
            details: {
              planFile,
              planTitle: plan.title,
              tickets: created.map((t) => ({
                identifier: t.identifier,
                title: t.title,
              })),
            },
          });
        }

        if (opts.json) {
          console.log(JSON.stringify({ created }));
        } else {
          console.log(
            `Created ${created.length} ticket(s) from "${plan.title}":\n`
          );
          for (const ticket of created) {
            console.log(`  ${ticket.identifier}: ${ticket.title}`);
            console.log(`  ${ticket.url}`);
            for (const sub of ticket.subTickets) {
              console.log(`    └─ ${sub.identifier}: ${sub.title}`);
            }
            console.log();
          }
        }

        db.close();
      } catch (err) {
        console.error(
          `Error creating tickets: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(2);
      }
    }
  );

ticketsCommand
  .command("preview")
  .description("Preview what tickets would be created from a plan (alias for --dry-run)")
  .argument("<plan-file>", "Path to the markdown plan file")
  .option("--json", "Output as JSON")
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
