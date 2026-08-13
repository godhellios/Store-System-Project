// Shared copy for the "approving behind a completed stock count" confirmation.
//
// Three surfaces can approve an order (order detail, pending list, adjustment
// page). The wording lives here so all three ask the same question — the admin
// is the only one who knows whether the goods were physically on the shelf when
// the count happened, and the two answers lead to opposite actions.

export function opnameOverrideMessage(dateLabel: string): string {
  return [
    `This order is dated BEFORE the stock count completed on ${dateLabel}.`,
    "",
    `• Were the goods already missing when you counted? Press Cancel and reject this instead — your count already includes the loss, and approving would subtract it twice.`,
    "",
    `• Were they still on the shelf, and the problem found afterwards? Press OK to approve. The order is re-dated to today so your completed count stays correct.`,
  ].join("\n");
}
