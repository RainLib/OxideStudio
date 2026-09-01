// oxide-agent-rocketmq is the dedicated RocketMQ workspace agent.  It is
// deliberately separate from the database-driver sidecar protocol: RocketMQ
// exposes operational resources rather than SQL tables.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

const (
	maxRPCMessageBytes  = 32 * 1024 * 1024
	maxNameServers      = 16
	defaultTimeout      = 10 * time.Second
	maxPeekMessages     = 100
	maxMessageBodyBytes = 64 * 1024
	maxStatsPartitions  = 2048
	maxLagPartitions    = 4096
)

var capabilities = []string{
	"mq_connect", "mq_test_connection", "mq_describe_cluster", "mq_list_topics", "mq_describe_topic", "mq_get_topic_config", "mq_get_topic_stats", "mq_list_acls", "mq_peek_messages", "mq_query_message_by_key", "mq_query_message_by_time", "mq_consumer_groups", "mq_describe_consumer_group", "mq_get_consumer_lag",
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
	AccessKey   string
	SecretKey   string
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
	case "mq_describe_topic":
		return a.describeTopic(params)
	case "mq_get_topic_config":
		return a.getTopicConfig(params)
	case "mq_get_topic_stats":
		return a.getTopicStats(params)
	case "mq_list_acls":
		return a.listAcls(params)
	case "mq_peek_messages":
		return a.peekMessages(params)
	case "mq_query_message_by_key":
		return a.queryMessagesByKey(params)
	case "mq_query_message_by_time":
		return a.queryMessagesByTime(params)
	case "mq_list_consumer_groups":
		return a.listConsumerGroups(params)
	case "mq_describe_consumer_group":
		return a.describeConsumerGroup(params)
	case "mq_get_consumer_lag":
		return a.getConsumerLag(params)
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
	accessKey, _ := value["accessKey"].(string)
	secretKey, _ := value["secretKey"].(string)
	if strings.TrimSpace(accessKey) == "" && strings.TrimSpace(secretKey) != "" || strings.TrimSpace(accessKey) != "" && strings.TrimSpace(secretKey) == "" {
		return connectionConfig{}, fmt.Errorf("RocketMQ Access Key and Secret Key must be provided together")
	}
	return connectionConfig{NameServers: servers, Timeout: timeout, AccessKey: strings.TrimSpace(accessKey), SecretKey: strings.TrimSpace(secretKey)}, nil
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
	options := []admin.Option{admin.WithNameServers(config.NameServers), admin.WithTimeout(config.Timeout), admin.WithRetryTimes(1)}
	if config.AccessKey != "" {
		options = append(options, admin.WithACL(config.AccessKey, config.SecretKey))
	}
	client, err := admin.NewClient(options...)
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

// describeTopic exposes the live route rather than assuming that all brokers
// host the same number of queues.  That difference matters during expansion
// and broker recovery, so the console keeps the per-broker records intact.
func (a *rocketMQAgent) describeTopic(params map[string]any) (any, error) {
	topic, ok := params["topic"].(string)
	topic = strings.TrimSpace(topic)
	if !ok || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	return topicRouteResult(topic, route), nil
}

func topicRouteResult(topic string, route *admin.TopicRouteData) map[string]any {
	queues := make([]map[string]any, 0)
	brokers := make([]map[string]any, 0)
	if route != nil {
		for _, queue := range route.QueueDatas {
			if queue == nil {
				continue
			}
			queues = append(queues, map[string]any{
				"brokerName":     queue.BrokerName,
				"readQueueNums":  queue.ReadQueueNums,
				"writeQueueNums": queue.WriteQueueNums,
				"perm":           queue.Perm,
			})
		}
		for _, broker := range route.BrokerDatas {
			if broker == nil {
				continue
			}
			addresses := make(map[string]string, len(broker.BrokerAddrs))
			for id, address := range broker.BrokerAddrs {
				addresses[id] = address
			}
			brokers = append(brokers, map[string]any{
				"brokerName":  broker.BrokerName,
				"cluster":     broker.Cluster,
				"brokerAddrs": addresses,
			})
		}
	}
	sort.Slice(queues, func(left, right int) bool {
		return fmt.Sprint(queues[left]["brokerName"]) < fmt.Sprint(queues[right]["brokerName"])
	})
	sort.Slice(brokers, func(left, right int) bool {
		return fmt.Sprint(brokers[left]["brokerName"]) < fmt.Sprint(brokers[right]["brokerName"])
	})
	return map[string]any{"topic": topic, "queueDatas": queues, "brokerDatas": brokers}
}

// getTopicConfig reads each master independently. Configuration drift is a
// useful operational signal, so it is never collapsed to an arbitrary broker.
func (a *rocketMQAgent) getTopicConfig(params map[string]any) (any, error) {
	topic, ok := params["topic"].(string)
	topic = strings.TrimSpace(topic)
	if !ok || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	addresses := topicMasterAddresses(route)
	names := sortedKeys(addresses)
	configs := make([]map[string]any, 0, len(names))
	unavailable := make([]string, 0)
	for _, brokerName := range names {
		topicConfig, configErr := client.ExamineTopicConfig(ctx, addresses[brokerName], topic)
		if configErr != nil {
			unavailable = append(unavailable, brokerName)
			continue
		}
		configs = append(configs, map[string]any{
			"brokerName":      brokerName,
			"topicName":       valueOrDefault(topicConfig.TopicName, topic),
			"readQueueNums":   topicConfig.ReadQueueNums,
			"writeQueueNums":  topicConfig.WriteQueueNums,
			"perm":            topicConfig.Perm,
			"topicFilterType": topicConfig.TopicFilterType,
			"topicSysFlag":    topicConfig.TopicSysFlag,
			"order":           topicConfig.Order,
		})
	}
	if len(configs) == 0 && len(names) > 0 {
		return nil, fmt.Errorf("topic config is unavailable on all master brokers")
	}
	return map[string]any{
		"topic":              topic,
		"configs":            configs,
		"unavailableBrokers": unavailable,
	}, nil
}

func (a *rocketMQAgent) getTopicStats(params map[string]any) (any, error) {
	topic, ok := params["topic"].(string)
	topic = strings.TrimSpace(topic)
	if !ok || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	addresses := topicMasterAddresses(route)
	partitionCount := 0
	for _, queue := range route.QueueDatas {
		if queue != nil {
			partitionCount += queue.ReadQueueNums
		}
	}
	if partitionCount > maxStatsPartitions {
		return nil, fmt.Errorf("topic has %d partitions; stats are limited to %d", partitionCount, maxStatsPartitions)
	}
	rows := make([]map[string]any, 0, partitionCount)
	var total int64
	for _, queue := range route.QueueDatas {
		if queue == nil || addresses[queue.BrokerName] == "" {
			continue
		}
		for partition := 0; partition < queue.ReadQueueNums; partition++ {
			result, pullErr := client.PullMessage(ctx, addresses[queue.BrokerName], topic, partition, 0, 1)
			if pullErr != nil {
				return nil, fmt.Errorf("read stats for %s partition %d: %w", queue.BrokerName, partition, pullErr)
			}
			count := result.MaxOffset - result.MinOffset
			if count < 0 {
				count = 0
			}
			total += count
			rows = append(rows, map[string]any{"brokerName": queue.BrokerName, "partition": partition, "beginOffset": result.MinOffset, "endOffset": result.MaxOffset, "messageCount": count})
		}
	}
	sort.Slice(rows, func(left, right int) bool {
		if rows[left]["brokerName"].(string) != rows[right]["brokerName"].(string) {
			return rows[left]["brokerName"].(string) < rows[right]["brokerName"].(string)
		}
		return rows[left]["partition"].(int) < rows[right]["partition"].(int)
	})
	return map[string]any{"topic": topic, "partitions": rows, "totalMessages": total}, nil
}

// listAcls reads ACLs from every master broker. ACL configuration can drift
// between masters, so policy rows retain their source broker rather than
// silently deduplicating records from the first response.
func (a *rocketMQAgent) listAcls(_ map[string]any) (any, error) {
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
	masters := masterBrokerAddressByName(info)
	principalPolicies := map[string][]map[string]any{}
	descriptions := map[string]string{}
	unavailable := make([]string, 0)
	for _, brokerName := range sortedKeys(masters) {
		address := masters[brokerName]
		listed, listErr := client.ListAcl(ctx, address)
		if listErr != nil {
			unavailable = append(unavailable, brokerName)
			continue
		}
		for _, acl := range listed.Acls {
			if _, exists := descriptions[acl.Subject]; !exists {
				descriptions[acl.Subject] = acl.Description
			}
			for _, policy := range acl.Policies {
				principalPolicies[acl.Subject] = append(principalPolicies[acl.Subject], map[string]any{
					"brokerName": brokerName,
					"resource":   policy.Resource,
					"actions":    policy.Actions,
					"effect":     policy.Effect,
					"sourceIps":  policy.SourceIPs,
					"decision":   policy.Decision,
				})
			}
		}
	}
	if len(descriptions) == 0 && len(masters) > 0 && len(unavailable) == len(masters) {
		return nil, fmt.Errorf("ACLs are unavailable on all master brokers")
	}
	rows := make([]map[string]any, 0, len(descriptions))
	for _, principal := range sortedKeys(descriptions) {
		rows = append(rows, map[string]any{
			"principal":   principal,
			"description": descriptions[principal],
			"policies":    principalPolicies[principal],
		})
	}
	return map[string]any{"acls": rows, "unavailableBrokers": unavailable}, nil
}

// peekMessages is deliberately read-only and bounded. It pulls from concrete
// queues without registering a consumer or committing offsets.
func (a *rocketMQAgent) peekMessages(params map[string]any) (any, error) {
	topic, ok := params["topic"].(string)
	topic = strings.TrimSpace(topic)
	if !ok || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	limit := jsonInt(params["limit"], 20)
	if limit < 1 {
		limit = 20
	}
	if limit > maxPeekMessages {
		limit = maxPeekMessages
	}
	partition, hasPartition := params["partition"]
	partitionID := jsonInt(partition, 0)
	offset := int64(jsonInt(params["offset"], 0))
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	addresses := topicMasterAddresses(route)
	messages := make([]map[string]any, 0, limit)
	var nextOffset int64
	for _, queue := range route.QueueDatas {
		if queue == nil || (hasPartition && queue.ReadQueueNums <= partitionID) {
			continue
		}
		address := addresses[queue.BrokerName]
		if address == "" {
			continue
		}
		first, last := 0, queue.ReadQueueNums
		if hasPartition {
			first, last = partitionID, partitionID+1
		}
		for queueID := first; queueID < last && len(messages) < limit; queueID++ {
			result, pullErr := client.PullMessage(ctx, address, topic, queueID, offset, limit-len(messages))
			if pullErr != nil {
				continue
			}
			if result.NextBeginOffset > nextOffset {
				nextOffset = result.NextBeginOffset
			}
			for _, message := range result.Messages {
				if message == nil {
					continue
				}
				message.BrokerName = queue.BrokerName
				messages = append(messages, rocketMqMessageResult(message))
			}
		}
	}
	sort.Slice(messages, func(left, right int) bool {
		leftPartition, rightPartition := messages[left]["partition"].(int), messages[right]["partition"].(int)
		if leftPartition != rightPartition {
			return leftPartition < rightPartition
		}
		return messages[left]["offset"].(int64) < messages[right]["offset"].(int64)
	})
	return map[string]any{"topic": topic, "messages": messages, "nextOffset": nextOffset}, nil
}

func topicMasterAddresses(route *admin.TopicRouteData) map[string]string {
	addresses := map[string]string{}
	if route == nil {
		return addresses
	}
	for _, broker := range route.BrokerDatas {
		if broker != nil && broker.BrokerAddrs["0"] != "" {
			addresses[broker.BrokerName] = broker.BrokerAddrs["0"]
		}
	}
	return addresses
}

func rocketMqMessageResult(message *admin.MessageExt) map[string]any {
	body := message.Body
	truncated := len(body) > maxMessageBodyBytes
	if truncated {
		body = body[:maxMessageBodyBytes]
	}
	headers := make(map[string]string, len(message.Properties))
	for key, value := range message.Properties {
		headers[key] = value
	}
	result := map[string]any{
		"messageId":        message.MsgId,
		"offsetMessageId":  message.OffsetMsgId,
		"brokerName":       message.BrokerName,
		"topic":            message.Topic,
		"partition":        message.QueueId,
		"offset":           message.QueueOffset,
		"timestamp":        message.StoreTimestamp,
		"key":              message.Properties[primitive.PropertyKeys],
		"tag":              message.Properties[primitive.PropertyTags],
		"headers":          headers,
		"payloadBase64":    base64.StdEncoding.EncodeToString(body),
		"payloadTruncated": truncated,
	}
	if utf8.Valid(body) {
		result["payloadText"] = string(body)
	}
	return result
}

func (a *rocketMQAgent) queryMessagesByKey(params map[string]any) (any, error) {
	topic, topicOK := params["topic"].(string)
	key, keyOK := params["key"].(string)
	topic, key = strings.TrimSpace(topic), strings.TrimSpace(key)
	if !topicOK || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	if !keyOK || key == "" {
		return nil, fmt.Errorf("key is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	limit := jsonInt(params["limit"], 32)
	if limit < 1 {
		limit = 32
	}
	if limit > maxPeekMessages {
		limit = maxPeekMessages
	}
	begin := int64(jsonInt(params["beginTimestamp"], 0))
	end := int64(jsonInt(params["endTimestamp"], int(time.Now().UnixMilli())))
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	messages, err := client.QueryMessage(ctx, topic, key, limit, begin, end)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		if message != nil {
			rows = append(rows, rocketMqMessageResult(message))
		}
	}
	return map[string]any{"topic": topic, "key": key, "messages": rows}, nil
}

func (a *rocketMQAgent) queryMessagesByTime(params map[string]any) (any, error) {
	topic, ok := params["topic"].(string)
	topic = strings.TrimSpace(topic)
	if !ok || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	limit := jsonInt(params["limit"], 32)
	if limit < 1 {
		limit = 32
	}
	if limit > maxPeekMessages {
		limit = maxPeekMessages
	}
	now := time.Now().UnixMilli()
	begin := int64(jsonInt(params["beginTimestamp"], int(now-24*time.Hour.Milliseconds())))
	end := int64(jsonInt(params["endTimestamp"], int(now)))
	if begin < 0 || end < begin || end-now > time.Hour.Milliseconds() || end-begin > 31*24*time.Hour.Milliseconds() {
		return nil, fmt.Errorf("message query time range is invalid or exceeds 31 days")
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	messages, err := client.QueryMessageByTime(ctx, topic, begin, end, limit)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		if message != nil {
			rows = append(rows, rocketMqMessageResult(message))
		}
	}
	return map[string]any{"topic": topic, "beginTimestamp": begin, "endTimestamp": end, "messages": rows}, nil
}

// listConsumerGroups mirrors DBX's cluster-wide group listing. The admin
// library exposes subscription groups per broker, so merge every master before
// paginating; querying only the first broker silently loses groups in clusters.
func (a *rocketMQAgent) listConsumerGroups(params map[string]any) (any, error) {
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
	groups := map[string]struct{}{}
	for _, broker := range masterBrokerAddresses(info) {
		entries, fetchErr := client.GetAllSubscriptionGroup(ctx, broker)
		if fetchErr != nil {
			return nil, fetchErr
		}
		for name := range entries {
			groups[name] = struct{}{}
		}
	}
	keyword, _ := params["keyword"].(string)
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	items := make([]string, 0, len(groups))
	for name := range groups {
		if keyword == "" || strings.Contains(strings.ToLower(name), keyword) {
			items = append(items, name)
		}
	}
	sort.Strings(items)
	offset := jsonInt(params["offset"], 0)
	limit := jsonInt(params["limit"], 200)
	if offset < 0 {
		offset = 0
	}
	if limit < 1 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	end := offset + limit
	if offset > len(items) {
		offset = len(items)
	}
	if end > len(items) {
		end = len(items)
	}
	page := items[offset:end]
	rows := make([]map[string]any, 0, len(page))
	for _, group := range page {
		rows = append(rows, map[string]any{"groupId": group, "state": "UNKNOWN", "simpleGroup": false, "messageModel": "CLUSTERING"})
	}
	return map[string]any{"groups": rows, "total": len(items), "offset": offset, "limit": limit}, nil
}

// describeConsumerGroup returns live consumer membership and subscriptions.
// This deliberately does not infer members from subscription-group metadata:
// that metadata exists even when no consumer process is currently connected.
func (a *rocketMQAgent) describeConsumerGroup(params map[string]any) (any, error) {
	groupID, ok := params["groupId"].(string)
	groupID = strings.TrimSpace(groupID)
	if !ok || groupID == "" {
		return nil, fmt.Errorf("groupId is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	connection, err := client.ExamineConsumerConnectionInfo(ctx, groupID)
	if err != nil {
		return nil, err
	}
	assignments := consumerAssignments(connection)
	members := make([]map[string]any, 0, len(connection.ConnectionSet))
	for _, member := range connection.ConnectionSet {
		if member == nil {
			continue
		}
		members = append(members, map[string]any{
			"memberId":    member.ClientId,
			"clientId":    member.ClientId,
			"host":        member.ClientAddr,
			"language":    member.Language,
			"version":     member.Version,
			"assignments": assignments,
		})
	}
	sort.Slice(members, func(left, right int) bool {
		return fmt.Sprint(members[left]["memberId"]) < fmt.Sprint(members[right]["memberId"])
	})
	return map[string]any{
		"groupId":          groupID,
		"state":            valueOrDefault(connection.ConsumeType, "UNKNOWN"),
		"messageModel":     emptyToNil(connection.MessageModel),
		"consumeFromWhere": emptyToNil(connection.ConsumeFromWhere),
		"members":          members,
		"assignments":      assignments,
	}, nil
}

// getConsumerLag is a read-only snapshot of one group and topic. The topic is
// mandatory: it avoids an unbounded cross-cluster stats response and makes the
// displayed offsets unambiguous when a group consumes multiple topics.
func (a *rocketMQAgent) getConsumerLag(params map[string]any) (any, error) {
	groupID, groupOK := params["groupId"].(string)
	topic, topicOK := params["topic"].(string)
	groupID, topic = strings.TrimSpace(groupID), strings.TrimSpace(topic)
	if !groupOK || groupID == "" {
		return nil, fmt.Errorf("groupId is required")
	}
	if !topicOK || topic == "" {
		return nil, fmt.Errorf("topic is required")
	}
	client, config, err := a.connected()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	stats, err := client.ExamineConsumeStatsByTopic(ctx, groupID, topic)
	if err != nil {
		return nil, err
	}
	if len(stats.OffsetTable) > maxLagPartitions {
		return nil, fmt.Errorf("consumer lag has %d partitions; limit is %d", len(stats.OffsetTable), maxLagPartitions)
	}
	partitions := make([]map[string]any, 0, len(stats.OffsetTable))
	var totalLag int64
	for key, offset := range stats.OffsetTable {
		if offset == nil {
			continue
		}
		queue := parseMessageQueueKey(key)
		lag := offset.BrokerOffset - offset.ConsumerOffset
		if lag < 0 {
			lag = 0
		}
		totalLag += lag
		partitions = append(partitions, map[string]any{
			"brokerName":    queue.BrokerName,
			"partition":     queue.QueueID,
			"currentOffset": offset.ConsumerOffset,
			"endOffset":     offset.BrokerOffset,
			"lag":           lag,
			"lastTimestamp": offset.LastTimestamp,
		})
	}
	sort.Slice(partitions, func(left, right int) bool {
		if partitions[left]["brokerName"].(string) != partitions[right]["brokerName"].(string) {
			return partitions[left]["brokerName"].(string) < partitions[right]["brokerName"].(string)
		}
		return partitions[left]["partition"].(int) < partitions[right]["partition"].(int)
	})
	return map[string]any{
		"groupId": groupID, "topic": topic, "partitions": partitions, "totalLag": totalLag,
	}, nil
}

func consumerAssignments(connection *admin.ConsumerConnection) []map[string]any {
	if connection == nil {
		return []map[string]any{}
	}
	topics := sortedKeys(connection.SubscriptionTable)
	assignments := make([]map[string]any, 0, len(topics))
	for _, topic := range topics {
		subscription := connection.SubscriptionTable[topic]
		if subscription == nil {
			continue
		}
		assignments = append(assignments, map[string]any{
			"topic":          valueOrDefault(subscription.Topic, topic),
			"subExpression":  subscription.SubString,
			"expressionType": subscription.ExpressionType,
		})
	}
	return assignments
}

func masterBrokerAddresses(info *admin.ClusterInfo) []string {
	addresses := map[string]struct{}{}
	if info != nil {
		for _, broker := range info.BrokerAddrTable {
			if broker != nil && broker.BrokerAddrs["0"] != "" {
				addresses[broker.BrokerAddrs["0"]] = struct{}{}
			}
		}
	}
	items := make([]string, 0, len(addresses))
	for address := range addresses {
		items = append(items, address)
	}
	sort.Strings(items)
	return items
}

func masterBrokerAddressByName(info *admin.ClusterInfo) map[string]string {
	masters := map[string]string{}
	if info == nil {
		return masters
	}
	for brokerName, broker := range info.BrokerAddrTable {
		if broker != nil && broker.BrokerAddrs["0"] != "" {
			masters[brokerName] = broker.BrokerAddrs["0"]
		}
	}
	return masters
}

type parsedMessageQueue struct {
	Topic      string `json:"topic"`
	BrokerName string `json:"brokerName"`
	QueueID    int    `json:"queueId"`
}

func parseMessageQueueKey(value string) parsedMessageQueue {
	value = strings.TrimSpace(value)
	var queue parsedMessageQueue
	if strings.HasPrefix(value, "{") && json.Unmarshal([]byte(value), &queue) == nil {
		return queue
	}
	if strings.HasPrefix(value, "MessageQueue [") && strings.HasSuffix(value, "]") {
		for _, field := range strings.Split(strings.TrimSuffix(strings.TrimPrefix(value, "MessageQueue ["), "]"), ",") {
			keyValue := strings.SplitN(strings.TrimSpace(field), "=", 2)
			if len(keyValue) != 2 {
				continue
			}
			switch keyValue[0] {
			case "topic":
				queue.Topic = keyValue[1]
			case "brokerName":
				queue.BrokerName = keyValue[1]
			case "queueId":
				queue.QueueID, _ = strconv.Atoi(keyValue[1])
			}
		}
		return queue
	}
	parts := strings.Split(value, "-")
	if len(parts) >= 3 {
		queueID, _ := strconv.Atoi(parts[len(parts)-1])
		return parsedMessageQueue{Topic: strings.Join(parts[:len(parts)-2], "-"), BrokerName: parts[len(parts)-2], QueueID: queueID}
	}
	return queue
}

func jsonInt(value any, fallback int) int {
	switch item := value.(type) {
	case float64:
		return int(item)
	case json.Number:
		parsed, err := item.Int64()
		if err == nil {
			return int(parsed)
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(item))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func valueOrDefault(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func emptyToNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
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
