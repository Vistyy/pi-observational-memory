export const CHECKPOINT_MARKDOWN_HEADINGS = [
	"# Handoff",
	"## Focus",
	"## State",
	"## Next",
	"## References",
] as const;

export const OPTIONAL_CHECKPOINT_MARKDOWN_HEADINGS = [
	"## Suggested tools or skills",
] as const;

export const EMPTY_CHECKPOINT_MARKDOWN = `# Handoff

## Focus

None known.

## State

None known.

## Next

None known.

## References

None known.`;

export function renderCheckpointHeadingList(): string {
	return CHECKPOINT_MARKDOWN_HEADINGS.join("\n");
}

export function checkpointFormatInstructions(): string {
	return `Use the required headings exactly:\n${renderCheckpointHeadingList()}\n\nOptional heading when useful:\n${OPTIONAL_CHECKPOINT_MARKDOWN_HEADINGS.join("\n")}`;
}

export function isValidCheckpointMarkdown(content: string): boolean {
	return content.trim().length > 0 && CHECKPOINT_MARKDOWN_HEADINGS.every((heading) => content.includes(heading));
}
