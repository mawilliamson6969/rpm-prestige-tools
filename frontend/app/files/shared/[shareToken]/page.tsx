import type { Metadata } from "next";
import SharedFileClient from "./SharedFileClient";

type Props = { params: { shareToken: string } };

export const metadata: Metadata = {
  title: "Shared File | RPM Prestige",
  description: "Download a shared document from RPM Prestige.",
};

export default function SharedFilePage({ params }: Props) {
  return <SharedFileClient shareToken={params.shareToken} />;
}
