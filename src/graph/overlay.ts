import {
	MarkdownView,
	TFile,
	View,
	type WorkspaceLeaf,
} from "obsidian";
import type SemanticGraphPlugin from "../main";
import { buildSemanticGraphData } from "./data";
import { computeGraphLayout } from "./layout";
import type {
	PositionedSemanticGraphNode,
	SemanticGraphData,
	SemanticGraphEdge,
	SemanticGraphNode,
} from "./types";

export const CORE_GRAPH_VIEW_TYPE = "graph";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_INTERNAL_OBJECTS = 4000;
const MAX_INTERNAL_DEPTH = 6;

interface AnchorCandidate {
	score: number;
	values: string[];
	x: number;
	y: number;
}

export class CoreGraphOverlay {
	private readonly rootEl: HTMLDivElement;
	private readonly infoEl: HTMLDivElement;
	private readonly canvasEl: HTMLDivElement;
	private readonly resizeObserver: ResizeObserver;
	private animationFrameId: number | null = null;
	private refreshCounter = 0;
	private graphData: SemanticGraphData = { nodes: [], edges: [] };

	constructor(
		private readonly plugin: SemanticGraphPlugin,
		private readonly leaf: WorkspaceLeaf,
	) {
		this.rootEl = createDiv({
			cls: "semantic-graph-core-overlay",
		});
		this.infoEl = this.rootEl.createDiv({
			cls: "semantic-graph-core-overlay__info",
		});
		this.canvasEl = this.rootEl.createDiv({
			cls: "semantic-graph-core-overlay__canvas",
		});
		this.resizeObserver = new ResizeObserver(() => {
			this.render();
		});
	}

	attach() {
		const hostEl = getGraphContentHost(this.leaf.view);
		if (!hostEl) {
			return;
		}

		hostEl.addClass("semantic-graph-core-overlay-host");

		if (this.rootEl.parentElement !== hostEl) {
			hostEl.appendChild(this.rootEl);
			this.resizeObserver.disconnect();
			this.resizeObserver.observe(hostEl);
		}

		this.ensureAnimationLoop();
	}

	detach() {
		this.stopAnimationLoop();
		this.resizeObserver.disconnect();
		this.rootEl.remove();
	}

	async refresh() {
		this.attach();

		if (!this.rootEl.isConnected) {
			return;
		}

		const refreshId = ++this.refreshCounter;
		this.infoEl.setText("Refreshing semantic graph...");

		const graphData = await buildSemanticGraphData(this.plugin.app);
		if (refreshId !== this.refreshCounter) {
			return;
		}

		this.graphData = graphData;
		this.render();
	}

	private ensureAnimationLoop() {
		if (this.animationFrameId !== null) {
			return;
		}

		const tick = () => {
			this.animationFrameId = null;
			if (!this.rootEl.isConnected) {
				return;
			}

			if (this.graphData.nodes.length > 0) {
				this.render();
			}

			this.ensureAnimationLoop();
		};

		this.animationFrameId = window.requestAnimationFrame(tick);
	}

	private stopAnimationLoop() {
		if (this.animationFrameId === null) {
			return;
		}

		window.cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = null;
	}

	private render() {
		if (!this.rootEl.isConnected) {
			return;
		}

		this.canvasEl.empty();

		const documentNodes = this.graphData.nodes.filter(
			(node) => node.kind === "document",
		);
		const bulletCount = this.graphData.nodes.filter(
			(node) => node.kind === "bullet",
		).length;
		this.infoEl.setText(
			bulletCount > 0
				? `${documentNodes.length} docs, ${bulletCount} bullets, ${this.graphData.edges.length} links`
				: "No bullet metadata nodes found.",
		);

		if (bulletCount === 0) {
			return;
		}

		const width = Math.max(this.canvasEl.clientWidth, 640);
		const height = Math.max(this.canvasEl.clientHeight, 420);
		const hostEl = getGraphContentHost(this.leaf.view);
		const canvasRect = this.canvasEl.getBoundingClientRect();
		const documentAnchors = resolveDocumentAnchors(
			this.leaf.view,
			hostEl,
			documentNodes,
			canvasRect,
		);
		const positionedNodes = computeGraphLayout(
			this.graphData,
			width,
			height,
			documentAnchors,
		);
		const positionedNodesById = new Map(
			positionedNodes.map((node) => [node.id, node]),
		);
		const svgEl = createSvgRoot(width, height);

		for (const edge of this.graphData.edges) {
			if (edge.kind === "contains" && !documentAnchors.has(edge.source)) {
				continue;
			}

			const source = positionedNodesById.get(edge.source);
			const target = positionedNodesById.get(edge.target);
			if (!source || !target) {
				continue;
			}

			svgEl.appendChild(createEdgeElement(edge, source, target));
		}

		for (const node of positionedNodes) {
			if (node.kind !== "bullet") {
				continue;
			}

			svgEl.appendChild(this.createNodeElement(node));
		}

		this.canvasEl.appendChild(svgEl);
	}

	private createNodeElement(node: PositionedSemanticGraphNode): SVGGElement {
		const groupEl = document.createElementNS(SVG_NAMESPACE, "g");
		groupEl.setAttribute(
			"class",
			`semantic-graph-node semantic-graph-node--${node.kind}`,
		);
		groupEl.setAttribute("transform", `translate(${node.x} ${node.y})`);
		groupEl.setAttribute("tabindex", "0");
		groupEl.setAttribute("role", "button");

		const circleEl = document.createElementNS(SVG_NAMESPACE, "circle");
		circleEl.setAttribute("r", node.kind === "document" ? "18" : "12");
		groupEl.appendChild(circleEl);

		const labelEl = document.createElementNS(SVG_NAMESPACE, "text");
		labelEl.setAttribute("x", "0");
		labelEl.setAttribute("y", node.kind === "document" ? "34" : "28");
		labelEl.setAttribute("text-anchor", "middle");
		labelEl.textContent = truncateLabel(node.label);
		groupEl.appendChild(labelEl);

		const titleEl = document.createElementNS(SVG_NAMESPACE, "title");
		titleEl.textContent =
			node.kind === "document"
				? node.filePath
				: `${node.label} (${node.filePath}:${(node.lineNumber ?? 0) + 1})`;
		groupEl.appendChild(titleEl);

		groupEl.addEventListener("click", (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			void this.openNode(node);
		});
		groupEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void this.openNode(node);
		});

		return groupEl;
	}

	private async openNode(node: SemanticGraphNode) {
		const file = this.plugin.app.vault.getAbstractFileByPath(node.filePath);
		if (!(file instanceof TFile)) {
			return;
		}

		let targetLeaf = this.plugin.app.workspace.getMostRecentLeaf();
		if (!targetLeaf || targetLeaf === this.leaf) {
			targetLeaf = this.plugin.app.workspace.getLeaf("tab");
		}

		await targetLeaf.openFile(file);
		this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

		if (node.lineNumber === undefined) {
			return;
		}

		const view = targetLeaf.view;
		if (!(view instanceof MarkdownView)) {
			return;
		}

		const cursor = { line: node.lineNumber, ch: 0 };
		view.editor.setCursor(cursor);
		view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
	}
}

function getGraphContentHost(view: View): HTMLElement | null {
	const maybeItemView = view as View & { contentEl?: HTMLElement };
	if (maybeItemView.contentEl instanceof HTMLElement) {
		return maybeItemView.contentEl;
	}

	return (
		view.containerEl.querySelector<HTMLElement>(".view-content") ??
		view.containerEl
	);
}

function createSvgRoot(width: number, height: number): SVGSVGElement {
	const svgEl = document.createElementNS(SVG_NAMESPACE, "svg");
	svgEl.setAttribute("class", "semantic-graph-svg");
	svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svgEl.setAttribute("width", "100%");
	svgEl.setAttribute("height", "100%");
	return svgEl;
}

function createEdgeElement(
	edge: SemanticGraphEdge,
	source: PositionedSemanticGraphNode,
	target: PositionedSemanticGraphNode,
): SVGLineElement {
	const edgeEl = document.createElementNS(SVG_NAMESPACE, "line");
	edgeEl.setAttribute(
		"class",
		`semantic-graph-edge semantic-graph-edge--${edge.kind}`,
	);
	edgeEl.setAttribute("x1", String(source.x));
	edgeEl.setAttribute("y1", String(source.y));
	edgeEl.setAttribute("x2", String(target.x));
	edgeEl.setAttribute("y2", String(target.y));
	return edgeEl;
}

function truncateLabel(label: string): string {
	return label.length > 22 ? `${label.slice(0, 19)}...` : label;
}

function resolveDocumentAnchors(
	view: View,
	hostEl: HTMLElement | null,
	documentNodes: SemanticGraphNode[],
	canvasRect: DOMRect,
): Map<string, { x: number; y: number }> {
	const anchors = new Map<string, { x: number; y: number; score: number }>();
	if (!documentNodes.length) {
		return new Map();
	}

	const uniqueBasenames = getUniqueBasenameMap(documentNodes);
	const rendererAnchors = collectRendererAnchors(view);

	for (const node of documentNodes) {
		const directAnchor = rendererAnchors.get(normalizePath(node.id));
		if (!directAnchor) {
			continue;
		}

		setAnchor(
			anchors,
			node.id,
			directAnchor.x,
			directAnchor.y,
			20,
		);
	}

	for (const candidate of collectInternalAnchorCandidates(
		view,
		canvasRect,
	)) {
		const match = matchDocumentNode(candidate.values, documentNodes, uniqueBasenames);
		if (!match) {
			continue;
		}

		setAnchor(anchors, match.node.id, candidate.x, candidate.y, candidate.score + match.score);
	}

	for (const candidate of collectDomAnchorCandidates(hostEl, canvasRect, false)) {
		const match = matchDocumentNode(candidate.values, documentNodes, uniqueBasenames);
		if (!match) {
			continue;
		}

		setAnchor(anchors, match.node.id, candidate.x, candidate.y, candidate.score + match.score);
	}

	if (!anchors.size) {
		for (const candidate of collectDomAnchorCandidates(hostEl, canvasRect, true)) {
			const match = matchDocumentNode(candidate.values, documentNodes, uniqueBasenames);
			if (!match) {
				continue;
			}

			setAnchor(
				anchors,
				match.node.id,
				candidate.x,
				candidate.y,
				candidate.score + match.score,
			);
		}
	}

	return new Map(
		Array.from(anchors.entries()).map(([nodeId, anchor]) => [
			nodeId,
			{ x: anchor.x, y: anchor.y },
		]),
	);
}

function collectRendererAnchors(view: View): Map<string, { x: number; y: number }> {
	const renderer = (view as View & {
		renderer?: {
			nodeLookup?: Record<string, unknown>;
			nodes?: unknown[];
			scale?: number;
			panX?: number;
			panY?: number;
		};
	}).renderer;
	if (!renderer) {
		return new Map();
	}

	const anchors = new Map<string, { x: number; y: number }>();
	const scale = typeof renderer.scale === "number" ? renderer.scale : 1;
	const panX = typeof renderer.panX === "number" ? renderer.panX : 0;
	const panY = typeof renderer.panY === "number" ? renderer.panY : 0;
	const dpr = window.devicePixelRatio || 1;
	const nodeLookup = renderer.nodeLookup;
	if (nodeLookup && typeof nodeLookup === "object") {
		for (const [rawId, rawNode] of Object.entries(nodeLookup)) {
			const anchor = extractRendererNodeAnchor(rawNode, scale, panX, panY, dpr);
			if (!anchor) {
				continue;
			}

			anchors.set(normalizePath(rawId), anchor);
		}
	}

	for (const rawNode of renderer.nodes ?? []) {
		if (!rawNode || typeof rawNode !== "object") {
			continue;
		}

		const nodeRecord = rawNode as Record<string, unknown>;
		const rawId = nodeRecord.id;
		if (typeof rawId !== "string") {
			continue;
		}

		const anchor = extractRendererNodeAnchor(nodeRecord, scale, panX, panY, dpr);
		if (!anchor) {
			continue;
		}

		anchors.set(normalizePath(rawId), anchor);
	}

	return anchors;
}

function extractRendererNodeAnchor(
	rawNode: unknown,
	scale: number,
	panX: number,
	panY: number,
	dpr: number,
): { x: number; y: number } | null {
	if (!rawNode || typeof rawNode !== "object") {
		return null;
	}

	const node = rawNode as Record<string, unknown>;
	const x = node.x;
	const y = node.y;
	if (typeof x === "number" && typeof y === "number") {
		return {
			x: (x * scale + panX) / dpr,
			y: (y * scale + panY) / dpr,
		};
	}

	const circle = node.circle;
	if (circle && typeof circle === "object") {
		const circleRecord = circle as Record<string, unknown>;
		const circleX = circleRecord.x;
		const circleY = circleRecord.y;
		if (typeof circleX === "number" && typeof circleY === "number") {
			return {
				x: (circleX * scale + panX) / dpr,
				y: (circleY * scale + panY) / dpr,
			};
		}
	}

	return null;
}

function collectInternalAnchorCandidates(
	root: unknown,
	canvasRect: DOMRect,
): AnchorCandidate[] {
	const candidates: AnchorCandidate[] = [];
	const visited = new WeakSet<object>();
	let inspected = 0;

	const visit = (value: unknown, depth: number) => {
		if (!value || typeof value !== "object") {
			return;
		}

		if (
			value instanceof HTMLElement ||
			value instanceof SVGElement ||
			value instanceof Window ||
			value instanceof Document
		) {
			return;
		}

		if (visited.has(value)) {
			return;
		}

		visited.add(value);
		inspected += 1;
		if (inspected > MAX_INTERNAL_OBJECTS || depth > MAX_INTERNAL_DEPTH) {
			return;
		}

		const candidate = createInternalAnchorCandidate(value, canvasRect);
		if (candidate) {
			candidates.push(candidate);
		}

		if (Array.isArray(value)) {
			for (const item of value.slice(0, 80)) {
				visit(item, depth + 1);
			}
			return;
		}

		if (value instanceof Map) {
			for (const entryValue of Array.from(value.values()).slice(0, 80)) {
				visit(entryValue, depth + 1);
			}
			return;
		}

		if (value instanceof Set) {
			for (const entryValue of Array.from(value.values()).slice(0, 80)) {
				visit(entryValue, depth + 1);
			}
			return;
		}

		const record = value as Record<string, unknown>;
		const keys = prioritizeKeys(Object.keys(record)).slice(0, 80);
		for (const key of keys) {
			visit(record[key], depth + 1);
		}
	};

	visit(root, 0);
	return candidates;
}

function createInternalAnchorCandidate(
	value: object,
	canvasRect: DOMRect,
): AnchorCandidate | null {
	const values = getObjectCandidateValues(value);
	if (!values.length) {
		return null;
	}

	const element = getEmbeddedElement(value);
	if (element) {
		const rect = element.getBoundingClientRect();
		if (rect.width || rect.height) {
			return {
				values,
				x: rect.left + rect.width / 2 - canvasRect.left,
				y: rect.top + rect.height / 2 - canvasRect.top,
				score: 10,
			};
		}
	}

	return null;
}

function collectDomAnchorCandidates(
	hostEl: HTMLElement | null,
	canvasRect: DOMRect,
	loose: boolean,
): AnchorCandidate[] {
	if (!hostEl) {
		return [];
	}

	const selector = loose
		? [
				".graph-view-node",
				".graph-node",
				"svg [data-path]",
				"svg [data-node-id]",
				"svg g",
				"svg title",
				"svg text",
			].join(", ")
		: [
				".graph-view-node[data-path]",
				".graph-view-node[data-node-id]",
				".graph-node[data-path]",
				".graph-node[data-node-id]",
				"svg [data-path]",
				"svg [data-node-id]",
				"svg g[data-path]",
				"svg g[data-node-id]",
			].join(", ");

	return Array.from(
		hostEl.querySelectorAll<HTMLElement | SVGElement>(selector),
	)
		.map((candidate) => createDomAnchorCandidate(candidate, canvasRect))
		.filter((candidate): candidate is AnchorCandidate => candidate !== null);
}

function createDomAnchorCandidate(
	candidate: HTMLElement | SVGElement,
	canvasRect: DOMRect,
): AnchorCandidate | null {
	if (candidate.closest(".semantic-graph-core-overlay")) {
		return null;
	}

	const values = getDomCandidateValues(candidate);
	if (!values.length) {
		return null;
	}

	const measurableElement = getMeasurableAnchorElement(candidate);
	if (!measurableElement) {
		return null;
	}

	const rect = measurableElement.getBoundingClientRect();
	if (!rect.width && !rect.height) {
		return null;
	}

	return {
		values,
		x: rect.left + rect.width / 2 - canvasRect.left,
		y: rect.top + rect.height / 2 - canvasRect.top,
		score: getDomCandidateBaseScore(candidate),
	};
}

function matchDocumentNode(
	candidateValues: string[],
	documentNodes: SemanticGraphNode[],
	uniqueBasenames: Map<string, SemanticGraphNode>,
): { node: SemanticGraphNode; score: number } | null {
	for (const value of candidateValues) {
		for (const node of documentNodes) {
			if (value === normalizePath(node.filePath)) {
				return { node, score: 8 };
			}
		}

		const basenameMatch = uniqueBasenames.get(stripMarkdownExtension(value));
		if (basenameMatch) {
			return { node: basenameMatch, score: 4 };
		}
	}

	return null;
}

function getDomCandidateValues(candidate: HTMLElement | SVGElement): string[] {
	const rawValues = [
		candidate.getAttribute("data-path"),
		candidate.getAttribute("data-node-id"),
		candidate.getAttribute("aria-label"),
		candidate.querySelector("title")?.textContent,
		candidate.textContent,
	];

	return normalizeCandidateValues(rawValues);
}

function getObjectCandidateValues(value: object): string[] {
	const record = value as Record<string, unknown>;
	const rawValues: unknown[] = [
		record.path,
		record.id,
		record.filePath,
		record.filepath,
		record.name,
		record.label,
		record.text,
		record.title,
	];

	const fileValue = record.file;
	if (fileValue && typeof fileValue === "object") {
		const fileRecord = fileValue as Record<string, unknown>;
		rawValues.push(fileRecord.path, fileRecord.basename, fileRecord.name);
	}

	return normalizeCandidateValues(rawValues);
}

function normalizeCandidateValues(values: unknown[]): string[] {
	return values
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.map((value) => normalizePath(value));
}

function getMeasurableAnchorElement(
	candidate: HTMLElement | SVGElement,
): HTMLElement | SVGGraphicsElement | null {
	if (candidate instanceof HTMLElement) {
		const graphNode = candidate.closest<HTMLElement>(".graph-view-node, .graph-node");
		return graphNode ?? candidate;
	}

	if (candidate instanceof SVGGraphicsElement) {
		const graphGroup = candidate.closest("g");
		return graphGroup instanceof SVGGraphicsElement ? graphGroup : candidate;
	}

	return candidate.parentElement instanceof HTMLElement
		? candidate.parentElement
		: null;
}

function getEmbeddedElement(value: object): HTMLElement | SVGGraphicsElement | null {
	const record = value as Record<string, unknown>;
	const keys = ["el", "element", "dom", "containerEl", "textEl", "circle", "label"];

	for (const key of keys) {
		const candidate = record[key];
		if (candidate instanceof HTMLElement) {
			return candidate;
		}

		if (candidate instanceof SVGGraphicsElement) {
			return candidate;
		}
	}

	return null;
}

function getDomCandidateBaseScore(candidate: HTMLElement | SVGElement): number {
	if (candidate.hasAttribute("data-path")) {
		return 9;
	}

	if (candidate.hasAttribute("data-node-id")) {
		return 8;
	}

	return candidate.tagName.toLowerCase() === "text" ? 4 : 5;
}

function setAnchor(
	anchors: Map<string, { x: number; y: number; score: number }>,
	nodeId: string,
	x: number,
	y: number,
	score: number,
) {
	const existingAnchor = anchors.get(nodeId);
	if (existingAnchor && existingAnchor.score >= score) {
		return;
	}

	anchors.set(nodeId, { x, y, score });
}

function prioritizeKeys(keys: string[]): string[] {
	const preferredOrder = [
		"renderer",
		"graph",
		"engine",
		"state",
		"nodes",
		"nodeLookup",
		"nodeMap",
		"data",
		"view",
		"currentViewData",
	];
	const preferred = preferredOrder.filter((key) => keys.includes(key));
	const remaining = keys.filter(
		(key) =>
			!preferred.includes(key) &&
			key !== "app" &&
			key !== "containerEl" &&
			key !== "ownerDocument" &&
			key !== "parent",
	);
	return [...preferred, ...remaining];
}

function getUniqueBasenameMap(
	documentNodes: SemanticGraphNode[],
): Map<string, SemanticGraphNode> {
	const basenames = new Map<string, SemanticGraphNode | null>();

	for (const node of documentNodes) {
		const basename = stripMarkdownExtension(normalizePath(node.label));
		if (!basename) {
			continue;
		}

		if (basenames.has(basename)) {
			basenames.set(basename, null);
			continue;
		}

		basenames.set(basename, node);
	}

	return new Map(
		Array.from(basenames.entries()).filter(
			(entry): entry is [string, SemanticGraphNode] => entry[1] !== null,
		),
	);
}

function normalizePath(value: string): string {
	return value.trim().replace(/\\/g, "/").toLowerCase();
}

function stripMarkdownExtension(value: string): string {
	return value.endsWith(".md") ? value.slice(0, -3) : value;
}
