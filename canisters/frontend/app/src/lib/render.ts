import type { BonsaiTraits } from "./idl";

export function bonsaiDescription(t: BonsaiTraits): string {
  const styles = ["formal upright", "informal upright", "gnarled", "semi-cascade", "multi-trunk"];
  const colors = ["green", "forest green", "light green", "autumn red", "orange", "gold", "cherry blossom", "violet"];
  return `${styles[t.trunkStyle]} bonsai, ${colors[t.leafColor]} foliage, ${t.branchCount} primary branches`;
}
