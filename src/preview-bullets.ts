import { TFile, setIcon } from "obsidian";
import type SemanticGraphPlugin from "./main";
import { getSectionBulletLines, toggleBulletMetadataInFile } from "./metadata";

const PREVIEW_BULLET_CLASS = "semantic-graph-preview-bullet";
const PREVIEW_BULLETIZED_CLASS = "semantic-graph-preview-bulletized";
const BULLET_HAS_METADATA_CLASS = "semantic-graph-bullet-has-metadata";

export function registerBulletPreviewPostProcessor(plugin: SemanticGraphPlugin) {
	plugin.registerMarkdownPostProcessor(async (el, ctx) => {
		const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile)) {
			return;
		}

		const section = ctx.getSectionInfo(el);
		if (!section) {
			return;
		}

		const bulletLines = getSectionBulletLines(section.text, section.lineStart);
		if (!bulletLines.length) {
			return;
		}

		const listItems = getUnorderedListItems(el);
		for (let index = 0; index < bulletLines.length && index < listItems.length; index += 1) {
			const bulletLine = bulletLines[index];
			const listItem = listItems[index];
			if (!bulletLine || !listItem) {
				continue;
			}

			decoratePreviewListItem(
				plugin,
				file,
				listItem,
				bulletLine.lineNumber,
				bulletLine.hasMetadata,
			);
		}
	});
}

function getUnorderedListItems(root: HTMLElement): HTMLLIElement[] {
	return Array.from(root.querySelectorAll("li")).filter(
		(listItem): listItem is HTMLLIElement =>
			listItem.parentElement?.tagName === "UL",
	);
}

function decoratePreviewListItem(
	plugin: SemanticGraphPlugin,
	file: TFile,
	listItem: HTMLLIElement,
	lineNumber: number,
	metadataEnabled: boolean,
) {
	listItem.addClass(PREVIEW_BULLETIZED_CLASS);
	listItem.toggleClass(BULLET_HAS_METADATA_CLASS, metadataEnabled);

	const marker = getOrCreatePreviewMarker(listItem);

	marker.empty();
	setIcon(marker, metadataEnabled ? "brain" : "circle");
	marker.setAttr(
		"aria-label",
		metadataEnabled ? "Remove bullet metadata" : "Add bullet metadata",
	);
	marker.setAttr("role", "button");
	marker.tabIndex = 0;
	marker.onmousedown = stopMarkerEvent;
	marker.ontouchstart = stopMarkerEvent;
	marker.onclick = async (event: MouseEvent) => {
		stopMarkerEvent(event);
		await toggleBulletMetadataInFile(plugin.app, file, lineNumber);
	};
	marker.onkeydown = async (event: KeyboardEvent) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		stopMarkerEvent(event);
		await toggleBulletMetadataInFile(plugin.app, file, lineNumber);
	};
}

function getOrCreatePreviewMarker(listItem: HTMLLIElement): HTMLElement {
	const existingMarker =
		listItem.querySelector<HTMLElement>(`:scope > .${PREVIEW_BULLET_CLASS}`) ??
		listItem.querySelector<HTMLElement>(":scope > .list-bullet");
	if (existingMarker) {
		existingMarker.addClass(PREVIEW_BULLET_CLASS);
		return existingMarker;
	}

	const marker = createSpan({ cls: PREVIEW_BULLET_CLASS });
	listItem.insertBefore(marker, listItem.firstChild);
	return marker;
}

function stopMarkerEvent(event: Event) {
	event.preventDefault();
	event.stopPropagation();
}
