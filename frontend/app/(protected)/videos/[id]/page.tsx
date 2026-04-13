import type { Metadata } from "next";
import VideoDetailClient from "./VideoDetailClient";

type Props = {
  params: { id: string };
};

export const metadata: Metadata = {
  title: "Video Detail | RPM Prestige",
};

export default function VideoDetailPage({ params }: Props) {
  const id = Number(params.id);
  return <VideoDetailClient videoId={id} />;
}
