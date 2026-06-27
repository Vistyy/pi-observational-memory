export const CHECKPOINT_MARKDOWN_HEADINGS = [
	"# Checkpoint",
	"## Current objective",
	"## Progress and decisions",
	"## Important context",
	"## Remaining work",
	"## References and anchors",
] as const;

export const EMPTY_CHECKPOINT_MARKDOWN = `# Checkpoint

## Current objective

None known.

## Progress and decisions

None known.

## Important context

None known.

## Remaining work

None known.

## References and anchors

None known.`;

export function renderCheckpointHeadingList(): string {
	return CHECKPOINT_MARKDOWN_HEADINGS.join("\n");
}

export function checkpointFormatInstructions(): string {
	return `Use the required headings exactly:\n${renderCheckpointHeadingList()}`;
}

export function isValidCheckpointMarkdown(content: string): boolean {
	return content.trim().length > 0 && CHECKPOINT_MARKDOWN_HEADINGS.every((heading) => content.includes(heading));
}
