import { useState } from "react";
import { nftImageUrl } from "../lib/env";

interface Props {
  nftId: bigint;
  alt?: string;
  onClick?: () => void;
}

export function BonsaiSvg({ nftId, alt = "generative pixel-art bonsai", onClick }: Props) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const source = nftImageUrl(nftId);
  if (failed) return (
    <div role="alert" className="aspect-square p-4 text-sm text-red-200">
      Could not load the certified NFT image.
      <button className="btn-ghost mt-2" onClick={() => { setFailed(false); setRetry((n) => n + 1); }}>Retry image</button>
    </div>
  );
  const image = <img key={retry} src={`${source}${retry ? `?retry=${retry}` : ""}`} alt={alt}
    onError={() => setFailed(true)}
    className="pixelated aspect-square object-contain w-full" />;
  return onClick ? (
    <button type="button" aria-label={`View details for Bonsai #${nftId}`} aria-haspopup="dialog"
      className="block w-full rounded-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss-300"
      onClick={onClick}>
      {image}
    </button>
  ) : image;
}
