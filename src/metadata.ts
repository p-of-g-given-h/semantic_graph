import { App, Editor, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

export interface BulletMetadataLink {
	target: string;
	type: string;
}

export interface BulletMetadata {
	id: string;
	type: string;
	links: BulletMetadataLink[];
}

export interface BulletMarkerRange {
	from: number;
	to: number;
}

export interface SectionBulletLine {
	lineNumber: number;
	hasMetadata: boolean;
}

export interface ParsedBulletMetadataLine {
	metadata: BulletMetadata;
	text: string;
}

const BULLET_LINE_REGEX = /^(\s*)([-+*])(\s+)/;
const METADATA_SUFFIX_REGEX = /\s*%%meta\s+(\{.*\})\s*%%\s*$/;

export function getBulletMarkerRange(lineText: string): BulletMarkerRange | null {
	const match = lineText.match(BULLET_LINE_REGEX);
	if (!match) {
		return null;
	}

	const [, indent = "", marker = "", spacing = ""] = match;

	return {
		from: indent.length,
		to: indent.length + marker.length + spacing.length,
	};
}

export function hasBulletMetadata(lineText: string): boolean {
	return METADATA_SUFFIX_REGEX.test(lineText);
}

export function parseBulletMetadata(lineText: string): BulletMetadata | null {
	const match = lineText.match(METADATA_SUFFIX_REGEX);
	const metadataText = match?.[1];
	if (!metadataText) {
		return null;
	}

	try {
		const parsed = JSON.parse(metadataText) as unknown;
		return isBulletMetadata(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function parseBulletMetadataLine(lineText: string): ParsedBulletMetadataLine | null {
	const markerRange = getBulletMarkerRange(lineText);
	if (!markerRange) {
		return null;
	}

	const metadata = parseBulletMetadata(lineText);
	if (!metadata) {
		return null;
	}

	const contentWithoutMetadata = lineText.replace(METADATA_SUFFIX_REGEX, "").trimEnd();
	const bulletText = contentWithoutMetadata.slice(markerRange.to).trim();

	return {
		metadata,
		text: bulletText,
	};
}

export function toggleBulletMetadataLine(lineText: string): string | null {
	if (!getBulletMarkerRange(lineText)) {
		return null;
	}

	if (hasBulletMetadata(lineText)) {
		return lineText.replace(METADATA_SUFFIX_REGEX, "").replace(/\s+$/, "");
	}

	const trimmedLine = lineText.replace(/\s+$/, "");
	return `${trimmedLine} ${formatMetadataBlock(createDefaultBulletMetadata())}`;
}

export function getSectionBulletLines(
	sectionText: string,
	lineStart: number,
): SectionBulletLine[] {
	return sectionText
		.split(/\r?\n/)
		.map((lineText, index) => ({
			lineNumber: lineStart + index,
			lineText,
		}))
		.filter(({ lineText }) => getBulletMarkerRange(lineText) !== null)
		.map(({ lineNumber, lineText }) => ({
			lineNumber,
			hasMetadata: hasBulletMetadata(lineText),
		}));
}

export function toggleBulletMetadataInEditor(
	editor: Editor,
	lineNumber: number,
): boolean {
	if (lineNumber < 0 || lineNumber >= editor.lineCount()) {
		return false;
	}

	const lineText = editor.getLine(lineNumber);
	const updatedLine = toggleBulletMetadataLine(lineText);
	if (updatedLine === null || updatedLine === lineText) {
		return false;
	}

	editor.replaceRange(
		updatedLine,
		{ line: lineNumber, ch: 0 },
		{ line: lineNumber, ch: lineText.length },
	);
	return true;
}

export async function toggleBulletMetadataInFile(
	app: App,
	file: TFile,
	lineNumber: number,
): Promise<boolean> {
	const openEditor = findOpenEditorForFile(app, file.path);
	if (openEditor) {
		return toggleBulletMetadataInEditor(openEditor, lineNumber);
	}

	const content = await app.vault.cachedRead(file);
	const updatedContent = updateLineInText(content, lineNumber, toggleBulletMetadataLine);
	if (updatedContent === null || updatedContent === content) {
		return false;
	}

	await app.vault.modify(file, updatedContent);
	return true;
}

export async function readMarkdownFileContent(app: App, file: TFile): Promise<string> {
	const openEditor = findOpenEditorForFile(app, file.path);
	if (openEditor) {
		return openEditor.getValue();
	}

	return app.vault.cachedRead(file);
}

function createDefaultBulletMetadata(): BulletMetadata {
	return {
		id: createRandom48BitHexId(),
		type: "default",
		links: [],
	};
}

function createRandom48BitHexId(): string {
	const bytes = new Uint8Array(6);
	if ("crypto" in globalThis && typeof globalThis.crypto?.getRandomValues === "function") {
		globalThis.crypto.getRandomValues(bytes);
	} else {
		for (let index = 0; index < bytes.length; index += 1) {
			bytes[index] = Math.floor(Math.random() * 256);
		}
	}

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatMetadataBlock(metadata: BulletMetadata): string {
	return `%%meta ${JSON.stringify(metadata)}%%`;
}

function isBulletMetadata(value: unknown): value is BulletMetadata {
	if (!value || typeof value !== "object") {
		return false;
	}

	const metadata = value as Partial<BulletMetadata>;
	return (
		typeof metadata.id === "string" &&
		typeof metadata.type === "string" &&
		Array.isArray(metadata.links) &&
		metadata.links.every(isBulletMetadataLink)
	);
}

function isBulletMetadataLink(value: unknown): value is BulletMetadataLink {
	if (!value || typeof value !== "object") {
		return false;
	}

	const link = value as Partial<BulletMetadataLink>;
	return typeof link.target === "string" && typeof link.type === "string";
}

function findOpenEditorForFile(app: App, path: string): Editor | null {
	let openEditor: Editor | null = null;

	app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
		if (openEditor || !(leaf.view instanceof MarkdownView)) {
			return;
		}

		if (leaf.view.file?.path === path && leaf.view.editor) {
			openEditor = leaf.view.editor;
		}
	});

	return openEditor;
}

function updateLineInText(
	content: string,
	lineNumber: number,
	updater: (lineText: string) => string | null,
): string | null {
	const hasTrailingNewline = /\r?\n$/.test(content);
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);

	if (hasTrailingNewline && lines[lines.length - 1] === "") {
		lines.pop();
	}

	if (lineNumber < 0 || lineNumber >= lines.length) {
		return null;
	}

	const currentLine = lines[lineNumber];
	if (currentLine === undefined) {
		return null;
	}

	const updatedLine = updater(currentLine);
	if (updatedLine === null || updatedLine === currentLine) {
		return null;
	}

	lines[lineNumber] = updatedLine;

	const updatedContent = lines.join(newline);
	return hasTrailingNewline ? `${updatedContent}${newline}` : updatedContent;
}
