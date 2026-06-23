import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { hashId, reflectionId } from "../memory/ids.js";
import type { Reflection } from "../session-ledger/index.js";
import { normalizeAllowedIdsStrict } from "./common.js";
import { normalizeReflectionContent } from "./reflection-content.js";

export const RecordReflectionsSchema = Type.Object({
	reflections: Type.Array(Type.Object({
		content: Type.String({ minLength: 1 }),
		sources: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	})),
	summary: Type.Optional(Type.String({ minLength: 1 })),
});

export type RecordReflectionsArgs = Static<typeof RecordReflectionsSchema>;

export type ReflectionRecordToolResult = {
	tool: AgentTool<typeof RecordReflectionsSchema>;
	accepted: () => Reflection[];
	called: () => boolean;
	recordedEmpty: () => boolean;
	rejected: () => number;
	summary: () => string | undefined;
};

export function reflectionRecordTool(args: {
	name: string;
	label: string;
	description: string;
	allowedSourceIds: string[];
	existingReflectionIds?: Set<string>;
	allowSummary?: boolean;
	ackVerb?: string;
}): ReflectionRecordToolResult {
	const accumulated = new Map<string, Reflection>();
	let called = false;
	let recordedEmpty = false;
	let rejected = 0;
	let duplicates = 0;
	let summary: string | undefined;
	const existing = args.existingReflectionIds ?? new Set<string>();
	const ackVerb = args.ackVerb ?? "Recorded";
	const tool: AgentTool<typeof RecordReflectionsSchema> = {
		name: args.name,
		label: args.label,
		description: args.description,
		parameters: RecordReflectionsSchema,
		execute: async (_id, params: RecordReflectionsArgs) => {
			called = true;
			recordedEmpty ||= params.reflections.length === 0;
			if (args.allowSummary) summary = params.summary ? normalizeReflectionContent(params.summary) : undefined;
			for (const proposal of params.reflections) {
				const content = normalizeReflectionContent(proposal.content);
				const sources = normalizeAllowedIdsStrict(proposal.sources, args.allowedSourceIds);
				if (!content || !sources) {
					rejected++;
					continue;
				}
				const id = reflectionId(hashId(content));
				if (existing.has(id) || accumulated.has(id)) {
					duplicates++;
					continue;
				}
				accumulated.set(id, { id, kind: "reflection", content, sources, createdAt: new Date().toISOString() });
			}
			return {
				content: [{ type: "text", text: `${ackVerb} ${accumulated.size} reflection${accumulated.size === 1 ? "" : "s"}; ${duplicates} duplicate${duplicates === 1 ? "" : "s"}; ${rejected} rejected.` }],
				details: { accepted: accumulated.size, duplicates, rejected },
				terminate: true,
			};
		},
	};
	return {
		tool,
		accepted: () => Array.from(accumulated.values()),
		called: () => called,
		recordedEmpty: () => recordedEmpty,
		rejected: () => rejected,
		summary: () => summary,
	};
}
