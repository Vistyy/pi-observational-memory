import { estimateStringTokens } from "../memory/token-estimate.js";
import type { Observation, Reflection } from "./types.js";

export function observationTokenEstimate(observation: Observation): number {
	return estimateStringTokens(observation.content);
}

export function observationTokenSum(observations: readonly Observation[]): number {
	return observations.reduce((sum, observation) => sum + observationTokenEstimate(observation), 0);
}

export function reflectionTokenEstimate(reflection: Reflection): number {
	return estimateStringTokens(reflection.content);
}

export function reflectionTokenSum(reflections: readonly Reflection[]): number {
	return reflections.reduce((sum, reflection) => sum + reflectionTokenEstimate(reflection), 0);
}
