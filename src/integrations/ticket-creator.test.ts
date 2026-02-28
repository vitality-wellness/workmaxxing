import { describe, it, expect } from "vitest";
import { parsePlan } from "./plan-parser.js";
import { planToTicketSpecs, formatTicketPreview } from "./ticket-creator.js";

const SAMPLE_PLAN = `# Add OAuth2 Authentication

## 1. Set up OAuth2 provider configuration

Configure Google and Apple OAuth providers in the backend.

  - Add OAuth config to \`cmd/server/config.go\`
  - Create provider registry in \`internal/auth/providers.go\`
  - Add environment variables for client IDs/secrets

## 2. Implement token exchange endpoint

After step 1, create the API endpoint that exchanges auth codes for tokens.

  - Create handler in \`internal/handlers/oauth.go\`
  - Add token validation logic

- [ ] POST /auth/oauth/exchange returns JWT
- [ ] Invalid auth codes return 401

## 3. Add Flutter login screen

Implement the login UI.

  - Create \`lib/screens/auth/oauth_login_screen.dart\`
  - Add Google Sign-In button
  - Add Apple Sign-In button
  - Handle deep link callback

- [ ] Login screen matches design spec
- [ ] Error states shown for failed auth
`;

describe("planToTicketSpecs", () => {
  const plan = parsePlan(SAMPLE_PLAN);
  const specs = planToTicketSpecs(plan);

  it("creates one spec per plan step", () => {
    expect(specs).toHaveLength(3);
  });

  it("sets titles from plan steps", () => {
    expect(specs[0]?.title).toBe("Set up OAuth2 provider configuration");
    expect(specs[1]?.title).toBe("Implement token exchange endpoint");
  });

  it("extracts sub-tickets from substeps", () => {
    expect(specs[0]?.subTickets.length).toBe(3);
    expect(specs[0]?.subTickets[0]?.title).toContain("OAuth config");
  });

  it("maps dependencies to step numbers", () => {
    expect(specs[1]?.dependsOnSteps).toContain(1);
    expect(specs[0]?.dependsOnSteps).toEqual([]);
  });

  it("infers labels from repo", () => {
    // Step 1 mentions .go → Backend
    expect(specs[0]?.labels).toContain("Backend");
    // Step 3 mentions .dart → Frontend
    expect(specs[2]?.labels).toContain("Frontend");
  });

  it("sets higher priority for steps with no deps", () => {
    expect(specs[0]?.priority).toBe(2); // High (no deps)
    expect(specs[1]?.priority).toBe(3); // Normal (has deps)
  });

  it("maps effort to point estimates", () => {
    // Step 3 has 4 substeps → large → 5 points
    expect(specs[2]?.estimate).toBe(5);
  });

  it("includes acceptance criteria in description", () => {
    expect(specs[1]?.description).toContain("POST /auth/oauth/exchange");
    expect(specs[1]?.description).toContain("Acceptance Criteria");
  });
});

describe("formatTicketPreview", () => {
  it("produces readable output", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    const specs = planToTicketSpecs(plan);
    const preview = formatTicketPreview(specs);

    expect(preview).toContain("3 ticket(s)");
    expect(preview).toContain("Set up OAuth2");
    expect(preview).toContain("Blocked by");
  });
});
