import { App, TFile } from "obsidian";
import { parseBulletMetadataLine, readMarkdownFileContent } from "../metadata";
import type { SemanticGraphData, SemanticGraphEdge, SemanticGraphNode } from "./types";

export async function buildSemanticGraphData(app: App): Promise<SemanticGraphData> {
	const nodes = new Map<string, SemanticGraphNode>();
	const edges = new Map<string, SemanticGraphEdge>();
	const files = app.vault
		.getMarkdownFiles()
		.slice()
		.sort((left, right) => left.path.localeCompare(right.path));

	for (const file of files) {
		await addFileGraphData(app, file, nodes, edges);
	}

	const filteredEdges = Array.from(edges.values()).filter(
		(edge) => nodes.has(edge.source) && nodes.has(edge.target),
	);

	return {
		nodes: Array.from(nodes.values()).sort(compareNodes),
		edges: filteredEdges.sort(compareEdges),
	};
}

async function addFileGraphData(
	app: App,
	file: TFile,
	nodes: Map<string, SemanticGraphNode>,
	edges: Map<string, SemanticGraphEdge>,
) {
	const documentNodeId = file.path;
	const content = await readMarkdownFileContent(app, file);
	const lines = content.split(/\r?\n/);
	let hasBulletMetadata = false;

	for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
		const lineText = lines[lineNumber];
		if (lineText === undefined) {
			continue;
		}

		const parsedBullet = parseBulletMetadataLine(lineText);
		if (!parsedBullet) {
			continue;
		}

		if (!hasBulletMetadata) {
			hasBulletMetadata = true;
			nodes.set(documentNodeId, {
				id: documentNodeId,
				kind: "document",
				label: file.basename,
				filePath: file.path,
			});
		}

		const bulletNodeId = parsedBullet.metadata.id;
		nodes.set(bulletNodeId, {
			id: bulletNodeId,
			kind: "bullet",
			label: parsedBullet.text || `Bullet ${lineNumber + 1}`,
			filePath: file.path,
			lineNumber,
			metadataType: parsedBullet.metadata.type,
		});

		const containsEdgeId = `contains:${documentNodeId}->${bulletNodeId}`;
		edges.set(containsEdgeId, {
			id: containsEdgeId,
			source: documentNodeId,
			target: bulletNodeId,
			kind: "contains",
		});

		for (const metadataLink of parsedBullet.metadata.links) {
			const semanticEdgeId = `semantic:${bulletNodeId}->${metadataLink.target}:${metadataLink.type}`;
			edges.set(semanticEdgeId, {
				id: semanticEdgeId,
				source: bulletNodeId,
				target: metadataLink.target,
				kind: "semantic",
				label: metadataLink.type,
			});
		}
	}
}

function compareNodes(left: SemanticGraphNode, right: SemanticGraphNode): number {
	if (left.kind !== right.kind) {
		return left.kind.localeCompare(right.kind);
	}

	if (left.filePath !== right.filePath) {
		return left.filePath.localeCompare(right.filePath);
	}

	return left.label.localeCompare(right.label);
}

function compareEdges(left: SemanticGraphEdge, right: SemanticGraphEdge): number {
	if (left.kind !== right.kind) {
		return left.kind.localeCompare(right.kind);
	}

	return left.id.localeCompare(right.id);
}
