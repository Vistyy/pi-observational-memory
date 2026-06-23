import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { recallMemorySources, type Entry } from "../session-ledger/recall.js";
import { MEMORY_ID_PATTERN, RECALL_OBSERVATION_TOOL_NAME, RECALL_TOOL_TEXT } from "./recall/constants.js";
import { emptyDetails, textResult } from "./recall/details.js";
import { recallRenderMode, renderFoundResult } from "./recall/render-text.js";
import { formatRecallCallForTui, formatRecallRenderedResultForTui } from "./recall/render-tui.js";
import type { RecallObservationToolDetails } from "./recall/types.js";

export { MEMORY_ID_PATTERN, RECALL_OBSERVATION_TOOL_NAME, RECALL_TOOL_TEXT } from "./recall/constants.js";
export { formatRecallCallForTui, formatRecallHeaderForTui, formatRecallRenderedResultForTui, formatRecallResultForTui } from "./recall/render-tui.js";
export type { RecallObservationToolDetails, RecallRenderMode, RecallSourceEntryDetails } from "./recall/types.js";

export const recallObservationTool = defineTool({
	name: RECALL_OBSERVATION_TOOL_NAME,
	label: "Recall memory evidence",
	description: RECALL_TOOL_TEXT.description,
	promptSnippet: RECALL_TOOL_TEXT.promptSnippet,
	promptGuidelines: [...RECALL_TOOL_TEXT.promptGuidelines],
	executionMode: "parallel",
	parameters: Type.Object({
		id: Type.String({
			pattern: "^(?:[a-f0-9]{12}|obs_[a-f0-9]{12}|ref_[a-f0-9]{12})$",
			description: RECALL_TOOL_TEXT.idDescription,
		}),
		mode: Type.Optional(Type.Union([Type.Literal("evidence"), Type.Literal("provenance")], {
			description: RECALL_TOOL_TEXT.modeDescription,
		})),
		depth: Type.Optional(Type.Number({
			description: RECALL_TOOL_TEXT.depthDescription,
		})),
	}),
	renderCall(args) {
		return new Text(formatRecallCallForTui(args.id), 0, 0);
	},
	renderResult(result, options) {
		return new Text(formatRecallRenderedResultForTui(result as AgentToolResult<RecallObservationToolDetails>, options.expanded), 0, 0);
	},
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const memoryId = params.id;
		if (!MEMORY_ID_PATTERN.test(memoryId)) {
			const message = `Memory id must be a typed obs_* or ref_* id, or a legacy 12-character lowercase hex id. Received: ${memoryId}`;
			return textResult(message, emptyDetails("invalid_id", memoryId, message));
		}
		const branchEntries = ctx.sessionManager.getBranch() as Entry[];
		const result = recallMemorySources(branchEntries, memoryId, { depth: typeof params.depth === "number" ? params.depth : undefined });
		if (result.status === "not_found") {
			const message = `No observation or reflection with id ${memoryId} was found on the current branch.`;
			return textResult(message, emptyDetails("not_found", memoryId, message));
		}
		return renderFoundResult(result, recallRenderMode(params));
	},
});

export function registerRecallTool(pi: ExtensionAPI): void {
	pi.registerTool(recallObservationTool);
}
