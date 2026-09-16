export const ELASTICSEARCH_CONSOLE_LANGUAGE_ID = "elasticsearch-console";

export const ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS = Array.from(
  new Set(
    ' /{[,\".:_@$-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(
      "",
    ),
  ),
);

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
] as const;
