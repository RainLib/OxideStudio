package main

import (
	"reflect"
	"strings"
	"testing"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

func TestNormalizeNameServersRejectsURLsAndDeduplicates(t *testing.T) {
	servers, err := normalizeNameServers("127.0.0.1:9876; [2001:db8::1]:9876,127.0.0.1:9876")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"127.0.0.1:9876", "[2001:db8::1]:9876"}
	if !reflect.DeepEqual(servers, want) {
		t.Fatalf("servers = %#v, want %#v", servers, want)
	}
	for _, invalid := range []string{"http://localhost:9876", "localhost", "2001:db8::1:9876", "localhost:0"} {
		if _, err := normalizeNameServers(invalid); err == nil {
			t.Fatalf("expected %q to fail", invalid)
		}
	}
}

func TestParseConnectionUsesNestedAliasesAndTimeout(t *testing.T) {
	config, err := parseConnection(map[string]any{"connection": map[string]any{"namesrvAddr": "broker.example:9876", "connectTimeoutMs": float64(1250)}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(config.NameServers, []string{"broker.example:9876"}) || config.Timeout != 1250*time.Millisecond {
		t.Fatalf("config = %#v", config)
	}
}

func TestParseConnectionBindsAclCredentialsTogether(t *testing.T) {
	_, err := parseConnection(map[string]any{"namesrvAddr": "broker.example:9876", "accessKey": "access"})
	if err == nil {
		t.Fatal("expected incomplete ACL credentials to fail")
	}
	config, err := parseConnection(map[string]any{"namesrvAddr": "broker.example:9876", "accessKey": "access", "secretKey": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if config.AccessKey != "access" || config.SecretKey != "secret" {
		t.Fatalf("config = %#v", config)
	}
}

func TestHandshakeDoesNotRequireACluster(t *testing.T) {
	result, err := (&rocketMQAgent{}).dispatch("handshake", nil)
	if err != nil {
		t.Fatal(err)
	}
	value := result.(map[string]any)
	if value["protocolVersion"] != 1 {
		t.Fatalf("unexpected handshake: %#v", value)
	}
}

func TestMasterBrokerAddressesAreSortedAndMasterOnly(t *testing.T) {
	info := &admin.ClusterInfo{BrokerAddrTable: map[string]*admin.BrokerData{
		"a": {BrokerAddrs: map[string]string{"0": "b:10911", "1": "slave:10912"}},
		"b": {BrokerAddrs: map[string]string{"0": "a:10911"}},
	}}
	if got, want := masterBrokerAddresses(info), []string{"a:10911", "b:10911"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("addresses = %#v", got)
	}
}

func TestConsumerAssignmentsAreSortedAndKeepSubscriptionDetails(t *testing.T) {
	assignments := consumerAssignments(&admin.ConsumerConnection{SubscriptionTable: map[string]*admin.SubscriptionData{
		"orders": {Topic: "orders", SubString: "paid || shipped", ExpressionType: "TAG"},
		"audit":  {SubString: "*", ExpressionType: "SQL92"},
	}})
	if len(assignments) != 2 {
		t.Fatalf("assignments = %#v", assignments)
	}
	if assignments[0]["topic"] != "audit" || assignments[1]["topic"] != "orders" {
		t.Fatalf("assignments are not sorted: %#v", assignments)
	}
	if assignments[0]["expressionType"] != "SQL92" {
		t.Fatalf("subscription details were not retained: %#v", assignments[0])
	}
}

func TestTopicRouteResultPreservesPerBrokerQueueCounts(t *testing.T) {
	result := topicRouteResult("orders", &admin.TopicRouteData{
		QueueDatas: []*admin.QueueData{
			{BrokerName: "broker-b", ReadQueueNums: 8, WriteQueueNums: 6, Perm: 6},
			{BrokerName: "broker-a", ReadQueueNums: 4, WriteQueueNums: 4, Perm: 6},
		},
	})
	queues := result["queueDatas"].([]map[string]any)
	if queues[0]["brokerName"] != "broker-a" || queues[1]["writeQueueNums"] != 6 {
		t.Fatalf("route result = %#v", result)
	}
}

func TestMessagePreviewBoundsAndEncodesPayload(t *testing.T) {
	message := &admin.MessageExt{
		Topic: "orders", QueueId: 2, QueueOffset: 8, MsgId: "id-1",
		Body:       []byte(strings.Repeat("x", maxMessageBodyBytes+1)),
		Properties: map[string]string{"KEYS": "order-1", "TAGS": "paid"},
	}
	result := rocketMqMessageResult(message)
	if result["payloadTruncated"] != true || result["key"] != "order-1" || result["tag"] != "paid" {
		t.Fatalf("message result = %#v", result)
	}
	if len(result["payloadText"].(string)) != maxMessageBodyBytes {
		t.Fatalf("payload was not bounded")
	}
}
