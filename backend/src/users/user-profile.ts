export const USER_ROLES = ['administrator', 'attendant', 'tester'] as const;
export type UserRole = typeof USER_ROLES[number];

export interface UserProfile {
  fullName: string | null;
  email: string | null;
  role: UserRole;
}

export function effectiveRole(user: { isAdmin: boolean; role?: UserRole }): UserRole {
  // A tester must never gain administrative access from an inconsistent flag.
  if (user.role === 'tester') return 'tester';
  return user.isAdmin ? 'administrator' : 'attendant';
}
