import type { Metadata } from "next";
import SharedVideoClient from "./SharedVideoClient";

type Props = {
  params: { token: string };
};

export const metadata: Metadata = {
  title: "Shared Video | RPM Prestige",
  description: "Shared async video message from RPM Prestige.",
};

export default function SharedVideoPage({ params }: Props) {
  return <SharedVideoClient token={params.token} />;
}
