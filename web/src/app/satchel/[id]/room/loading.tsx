import { RoomSkeleton } from "@/components/room-intro";

/** Shown at once on a navigation to a holder room, until the room itself renders. */
export default function RoomLoading() {
  return (
    <div data-loading="route">
      <RoomSkeleton />
    </div>
  );
}
