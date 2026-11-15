import type { GoogleAccount, MailAccount } from "@/context/platform"

/**
 * One row per Google address: its Gmail mail account and its Calendar connection, matched by address, so the
 * Accounts page shows one account with a switch for each. Calendar-only accounts get a row too.
 */
export function googleAccountRows(mail: ReadonlyArray<MailAccount>, calendar: ReadonlyArray<GoogleAccount>) {
  const key = (address: string | undefined) => address?.trim().toLowerCase()
  const gmail = mail.filter((account) => account.provider === "gmail")
  const rows = gmail.map((account) => ({
    address: account.address,
    mail: account,
    calendar: calendar.find((item) => key(item.email) === key(account.address)),
  }))
  const extra = calendar
    .filter((item) => !gmail.some((account) => key(account.address) === key(item.email)))
    .map((item) => ({ address: item.email ?? item.label, mail: undefined, calendar: item }))
  return [...rows, ...extra]
}
