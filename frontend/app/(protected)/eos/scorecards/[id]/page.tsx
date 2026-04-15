import IndividualScorecardClient from "./IndividualScorecardClient";

export default function IndividualScorecardPage({ params }: { params: { id: string } }) {
  return <IndividualScorecardClient scorecardId={params.id} />;
}
