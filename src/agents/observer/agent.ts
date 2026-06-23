import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { hashId, observationId } from "../../memory/ids.js";
import { normalizeAllowedIdsStrict, runMemoryAgentLoop, type MemoryAgentUsage } from "../common.js";
import { OBSERVER_OBSERVATION_CONTENT_DESCRIPTION, OBSERVER_SYSTEM, OBSERVER_TOOL_DESCRIPTION, observerUserText } from "./prompts.js";
import { nowTimestamp, truncateRecordContent } from "../../memory/record-content.js";
import type { Observation } from "../../session-ledger/index.js";

interface RunObserverArgs {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	chunk: string;
	allowedSourceEntryIds: string[];
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
	onUsage?: (usage: MemoryAgentUsage) => void;
}

export const OBSERVATION_TIMESTAMP_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$";

const RecordObservationsSchema = Type.Object({
	observations: Type.Array(
		Type.Object({
			content: Type.String({
				minLength: 1,
				description: OBSERVER_OBSERVATION_CONTENT_DESCRIPTION,
			}),
			timestamp: Type.String({
				pattern: OBSERVATION_TIMESTAMP_PATTERN,
				description: "Observation time in local 'YYYY-MM-DD HH:MM' format.",
			}),
			sourceEntryIds: Type.Array(
				Type.String({ minLength: 1 }),
				{
					minItems: 1,
					description:
						"Exact source entry ids from the chunk that directly support this observation. " +
						"Use only ids shown in '[Source entry id: ...]' labels; never invent ids.",
				},
			),
		}),
		{ description: "Batch of new observations. May be empty only if the tool is not called at all." },
	),
});
type RecordObservationsArgs = Static<typeof RecordObservationsSchema>;

export const normalizeSourceEntryIds = normalizeAllowedIdsStrict;

type RejectedSourceEntry = {
	id?: string;
	reason: "missing_source_entry_ids" | "invalid_source_entry_id";
};

type SourceEntryIdPartition = {
	accepted: string[];
	rejected: RejectedSourceEntry[];
};

function partitionSourceEntryIds(ids: readonly string[] | undefined, allowedSourceEntryIds: readonly string[]): SourceEntryIdPartition {
	if (!ids || ids.length === 0) return { accepted: [], rejected: [{ reason: "missing_source_entry_ids" }] };

	const allowedOrder = new Map<string, number>();
	for (let i = 0; i < allowedSourceEntryIds.length; i++) {
		if (!allowedOrder.has(allowedSourceEntryIds[i])) allowedOrder.set(allowedSourceEntryIds[i], i);
	}

	const accepted = new Set<string>();
	const seen = new Set<string>();
	const rejected: RejectedSourceEntry[] = [];
	for (const id of ids) {
		if (seen.has(id)) continue;
		seen.add(id);
		if (!allowedOrder.has(id)) {
			rejected.push({ id, reason: "invalid_source_entry_id" });
			continue;
		}
		accepted.add(id);
	}

	return {
		accepted: Array.from(accepted).sort((a, b) => (allowedOrder.get(a) ?? 0) - (allowedOrder.get(b) ?? 0)),
		rejected,
	};
}

function rejectedSourceEntrySummary(rejectedDetails: Array<{ sourceEntryIds: RejectedSourceEntry[] }>): string {
	const parts: string[] = [];
	for (const detail of rejectedDetails) {
		for (const source of detail.sourceEntryIds) {
			parts.push(source.id ? `${source.id}: ${source.reason}` : source.reason);
		}
	}
	return parts.join(", ");
}

export async function runObserver(args: RunObserverArgs): Promise<Observation[] | undefined> {
	const { model, apiKey, headers, chunk, allowedSourceEntryIds, signal } = args;
	const conversation = chunk.trim();
	if (!conversation) return undefined;

	const accumulated = new Map<string, Observation>();
	let recordedEmpty = false;

	const recordObservations: AgentTool<typeof RecordObservationsSchema> = {
		name: "record_observations",
		label: "Record observations",
		description: OBSERVER_TOOL_DESCRIPTION,
		parameters: RecordObservationsSchema,
		execute: async (_id, params: RecordObservationsArgs) => {
			recordedEmpty ||= params.observations.length === 0;
			let added = 0;
			let duplicates = 0;
			let rejected = 0;
			const rejectedDetails: Array<{ content: string; sourceEntryIds: RejectedSourceEntry[] }> = [];
			for (const obs of params.observations) {
				const sourceEntryIds = partitionSourceEntryIds(obs.sourceEntryIds, allowedSourceEntryIds);
				if (sourceEntryIds.rejected.length > 0 || sourceEntryIds.accepted.length === 0) {
					rejected++;
					rejectedDetails.push({ content: truncateRecordContent(obs.content), sourceEntryIds: sourceEntryIds.rejected });
					continue;
				}
				const content = truncateRecordContent(obs.content);
				const id = observationId(hashId(content));
				if (accumulated.has(id)) {
					duplicates++;
					continue;
				}
				accumulated.set(id, {
					id,
					kind: "observation",
					content,
					createdAt: obs.timestamp,
					timestamp: obs.timestamp,
					sourceEntryIds: sourceEntryIds.accepted,
				});
				added++;
			}
			const rejectedSummary = rejectedSourceEntrySummary(rejectedDetails);
			const rejectedPart = rejected > 0
				? ` ${rejected} observation${rejected === 1 ? "" : "s"} rejected for missing or invalid sourceEntryIds${rejectedSummary ? ` (${rejectedSummary})` : ""}.`
				: "";
			const ack =
				`Recorded ${added} new observation${added === 1 ? "" : "s"} ` +
				(duplicates > 0 ? `(${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped).` : ".") +
				rejectedPart +
				` Total this run: ${accumulated.size}.`;
			return { content: [{ type: "text", text: ack }], details: { added, duplicates, rejected, rejectedDetails, total: accumulated.size }, terminate: true };
		},
	};

	const now = nowTimestamp();
	const userText = observerUserText(now, conversation);

	await runMemoryAgentLoop({
		model,
		apiKey,
		headers,
		signal,
		agentLoop: args.agentLoop,
		maxTurns: args.maxTurns,
		thinkingLevel: args.thinkingLevel,
		systemPrompt: OBSERVER_SYSTEM,
		userText,
		tools: [recordObservations as AgentTool<any>],
		agentName: "observer",
		onUsage: args.onUsage,
	});

	if (accumulated.size === 0) return recordedEmpty ? [] : undefined;
	return Array.from(accumulated.values());
}
