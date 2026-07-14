# ADR-0008: Bounded, precision-safe selection aggregates

- Status: Accepted
- Date: 2026-07-15
- Scope: DG-P1 Data Editor Aggregate View

## Context

DataGrip exposes aggregate values while users select cells. A naive React implementation can rescan a large result on every pointer-move event, freeze the canvas grid, and silently corrupt `bigint`/`numeric` values by summing them as JavaScript `number`. Selection can also combine rectangular ranges, row markers, and column markers, so cells must be deduplicated. Existing and newly inserted rows distinguish real SQL `NULL` from an unavailable/default value.

## Decision

`DataGrid` converts Glide's current range, range stack, selected rows, and selected columns into a deduplicated coordinate list. Collection stops after 50,000 cells and marks the aggregate as truncated. React `useDeferredValue` moves aggregate recalculation out of the urgent selection render path. The deferred selection carries its `tabId` and result index; stale selection from a switched tab/result is discarded, and the live selection is reset on either context change.

The pure aggregate domain layer reports sampled cells, non-NULL values, SQL NULL values, unavailable/default cells, structural distinct values, and numeric values. Numeric type recognition comes from result/column metadata. Text that happens to contain digits is not coerced.

Finite integer, decimal, real, and float representations are parsed into a bounded `BigInt coefficient + decimal scale` form. Sum, comparison, min, and max therefore do not cross JavaScript's safe-integer boundary. Average is rounded to at most twelve fractional digits. Numeric text longer than 256 characters or requiring an absolute scale above 1,000 is excluded from numeric aggregation to keep work and rendered output bounded; it still participates in count/distinct metrics.

The result appears as a compact bottom-right overlay for both table tabs and query result grids. A single selected cell does not open the overlay. Truncated results use `Cells ≥` so sampled values are never presented as complete aggregates.

## Consequences

- Drag selection remains responsive for normal pages and has a hard upper computation budget.
- Database `bigint` and `numeric` values do not lose precision through binary floating-point addition.
- Mixed text/numeric selections produce count/distinct for all values and numeric metrics only for typed numeric cells.
- Aggregate values cover the loaded/filtered result surface, not all rows on the server. Server-wide aggregates remain an explicit SQL/query workflow.
- Large LOB-aware hashing and user-configurable aggregate functions remain future enhancements.
