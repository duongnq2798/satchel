import { DaoBoardSkeleton } from "@/components/dao-skeleton";

/** Shown at once on a navigation to a DAO's board, until the board itself renders. */
export default function DaoBoardLoading() {
  return (
    <div data-loading="route">
      <DaoBoardSkeleton />
    </div>
  );
}
