import { TokenSkeleton } from "@/components/token-skeleton";

/** Shown at once on a navigation to a satchel's page, until the page itself renders. */
export default function TokenLoading() {
  return (
    <div data-loading="route">
      <TokenSkeleton />
    </div>
  );
}
