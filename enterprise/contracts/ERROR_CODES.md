# Enterprise error codes

| Code | Meaning | Retry |
| --- | --- | --- |
| `INVALID_REQUEST` | Input or scope is malformed. | Correct input |
| `ACCESS_DENIED` | Membership, assignment, policy, action, or resource denied access. | Do not retry unchanged |
| `INTERNAL_ERROR` | Control-plane processing failed without exposing internals. | Bounded retry |

The Gateway additionally uses standard gRPC status codes:

- `PERMISSION_DENIED` for ticket, policy revision, SQL-object, or scope failures.
- `FAILED_PRECONDITION` for a driver without the requested safe capability.
- `RESOURCE_EXHAUSTED` for row or byte limits.
- `UNAVAILABLE` for Gateway-local credential or database availability.
