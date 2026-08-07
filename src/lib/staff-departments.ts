// Canonical staff functional department taxonomy — shown as checkboxes on
// Settings > Team (writes profiles.departments) and used anywhere that
// needs to match against a user's assigned department(s), e.g. the Email
// Templates department tabs/filter and the Send Email modal's
// default-to-my-department behavior.
//
// This is NOT the same taxonomy as jobs.department / the `departments`
// table (production job-routing categories like "vehicle_wrap",
// "channel_letters" — see 065_add_missing_departments.sql). Two genuinely
// different concepts that happen to share the word "department" in this
// codebase — don't cross-reference them.
export const STAFF_DEPARTMENTS = [
  { value: 'sales', label: 'Sales' },
  { value: 'design', label: 'Design' },
  { value: 'production', label: 'Production' },
  { value: 'installation', label: 'Installation' },
  { value: 'digital', label: 'Digital' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'admin', label: 'Admin' },
  { value: 'csr', label: 'Customer Service' },
  { value: 'warehouse', label: 'Warehouse' },
] as const

export type StaffDepartment = typeof STAFF_DEPARTMENTS[number]['value']
