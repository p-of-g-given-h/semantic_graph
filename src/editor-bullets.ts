import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { editorLivePreviewField, setIcon } from "obsidian";
import type SemanticGraphPlugin from "./main";
import {
	getBulletMarkerRange,
	hasBulletMetadata,
	toggleBulletMetadataLine,
} from "./metadata";

const BULLET_MARKER_CLASS = "semantic-graph-bullet-marker";
const BULLET_HAS_METADATA_CLASS = "semantic-graph-bullet-has-metadata";

export function registerBulletEditorExtension(plugin: SemanticGraphPlugin) {
	plugin.registerEditorExtension(
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = buildDecorations(view);
				}

				update(update: ViewUpdate) {
					const livePreviewChanged =
						update.startState.field(editorLivePreviewField, false) !==
						update.state.field(editorLivePreviewField, false);

					if (update.docChanged || update.viewportChanged || livePreviewChanged) {
						this.decorations = buildDecorations(update.view);
					}
				}
			},
			{
				decorations: (value) => value.decorations,
				eventHandlers: {
					mousedown(event, view) {
						return handleMarkerToggle(event, view);
					},
					touchstart(event, view) {
						return handleMarkerToggle(event, view);
					},
				},
			},
		),
	);
}

class BulletMarkerWidget extends WidgetType {
	constructor(
		private readonly lineNumber: number,
		private readonly metadataEnabled: boolean,
	) {
		super();
	}

	eq(other: BulletMarkerWidget): boolean {
		return (
			this.lineNumber === other.lineNumber &&
			this.metadataEnabled === other.metadataEnabled
		);
	}

	toDOM(): HTMLElement {
		const marker = createSpan({
			cls: BULLET_MARKER_CLASS,
			attr: {
				"aria-label": this.metadataEnabled
					? "Remove bullet metadata"
					: "Add bullet metadata",
				"data-line-number": String(this.lineNumber),
				role: "button",
				tabindex: "-1",
			},
		});
		setIcon(marker, this.metadataEnabled ? "brain" : "circle");
		return marker;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function buildDecorations(view: EditorView): DecorationSet {
	if (!view.state.field(editorLivePreviewField, false)) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	const processedLines = new Set<number>();

	for (const range of view.visibleRanges) {
		let line = view.state.doc.lineAt(range.from);
			const endLine = view.state.doc.lineAt(range.to);

			while (true) {
				if (!processedLines.has(line.number)) {
					addBulletDecoration(builder, line);
					processedLines.add(line.number);
				}

			if (line.number >= endLine.number) {
				break;
			}

			line = view.state.doc.line(line.number + 1);
		}
	}

	return builder.finish();
}

function addBulletDecoration(
	builder: RangeSetBuilder<Decoration>,
	line: { from: number; number: number; text: string },
) {
	const markerRange = getBulletMarkerRange(line.text);
	if (!markerRange) {
		return;
	}

	const metadataEnabled = hasBulletMetadata(line.text);

	if (metadataEnabled) {
		builder.add(
			line.from,
			line.from,
			Decoration.line({
				attributes: {
					class: BULLET_HAS_METADATA_CLASS,
				},
			}),
		);
	}

	const decoration = Decoration.replace({
		widget: new BulletMarkerWidget(
			line.number - 1,
			metadataEnabled,
		),
	});

	builder.add(
		line.from + markerRange.from,
		line.from + markerRange.to,
		decoration,
	);
}

function handleMarkerToggle(
	event: Event,
	view: EditorView,
): boolean {
	if (event instanceof MouseEvent && event.button !== 0) {
		return false;
	}

	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	const marker = target.closest<HTMLElement>(`.${BULLET_MARKER_CLASS}`);
	if (!marker) {
		return false;
	}

	const lineNumber = Number(marker.dataset.lineNumber);
	if (Number.isNaN(lineNumber) || lineNumber < 0 || lineNumber >= view.state.doc.lines) {
		return true;
	}

	event.preventDefault();
	event.stopPropagation();

	const line = view.state.doc.line(lineNumber + 1);
	const updatedLine = toggleBulletMetadataLine(line.text);
	if (updatedLine === null || updatedLine === line.text) {
		return true;
	}

	view.dispatch({
		changes: {
			from: line.from,
			to: line.to,
			insert: updatedLine,
		},
	});
	view.focus();
	return true;
}
