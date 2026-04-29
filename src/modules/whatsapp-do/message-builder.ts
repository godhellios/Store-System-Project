export type DOMessageData = {
  orderNumber: string;
  date: string;
  fromLocation?: string | null;
  lines: Array<{
    productName: string;
    quantity: number;
    unit: string;
    inputQty?: number | null;
    inputUnit?: string | null;
  }>;
};

export function buildDOMessage(order: DOMessageData): string {
  const itemLines = order.lines.map((l) => {
    const qty = l.inputQty ?? l.quantity;
    const unit = l.inputQty ? (l.inputUnit ?? l.unit) : l.unit;
    return `• ${l.productName} × ${qty} ${unit}`;
  });

  const totalBase = order.lines.reduce((s, l) => s + l.quantity, 0);

  return [
    `🚚 *Delivery Order*`,
    `No: ${order.orderNumber}`,
    `Date: ${order.date}`,
    ...(order.fromLocation ? [`From: ${order.fromLocation}`] : []),
    ``,
    `*Items (${order.lines.length}):*`,
    ...itemLines,
    ``,
    `Total: ${totalBase} base units`,
    `_MRIs – Mitra Ramah Inventory System_`,
  ].join("\n");
}
