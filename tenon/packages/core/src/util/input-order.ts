const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Returns `output` with the keys of every plain object ordered as they appear
 * in `input`; keys the input does not have follow in their decoded order.
 *
 * Effect 4.1 dropped the `propertyOrder: "original"` parse option and always
 * emits declared struct fields before index-signature keys. Config keys such
 * as permission rules are ordered by precedence, so decoders that relied on
 * that option restore the user's order with this.
 */
export function withInputOrder<A>(input: unknown, output: A): A {
  if (Array.isArray(input) && Array.isArray(output))
    return output.map((item, index) => withInputOrder(input[index], item)) as A
  if (!isPlainObject(input) || !isPlainObject(output)) return output
  const ordered: Record<string, unknown> = {}
  // defineProperty keeps a "__proto__" config key an own property.
  const set = (key: string, value: unknown) =>
    Object.defineProperty(ordered, key, { value, enumerable: true, writable: true, configurable: true })
  for (const key of Object.keys(input)) {
    if (Object.hasOwn(output, key)) set(key, withInputOrder(input[key], output[key]))
  }
  for (const key of Object.keys(output)) {
    if (!Object.hasOwn(ordered, key)) set(key, output[key])
  }
  return ordered as A
}
