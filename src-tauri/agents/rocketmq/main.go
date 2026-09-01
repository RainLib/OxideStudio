// oxide-agent-rocketmq is the dedicated RocketMQ workspace agent.  It is
// deliberately separate from the database-driver sidecar protocol: RocketMQ
// exposes operational resources rather than SQL tables.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

const (
	maxRPCMessageBytes = 32 * 1024 * 1024
	maxNameServers     = 16
	defaultTimeout     = 10 * time.Second
)

var capabilities = []string{
	"mq_connect", "mq_test_connection", "mq_describe_cluster", "mq_list_topics",
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}
type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type connectionConfig struct {
	NameServers []string
	Timeout     time.Duration
}

type rocketMQAgent struct {
	mu       sync.RWMutex
	client   *admin.Client
	config   connectionConfig
	shutdown bool
}

func main() {
	agent := &rocketMQAgent{}
	defer agent.close()
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(map[string]bool{"ready": true})

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), maxRPCMessageBytes)
	for scanner.Scan() {
		var request rpcRequest
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			_ = encoder.Encode(rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{Code: -32700, Message: err.Error()}})
			continue
		}
		result, err := agent.dispatch(request.Method, request.Params)
		response := rpcResponse{JSONRPC: "2.0", ID: request.ID}
		if len(response.ID) == 0 {
			response.ID = json.RawMessage("null")
		}
		if err != nil {
			response.Error = &rpcError{Code: -1, Message: err.Error()}
		} else {
			response.Result = result
		}
		if err := encoder.Encode(response); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return
		}
		if agent.shutdown {
			return
		}
	}
}

func (a *rocketMQAgent) dispatch(method string, raw json.RawMessage) (any, error) {
	params := map[string]any{}
	if len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
	}
	switch method {
	case "handshake":
		return map[string]any{"protocolVersion": 1, "agentProtocolVersion": 1, "capabilities": capabilities}, nil
	case "connect":
		return a.connect(params, true)
	case "test_connection":
		return a.connect(params, false)
	case "disconnect":
		a.close()
		return map[string]bool{"ok": true}, nil
	case "shutdown":
		a.close()
		a.shutdown = true
		return map[string]bool{"ok": true}, nil
	case "mq_describe_cluster":
		return a.describeCluster()
	case "mq_list_topics":
		return a.listTopics(params)
	default:
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

func parseConnection(params map[string]any) (connectionConfig, error) {
	value := params
	if nested, ok := params["connection"].(map[string]any); ok {
		value = nested
	}
	raw, _ := value["namesrv_addr"].(string)
	if strings.TrimSpace(raw) == "" {
		raw, _ = value["namesrvAddr"].(string)
	}
	servers, err := normalizeNameServers(raw)
	if err != nil {
		return connectionConfig{}, err
	}
	timeout := defaultTimeout
	number, ok := value["connect_timeout_ms"].(float64)
	if !ok {
		number, ok = value["connectTimeoutMs"].(float64)
	}
	if ok && number > 0 {
		timeout = time.Duration(number) * time.Millisecond
	}
	return connectionConfig{NameServers: servers, Timeout: timeout}, nil
}

func normalizeNameServers(raw string) ([]string, error) {
	seen := map[string]struct{}{}
	servers := make([]string, 0)
	for _, part := range strings.FieldsFunc(raw, func(char rune) bool {
		return char == ',' || char == ';' || char == '\n' || char == '\r' || char == '\t' || char == ' '
	}) {
		endpoint := strings.TrimSpace(part)
		if endpoint == "" {
			continue
		}
		if strings.Contains(endpoint, "//") || strings.ContainsAny(endpoint, "/?#") {
			return nil, fmt.Errorf("namesrv_addr entries must be host:port values")
		}
		if host, port, err := net.SplitHostPort(endpoint); err == nil {
			parsed, portErr := strconv.ParseUint(port, 10, 16)
			if strings.TrimSpace(host) == "" || portErr != nil || parsed == 0 {
				return nil, fmt.Errorf("invalid RocketMQ NameServer address %q", endpoint)
			}
		} else {
			if strings.Count(endpoint, ":") != 1 {
				return nil, fmt.Errorf("invalid RocketMQ NameServer address %q", endpoint)
			}
			host, port, found := strings.Cut(endpoint, ":")
			if !found || strings.TrimSpace(host) == "" {
				return nil, fmt.Errorf("invalid RocketMQ NameServer address %q", endpoint)
			}
			parsed, portErr := strconv.ParseUint(port, 10, 16)
			if portErr != nil || parsed == 0 {
				return nil, fmt.Errorf("invalid RocketMQ NameServer address %q", endpoint)
			}
		}
		if _, exists := seen[endpoint]; !exists {
			seen[endpoint] = struct{}{}
			servers = append(servers, endpoint)
		}
		if len(servers) > maxNameServers {
			return nil, fmt.Errorf("at most %d RocketMQ NameServer addresses are allowed", maxNameServers)
		}
	}
	if len(servers) == 0 {
		return nil, fmt.Errorf("namesrv_addr is required")
	}
	return servers, nil
}

func (a *rocketMQAgent) connect(params map[string]any, persist bool) (any, error) {
	config, err := parseConnection(params)
	if err != nil {
		return nil, err
	}
	client, err := admin.NewClient(admin.WithNameServers(config.NameServers), admin.WithTimeout(config.Timeout), admin.WithRetryTimes(1))
	if err != nil {
		return nil, err
	}
	if err := client.Start(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	info, err := client.ExamineBrokerClusterInfo(ctx)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	result := clusterResult(info)
	if !persist {
		_ = client.Close()
		return result, nil
	}
	a.mu.Lock()
	previous := a.client
	a.client, a.config = client, config
	a.mu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	return result, nil
}

func (a *rocketMQAgent) connected() (*admin.Client, connectionConfig, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.client == nil {
		return nil, connectionConfig{}, fmt.Errorf("RocketMQ agent is not connected")
	}
	return a.client, a.config, nil
}

func (a *rocketMQAgent) describeCluster() (any, error) {
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	info, err := client.ExamineBrokerClusterInfo(ctx)
	if err != nil {
		return nil, err
	}
	return clusterResult(info), nil
}

func clusterResult(info *admin.ClusterInfo) map[string]any {
	brokers := make([]map[string]any, 0)
	if info != nil {
		for _, name := range sortedKeys(info.BrokerAddrTable) {
			broker := info.BrokerAddrTable[name]
			if broker == nil {
				continue
			}
			for _, id := range sortedKeys(broker.BrokerAddrs) {
				role := "SLAVE"
				if id == "0" {
					role = "MASTER"
				}
				brokers = append(brokers, map[string]any{"brokerName": broker.BrokerName, "brokerId": id, "address": broker.BrokerAddrs[id], "role": role})
			}
		}
	}
	return map[string]any{"ok": true, "brokers": brokers, "nodeCount": len(brokers)}
}

func (a *rocketMQAgent) listTopics(params map[string]any) (any, error) {
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	topics, err := client.FetchAllTopicList(ctx)
	if err != nil {
		return nil, err
	}
	keyword, _ := params["keyword"].(string)
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	items := make([]string, 0, len(topics.TopicList))
	for _, topic := range topics.TopicList {
		if keyword == "" || strings.Contains(strings.ToLower(topic), keyword) {
			items = append(items, topic)
		}
	}
	sort.Strings(items)
	return map[string]any{"topics": items, "total": len(items), "offset": 0, "limit": len(items)}, nil
}

func (a *rocketMQAgent) close() {
	a.mu.Lock()
	client := a.client
	a.client = nil
	a.config = connectionConfig{}
	a.mu.Unlock()
	if client != nil {
		_ = client.Close()
	}
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
