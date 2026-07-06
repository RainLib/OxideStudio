import type {
  AiDocumentMutationInput,
  AiKeyValueMutationInput,
  AiSearchDocumentMutationInput,
} from "./types";

export function buildMongoMutationCommand(
  input: AiDocumentMutationInput,
  namespace: string
) {
  const base = {
    ...(namespace ? { database: namespace } : {}),
    collection: input.collection,
  };

  if (input.operation === "insert") {
    if (!input.documents?.length) {
      throw new Error("documents is required");
    }
    return {
      ...base,
      insertMany: input.documents,
    };
  }

  if (input.operation === "update") {
    if (!input.filter || !input.update) {
      throw new Error("filter and update are required");
    }
    return {
      ...base,
      [input.many ? "updateMany" : "updateOne"]: {
        filter: input.filter,
        update: input.update,
        upsert: input.upsert ?? false,
      },
    };
  }

  if (!input.filter) {
    throw new Error("filter is required");
  }
  return {
    ...base,
    [input.many ? "deleteMany" : "deleteOne"]: input.filter,
  };
}

export function buildRedisMutationCommand(input: AiKeyValueMutationInput) {
  if (input.operation === "set") {
    const key = input.key?.trim();
    if (!key) {
      throw new Error("key is required");
    }
    const value = redisValueLiteral(input.value);
    const parts = ["SET", redisArg(key), redisArg(value)];
    if (input.ttlSeconds) {
      parts.push("EX", String(input.ttlSeconds));
    }
    return parts.join(" ");
  }

  const keys = input.keys?.map((key) => key.trim()).filter(Boolean) ?? [];
  if (keys.length === 0) {
    throw new Error("keys is required");
  }
  return ["DEL", ...keys.map(redisArg)].join(" ");
}

export function buildRedisGetCommand(key: string) {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error("key is required");
  }
  return `GET ${redisArg(trimmed)}`;
}

export function buildElasticsearchMutationRequest(
  input: AiSearchDocumentMutationInput
) {
  const index = pathSegment(input.index);
  const id = input.id?.trim() || null;

  if (input.operation === "index") {
    if (!input.document) {
      throw new Error("document is required");
    }
    const body = JSON.stringify(input.document);
    if (id) {
      return `PUT /${index}/_doc/${pathSegment(id)}\n${body}`;
    }
    return `POST /${index}/_doc\n${body}`;
  }

  if (!id) {
    throw new Error("id is required");
  }

  if (input.operation === "update") {
    if (!input.document) {
      throw new Error("document is required");
    }
    return [
      `POST /${index}/_update/${pathSegment(id)}`,
      JSON.stringify({
        doc: input.document,
        ...(input.upsert ? { doc_as_upsert: true } : {}),
      }),
    ].join("\n");
  }

  return `DELETE /${index}/_doc/${pathSegment(id)}`;
}

function redisValueLiteral(value: unknown) {
  if (value === undefined) {
    throw new Error("value is required");
  }
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("value is not serializable");
  }
  return serialized;
}

function redisArg(value: string) {
  return /^[^\s"'\\;#]+$/.test(value) ? value : JSON.stringify(value);
}

function pathSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("path segment is required");
  }
  return encodeURIComponent(trimmed);
}
