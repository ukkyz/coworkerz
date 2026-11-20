import ExecutiveBoardroomApp from "@/components/ExecutiveBoardroomApp";
import { getRoster } from "@/lib/executive-profile-store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <ExecutiveBoardroomApp initialRoster={getRoster()} />;
}
