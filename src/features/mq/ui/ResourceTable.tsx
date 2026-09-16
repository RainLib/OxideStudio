export function ResourceTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))]">
      <div
        className="grid bg-[hsl(var(--wb-toolbar))] text-[10px] font-medium uppercase tracking-wide wb-muted"
        style={{
          gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))`,
        }}
      >
        {headers.map((header) => (
          <div key={header} className="px-3 py-2">
            {header}
          </div>
        ))}
      </div>
      {rows.length ? (
        rows.map((row, index) => (
          <div
            key={`${row.join("-")}-${index}`}
            className="grid border-t border-[hsl(var(--wb-border-subtle))] text-xs"
            style={{
              gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))`,
            }}
          >
            {row.map((cell, cellIndex) => (
              <div
                key={`${cell}-${cellIndex}`}
                className="truncate px-3 py-2"
                title={cell}
              >
                {cell || "—"}
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="p-3 text-xs wb-muted">{empty}</div>
      )}
    </div>
  );
}
