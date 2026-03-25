export type SemanticGraphNodeKind = "document" | "bullet";

export type SemanticGraphEdgeKind = "contains" | "semantic";

export interface SemanticGraphNode {
	id: string;
	kind: SemanticGraphNodeKind;
	label: string;
	filePath: string;
	lineNumber?: number;
	metadataType?: string;
}

export interface SemanticGraphEdge {
	id: string;
	source: string;
	target: string;
	kind: SemanticGraphEdgeKind;
	label?: string;
}

export interface SemanticGraphData {
	nodes: SemanticGraphNode[];
	edges: SemanticGraphEdge[];
}

export interface PositionedSemanticGraphNode extends SemanticGraphNode {
	x: number;
	y: number;
}
