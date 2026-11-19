import ExecutiveBoardroomApp from "@/components/ExecutiveBoardroomApp";
import { getExecutiveProfiles } from "@/lib/executive-profile-store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <ExecutiveBoardroomApp initialProfiles={getExecutiveProfiles()} />;
}
