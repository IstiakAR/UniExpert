export function asString(value) {
  return typeof value === 'string' ? value : ''
}

export function parseId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const raw = String(value)
  if (!/^[1-9]\d{0,11}$/.test(raw)) return null

  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}
