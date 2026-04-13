import type { Metadata } from "next";
import VideosClient from "./VideosClient";

export const metadata: Metadata = {
  title: "Video Messages | RPM Prestige",
  description: "Record and share internal async video updates with transcription.",
};

export default function VideosPage() {
  return <VideosClient />;
}
