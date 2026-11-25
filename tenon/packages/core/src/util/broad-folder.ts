import path from "path"

export function isBroadFolder(directory: string, home: string) {
  const windows = /^[A-Za-z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
  const resolve = windows ? path.win32.resolve : path.posix.resolve
  const parse = windows ? path.win32.parse : path.posix.parse
  const target = resolve(directory)
  const compare = (value: string) => (windows ? value.toLowerCase() : value)
  return compare(target) === compare(parse(target).root) || compare(target) === compare(resolve(home))
}
