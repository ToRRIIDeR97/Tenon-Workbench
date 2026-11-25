const SECRET_KEY =
  /^(api[-_]?key|key|token|access[-_]?token|refresh[-_]?token|secret|client[-_]?secret|password|authorization|headers|environment)$/i

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => (SECRET_KEY.test(key) ? [] : [[key, redactSecrets(item)]])),
  ) as T
}
