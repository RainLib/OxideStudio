import { registerCliAdapterTests } from "./ai-integration/cliAdapter.cases";
import { registerInputValidationTests } from "./ai-integration/inputValidation.cases";
import { registerLangGraphPlannerTests } from "./ai-integration/langGraphPlanner.cases";
import { registerMcpAdapterTests } from "./ai-integration/mcpAdapter.cases";
import { registerModelPlannerTests } from "./ai-integration/modelPlanner.cases";
import { registerPlanNormalizationTests } from "./ai-integration/planNormalization.cases";

// Register every protocol and planner suite through the existing test entry.
registerMcpAdapterTests();
registerCliAdapterTests();
registerInputValidationTests();
registerLangGraphPlannerTests();
registerPlanNormalizationTests();
registerModelPlannerTests();
