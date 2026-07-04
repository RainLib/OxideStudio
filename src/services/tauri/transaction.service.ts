import { invokeWithInterceptors } from "./client";

export async function beginTransaction(
  connectionId: string,
  transactionId: string,
  schema?: string | null
): Promise<string> {
  return invokeWithInterceptors<string>("begin_transaction", {
    connectionId,
    transactionId,
    schema: schema || null,
  });
}

export async function commitTransaction(
  connectionId: string,
  transactionId: string
): Promise<string> {
  return invokeWithInterceptors<string>("commit_transaction", {
    connectionId,
    transactionId,
  });
}

export async function rollbackTransaction(
  connectionId: string,
  transactionId: string
): Promise<string> {
  return invokeWithInterceptors<string>("rollback_transaction", {
    connectionId,
    transactionId,
  });
}

export const transactionService = {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
};
