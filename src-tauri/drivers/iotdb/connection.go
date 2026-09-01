package iotdb

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/apache/iotdb-client-go/v2/client"
)

const DefaultPort = 6667

type ConnectionConfig struct {
	Host               string
	Port               int
	Nodes              []string
	Username           string
	Password           string
	Database           string
	Dialect            string
	FetchSize          int
	TimeZone           string
	TLS                bool
	InsecureSkipVerify bool
	TLSCAFile          string
	TLSCertFile        string
	TLSKeyFile         string
	EnableCompression  bool
	ConnectRetryMax    int
	ConnectTimeoutMS   int
}

// ParseConnectionConfig accepts the opaque URL supplied by the signed-package
// Host. It does not retain or log it. Tree/Table dialect selection remains
// explicit because IoTDB applies database context only in Table SQL.
func ParseConnectionConfig(raw string, options map[string]string) (ConnectionConfig, error) {
	config := ConnectionConfig{
		Host:             "127.0.0.1",
		Port:             DefaultPort,
		Username:         "root",
		Password:         "root",
		Dialect:          TreeDialect,
		FetchSize:        1024,
		TimeZone:         client.DefaultTimeZone,
		ConnectRetryMax:  client.DefaultConnectRetryMax,
		ConnectTimeoutMS: 15_000,
	}
	value := strings.TrimSpace(strings.TrimPrefix(raw, "jdbc:"))
	if value == "" {
		return config, fmt.Errorf("IoTDB connection URL is required")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return config, fmt.Errorf("parse IoTDB URL: %w", err)
	}
	if parsed.Scheme != "" && !strings.EqualFold(parsed.Scheme, "iotdb") {
		return config, fmt.Errorf("unsupported IoTDB URL scheme: %s", parsed.Scheme)
	}
	if parsed.Hostname() != "" {
		config.Host = parsed.Hostname()
	}
	if parsed.Port() != "" {
		port, err := strconv.Atoi(parsed.Port())
		if err != nil || port < 1 || port > 65535 {
			return config, fmt.Errorf("invalid IoTDB port")
		}
		config.Port = port
	}
	if parsed.User != nil {
		if username := parsed.User.Username(); username != "" {
			config.Username = username
		}
		if password, ok := parsed.User.Password(); ok {
			config.Password = password
		}
	}
	config.Database = strings.Trim(parsed.Path, "/")
	query := parsed.Query()
	for key, value := range options {
		if strings.TrimSpace(value) != "" {
			query.Set(key, value)
		}
	}
	if value := first(query, "sql_dialect", "dialect"); value != "" {
		switch strings.ToLower(value) {
		case TreeDialect, TableDialect:
			config.Dialect = strings.ToLower(value)
		default:
			return config, fmt.Errorf("unsupported IoTDB SQL dialect: %s", value)
		}
	}
	if value := first(query, "database", "db"); value != "" {
		config.Database = value
	}
	if value := first(query, "fetch_size", "fetchSize"); value != "" {
		size, err := positive(value)
		if err != nil {
			return config, fmt.Errorf("invalid IoTDB fetch size")
		}
		config.FetchSize = size
	}
	if value := first(query, "time_zone", "timezone", "zone_id"); value != "" {
		config.TimeZone = value
	}
	config.TLS = truthy(first(query, "ssl", "useSSL", "use_ssl", "tls"))
	config.InsecureSkipVerify = truthy(first(query, "insecure_skip_verify", "tls_insecure_skip_verify"))
	config.TLSCAFile = first(query, "ssl_ca", "tls_ca_file", "ca_file")
	config.TLSCertFile = first(query, "ssl_cert", "tls_cert_file", "cert_file")
	config.TLSKeyFile = first(query, "ssl_key", "tls_key_file", "key_file")
	if (config.TLSCertFile == "") != (config.TLSKeyFile == "") {
		return config, fmt.Errorf("IoTDB TLS client certificate and key must be provided together")
	}
	config.EnableCompression = truthy(first(query, "rpc_compression", "enable_compression", "compression"))
	if value := first(query, "connect_retry_max", "connectRetryMax"); value != "" {
		retries, err := positive(value)
		if err != nil {
			return config, fmt.Errorf("invalid IoTDB connect retry maximum")
		}
		config.ConnectRetryMax = retries
	}
	if value := first(query, "connect_timeout_ms", "connection_timeout_ms"); value != "" {
		timeout, err := positive(value)
		if err != nil {
			return config, fmt.Errorf("invalid IoTDB connect timeout")
		}
		config.ConnectTimeoutMS = timeout
	}
	config.Nodes = splitNodes(first(query, "node_urls", "nodes"))
	if len(config.Nodes) == 0 {
		config.Nodes = []string{net.JoinHostPort(config.Host, strconv.Itoa(config.Port))}
	}
	for _, node := range config.Nodes {
		_, port, err := net.SplitHostPort(node)
		if err != nil {
			return config, fmt.Errorf("invalid IoTDB node URL %q: %w", node, err)
		}
		parsed, err := strconv.Atoi(port)
		if err != nil || parsed < 1 || parsed > 65535 {
			return config, fmt.Errorf("invalid IoTDB node URL port %q", port)
		}
	}
	return config, nil
}

func first(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}
func truthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
func positive(value string) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return 0, err
	}
	return parsed, nil
}
func splitNodes(value string) []string {
	result := []string{}
	for _, node := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ';' }) {
		if node = strings.TrimSpace(node); node != "" {
			result = append(result, node)
		}
	}
	return result
}
