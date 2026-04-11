import MeetingRunner from "../MeetingRunner";

export default function L10MeetingPage({ params }: { params: { id: string } }) {
  return <MeetingRunner meetingId={params.id} />;
}
