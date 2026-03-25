import type {
	PositionedSemanticGraphNode,
	SemanticGraphData,
	SemanticGraphNode,
} from "./types";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const DOCUMENT_X_RATIO = 0.28;
const BULLET_X_RATIO = 0.72;
const ITERATIONS = 140;
const REPULSION_STRENGTH = 18000;
const SPRING_STRENGTH = 0.0035;
const CENTERING_STRENGTH = 0.04;
const MAX_STEP = 18;
const PADDING = 56;

export function computeGraphLayout(
	data: SemanticGraphData,
	width: number,
	height: number,
	fixedNodePositions: ReadonlyMap<string, { x: number; y: number }> = new Map(),
): PositionedSemanticGraphNode[] {
	const resolvedWidth = Math.max(width, MIN_WIDTH);
	const resolvedHeight = Math.max(height, MIN_HEIGHT);
	const nodes = data.nodes.map((node) => ({
		...node,
		x: fixedNodePositions.get(node.id)?.x ?? getInitialX(node, resolvedWidth),
		y: fixedNodePositions.get(node.id)?.y ?? getInitialY(node, resolvedHeight),
	}));
	const nodesById = new Map(nodes.map((node) => [node.id, node]));

	for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
		const displacement = new Map<string, { x: number; y: number }>();
		for (const node of nodes) {
			displacement.set(node.id, { x: 0, y: 0 });
		}

		for (let index = 0; index < nodes.length; index += 1) {
			const source = nodes[index];
			if (!source) {
				continue;
			}

			for (let offset = index + 1; offset < nodes.length; offset += 1) {
				const target = nodes[offset];
				if (!target) {
					continue;
				}

				const deltaX = source.x - target.x;
				const deltaY = source.y - target.y;
				const distanceSquared = Math.max(
					deltaX * deltaX + deltaY * deltaY,
					36,
				);
				const force = REPULSION_STRENGTH / distanceSquared;
				const distance = Math.sqrt(distanceSquared);
				const forceX = (deltaX / distance) * force;
				const forceY = (deltaY / distance) * force;

				accumulate(displacement, source.id, forceX, forceY);
				accumulate(displacement, target.id, -forceX, -forceY);
			}
		}

		for (const edge of data.edges) {
			const source = nodesById.get(edge.source);
			const target = nodesById.get(edge.target);
			if (!source || !target) {
				continue;
			}

			const deltaX = target.x - source.x;
			const deltaY = target.y - source.y;
			const distance = Math.max(Math.sqrt(deltaX * deltaX + deltaY * deltaY), 1);
			const desiredLength = edge.kind === "contains" ? 170 : 120;
			const force = (distance - desiredLength) * SPRING_STRENGTH;
			const forceX = (deltaX / distance) * force;
			const forceY = (deltaY / distance) * force;

			accumulate(displacement, source.id, forceX, forceY);
			accumulate(displacement, target.id, -forceX, -forceY);
		}

		for (const node of nodes) {
			if (fixedNodePositions.has(node.id)) {
				continue;
			}

			const targetX =
				node.kind === "document"
					? resolvedWidth * DOCUMENT_X_RATIO
					: resolvedWidth * BULLET_X_RATIO;
			const targetY = resolvedHeight / 2;
			const pullX = (targetX - node.x) * CENTERING_STRENGTH;
			const pullY = (targetY - node.y) * (CENTERING_STRENGTH / 2);

			accumulate(displacement, node.id, pullX, pullY);
		}

		for (const node of nodes) {
			if (fixedNodePositions.has(node.id)) {
				const fixedPosition = fixedNodePositions.get(node.id);
				if (!fixedPosition) {
					continue;
				}

				node.x = fixedPosition.x;
				node.y = fixedPosition.y;
				continue;
			}

			const delta = displacement.get(node.id);
			if (!delta) {
				continue;
			}

			node.x = clamp(node.x + clamp(delta.x, -MAX_STEP, MAX_STEP), PADDING, resolvedWidth - PADDING);
			node.y = clamp(node.y + clamp(delta.y, -MAX_STEP, MAX_STEP), PADDING, resolvedHeight - PADDING);
		}
	}

	return nodes;
}

function getInitialX(node: SemanticGraphNode, width: number): number {
	const bias = node.kind === "document" ? DOCUMENT_X_RATIO : BULLET_X_RATIO;
	return width * bias + hashString(node.id) % 60 - 30;
}

function getInitialY(node: SemanticGraphNode, height: number): number {
	const usableHeight = Math.max(height - PADDING * 2, 1);
	return PADDING + (hashString(`${node.id}:y`) % usableHeight);
}

function hashString(value: string): number {
	let hash = 0;

	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}

	return hash;
}

function accumulate(
	displacement: Map<string, { x: number; y: number }>,
	nodeId: string,
	x: number,
	y: number,
) {
	const current = displacement.get(nodeId);
	if (!current) {
		return;
	}

	current.x += x;
	current.y += y;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
