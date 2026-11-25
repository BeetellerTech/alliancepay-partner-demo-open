export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public requestId?: string | null) { super(message); }
}
// Core may wrap an internal failure as HTTP 400 / ER001. It does not prove
// that a reserved payment or link was rolled back, unlike a validation error.
export function isGenericUpstreamFailure(error: unknown): boolean {
  const details = error instanceof AppError ? error.details as { errors?: { code?: string }[] } | undefined : undefined;
  return Array.isArray(details?.errors) && details.errors.some(item => item?.code === "ER001");
}
export function safeData(value: any): any {
  if (Array.isArray(value)) return value.map(safeData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(authorization|access_token|refresh_token|client_id|client_secret|security_code|cvv|pan|number|document|email|phone|owner_cpf|partner_phone|billing_address|payer|customer|card)$/i.test(key)
  ).map(([key, item]) => [key, safeData(item)]));
}
