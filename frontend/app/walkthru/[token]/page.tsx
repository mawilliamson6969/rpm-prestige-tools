import type { Metadata } from "next";
import WalkthruPublicForm from "./WalkthruPublicForm";

export const metadata: Metadata = {
  title: "Walk-Thru Report | RPM Prestige",
  description: "Tenant move-in / move-out inventory and condition report.",
};

export default function WalkthruPublicPage({ params }: { params: { token: string } }) {
  return <WalkthruPublicForm token={params.token} />;
}
