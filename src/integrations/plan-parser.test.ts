import { describe, it, expect } from "vitest";
import { parsePlan } from "./plan-parser.js";

const SAMPLE_PLAN = `# Add OAuth2 Authentication

## 1. Set up OAuth2 provider configuration

Configure Google and Apple OAuth providers in the backend.

  - Add OAuth config to \`cmd/server/config.go\`
  - Create provider registry in \`internal/auth/providers.go\`
  - Add environment variables for client IDs/secrets

## 2. Implement token exchange endpoint

After step 1, create the API endpoint that exchanges auth codes for tokens.

  - Create \`internal/handlers/oauth.go\` handler
  - Add token validation and refresh logic
  - Wire into \`cmd/server/routes.go\`

### Acceptance Criteria
- [ ] POST /auth/oauth/exchange returns JWT
- [ ] Invalid auth codes return 401
- [ ] Refresh tokens are stored securely

## 3. Add Flutter login screen

Implement the login UI in the Flutter app.

  - Create \`lib/screens/auth/oauth_login_screen.dart\`
  - Add Google Sign-In button
  - Add Apple Sign-In button (iOS only)
  - Handle deep link callback
  - [ ] Login screen matches design spec
  - [ ] Error states shown for failed auth
`;

describe("plan parser", () => {
  it("extracts plan title", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.title).toBe("Add OAuth2 Authentication");
  });

  it("extracts 3 steps", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.steps).toHaveLength(3);
  });

  it("extracts step titles and numbers", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.steps[0]?.number).toBe(1);
    expect(plan.steps[0]?.title).toBe(
      "Set up OAuth2 provider configuration"
    );
    expect(plan.steps[1]?.number).toBe(2);
    expect(plan.steps[2]?.number).toBe(3);
  });

  it("extracts substeps", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.steps[0]?.substeps.length).toBe(3);
    expect(plan.steps[0]?.substeps[0]?.title).toContain("OAuth config");
  });

  it("extracts dependencies", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.steps[1]?.dependencies).toContain(1);
  });

  it("infers repo from file paths", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    // Step 1 mentions .go files → api
    expect(plan.steps[0]?.repo).toBe("api");
    // Step 3 mentions lib/ and .dart → frontend
    expect(plan.steps[2]?.repo).toBe("frontend");
  });

  it("extracts acceptance criteria", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    // Step 2 has ACs under a heading
    expect(plan.steps[1]?.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
    // Step 3 has inline checkbox ACs
    expect(plan.steps[2]?.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
  });

  it("estimates effort based on content", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    // Step 3 has 4+ substeps → large
    expect(plan.steps[2]?.estimatedEffort).toBe("large");
    // Step 1 has 3 substeps → medium
    expect(plan.steps[0]?.estimatedEffort).toBe("medium");
  });

  it("handles empty plan gracefully", () => {
    const plan = parsePlan("");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.title).toBe("Untitled Plan");
  });

  it("handles numbered list format", () => {
    const plan = parsePlan(`# Simple Plan

1. First step
   Some description
2. Second step
   More description
3. Third step
`);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]?.title).toBe("First step");
    expect(plan.steps[2]?.title).toBe("Third step");
  });

  it("preserves raw text", () => {
    const plan = parsePlan(SAMPLE_PLAN);
    expect(plan.rawText).toBe(SAMPLE_PLAN);
  });
});
