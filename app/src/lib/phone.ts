/** Phone number helpers: validate and format US numbers. */

/** Strip everything except digits. */
export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * A phone number is valid if it's empty (optional) or contains 10 digits,
 * optionally with a leading US country code 1.
 */
export function isValidPhone(phone: string): boolean {
  const d = digitsOnly(phone);
  if (d === '') return true;
  if (d.length === 10) return true;
  if (d.length === 11 && d.startsWith('1')) return true;
  return false;
}

/** Format as (XXX) XXX-XXXX. Returns the original string if it isn't 10/11 digits. */
export function formatPhone(phone: string): string {
  let d = digitsOnly(phone);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return phone;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export const PHONE_HINT = '10 digits, e.g. (954) 555-0123';
