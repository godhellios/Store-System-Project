import { blockViewer, blockOperator } from "@/lib/role-guard";

export default async function ImportLayout({ children }: { children: React.ReactNode }) {
  await blockViewer();
  await blockOperator();
  return <>{children}</>;
}
