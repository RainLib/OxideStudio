import {
  diagramColumnOffset,
  type SchemaDiagramEdge,
  type SchemaDiagramNode,
} from "@/lib/schemaDiagram";

export function DiagramEdges({
  nodesByName,
  edges,
  selectedRelation,
}: {
  nodesByName: ReadonlyMap<string, SchemaDiagramNode>;
  edges: SchemaDiagramEdge[];
  selectedRelation: string | null;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      {edges.map((edge) => {
        const source = nodesByName.get(edge.sourceRelation);
        const target = nodesByName.get(edge.targetRelation);
        if (!source || !target) return null;
        const targetOnRight = target.x > source.x;
        const sourceX = targetOnRight ? source.x + source.width : source.x;
        const targetX = targetOnRight ? target.x : target.x + target.width;
        const sourceY =
          source.y + diagramColumnOffset(source, edge.sourceColumns[0]);
        const targetY =
          target.y + diagramColumnOffset(target, edge.targetColumns[0]);
        const middleX = (sourceX + targetX) / 2;
        const selected =
          selectedRelation === edge.sourceRelation ||
          selectedRelation === edge.targetRelation;
        return (
          <g key={edge.id}>
            <title>{`${edge.constraintName}: ${edge.sourceRelation}.${edge.sourceColumns.join(",")} → ${edge.targetRelation}.${edge.targetColumns.join(",")}`}</title>
            <path
              d={`M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}`}
              fill="none"
              stroke={
                selected
                  ? "hsl(var(--wb-accent))"
                  : "hsl(var(--wb-text-muted) / 0.42)"
              }
              strokeWidth={selected ? 1.8 : 1.15}
            />
            <circle
              cx={sourceX}
              cy={sourceY}
              r={selected ? 3 : 2.25}
              fill={
                selected ? "hsl(var(--wb-accent))" : "hsl(var(--wb-text-muted))"
              }
            />
            <path
              d={
                targetOnRight
                  ? `M ${targetX - 6} ${targetY - 4} L ${targetX} ${targetY} L ${targetX - 6} ${targetY + 4}`
                  : `M ${targetX + 6} ${targetY - 4} L ${targetX} ${targetY} L ${targetX + 6} ${targetY + 4}`
              }
              fill="none"
              stroke={
                selected ? "hsl(var(--wb-accent))" : "hsl(var(--wb-text-muted))"
              }
              strokeWidth={selected ? 1.8 : 1.15}
            />
          </g>
        );
      })}
    </svg>
  );
}
