export function calculateProofDueDate(from: Date): Date {
  const result = new Date(from)
  let businessDaysAdded = 0
  while (businessDaysAdded < 2) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    if (day !== 0 && day !== 6) businessDaysAdded++
  }
  return result
}
