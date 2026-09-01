package iotdb

import (
	"fmt"
	"strings"
)

// MetadataStatement maps the Host's descriptor request into the narrow IoTDB
// statements supported by the current dialect. Identifiers are validated and
// quoted here rather than allowing a renderer to provide executable SQL.
func MetadataStatement(dialect, kind, schema, relation string) (string, error) {
	schema = strings.TrimSpace(schema)
	relation = strings.TrimSpace(relation)
	switch kind {
	case "databases", "schemas":
		return "SHOW DATABASES", nil
	case "relations":
		if dialect == TableDialect {
			return "SHOW TABLES DETAILS FROM " + quote(schema), nil
		}
		return "SHOW DEVICES " + treePath(schema, "**"), nil
	case "columns":
		if relation == "" {
			return "", fmt.Errorf("IoTDB relation is required")
		}
		if dialect == TableDialect {
			return "DESC " + quote(schema) + "." + quote(relation) + " DETAILS", nil
		}
		return "SHOW TIMESERIES " + treePath(schema, relation, "**"), nil
	default:
		return "", fmt.Errorf("unsupported IoTDB metadata request: %s", kind)
	}
}

func treePath(parts ...string) string {
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(strings.TrimSpace(part), ".")
		if part == "" {
			continue
		}
		if part == "**" {
			result = append(result, part)
			continue
		}
		result = append(result, "`"+strings.ReplaceAll(part, "`", "``")+"`")
	}
	return strings.Join(result, ".")
}
