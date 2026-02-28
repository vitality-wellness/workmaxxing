#!/usr/bin/env node

import { Command } from "commander";
import { statusCommand } from "./commands/status.js";
import { startCommand } from "./commands/start.js";
import { advanceCommand } from "./commands/advance.js";
import { gateCommand } from "./commands/gate.js";
import { sessionCommand } from "./commands/session.js";
import { bypassCommand } from "./commands/bypass.js";
import { ticketsCommand } from "./commands/tickets.js";
import { auditCommand } from "./commands/audit.js";
import { repoCommand } from "./commands/repo.js";
import { installCommand } from "./commands/install.js";

const program = new Command();

program
  .name("powr-workmaxxing")
  .description(
    "Development workflow engine — state machine, gates, Linear integration"
  )
  .version("0.1.0");

// Workflow lifecycle
program.addCommand(statusCommand);
program.addCommand(startCommand);
program.addCommand(advanceCommand);
program.addCommand(bypassCommand);

// Gate management
program.addCommand(gateCommand);

// Session management
program.addCommand(sessionCommand);

// Ticket management
program.addCommand(ticketsCommand);

// Repo lifecycle
program.addCommand(repoCommand);

// Setup
program.addCommand(installCommand);

// Observability
program.addCommand(auditCommand);

program.parse();
