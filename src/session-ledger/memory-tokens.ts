import { estimateStringTokens } from "../memory/token-estimate.js";
import type { Observation } from "./types.js";

export function observationTokenEstimate(observation: Observation): number {
	return estimateStringTokens(observation.content);
}

export function observationTokenSum(observations: readonly Observation[]): number {
	return observations.reduce((sum, observation) => sum + observationTokenEstimate(observation), 0);
}
