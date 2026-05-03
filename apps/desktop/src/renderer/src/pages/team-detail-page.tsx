import { useParams } from "react-router-dom";
import { TeamDetailPage as TeamDetailView } from "@multica/views/teams";

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <TeamDetailView teamId={id} />;
}
