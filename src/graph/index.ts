import type { WorkspaceLeaf } from "obsidian";
import type SemanticGraphPlugin from "../main";
import { CORE_GRAPH_VIEW_TYPE, CoreGraphOverlay } from "./overlay";

export function registerSemanticGraphInCoreGraphView(plugin: SemanticGraphPlugin) {
	const overlays = new Map<WorkspaceLeaf, CoreGraphOverlay>();
	let refreshTimer: number | null = null;

	const syncOverlays = () => {
		const graphLeaves = new Set(
			plugin.app.workspace.getLeavesOfType(CORE_GRAPH_VIEW_TYPE),
		);

		for (const [leaf, overlay] of overlays) {
			if (graphLeaves.has(leaf)) {
				overlay.attach();
				continue;
			}

			overlay.detach();
			overlays.delete(leaf);
		}

		for (const leaf of graphLeaves) {
			const existingOverlay = overlays.get(leaf);
			if (existingOverlay) {
				existingOverlay.attach();
				continue;
			}

			overlays.set(leaf, new CoreGraphOverlay(plugin, leaf));
		}
	};

	const refresh = () => {
		syncOverlays();
		if (!overlays.size) {
			return;
		}

		if (refreshTimer !== null) {
			window.clearTimeout(refreshTimer);
		}

		refreshTimer = window.setTimeout(() => {
			refreshTimer = null;
			for (const overlay of overlays.values()) {
				void overlay.refresh();
			}
		}, 120);
	};

	plugin.register(() => {
		if (refreshTimer !== null) {
			window.clearTimeout(refreshTimer);
		}

		for (const overlay of overlays.values()) {
			overlay.detach();
		}
		overlays.clear();
	});

	plugin.app.workspace.onLayoutReady(() => {
		refresh();
	});

	plugin.registerEvent(
		plugin.app.workspace.on("layout-change", () => {
			refresh();
		}),
	);
	plugin.registerEvent(
		plugin.app.workspace.on("css-change", () => {
			refresh();
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("create", () => {
			refresh();
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("modify", () => {
			refresh();
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("delete", () => {
			refresh();
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("rename", () => {
			refresh();
		}),
	);
	plugin.registerEvent(
		plugin.app.workspace.on("editor-change", () => {
			refresh();
		}),
	);
}
