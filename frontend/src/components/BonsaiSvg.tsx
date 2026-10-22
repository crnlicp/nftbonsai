import { useState } from "react";
import { nftImageUrl } from "../lib/env";

interface Props {
  nftId: bigint;
  alt?: string;
}

export function BonsaiSvg({ nftId, alt = "generative pixel-art bonsai" }: Props) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const source = nftImageUrl(nftId);
  if (failed) return (
    <div role="alert" className="aspect-square p-4 text-sm text-red-200">
      Could not load the certified NFT image.
      <button className="btn-ghost mt-2" onClick={() => { setFailed(false); setRetry((n) => n + 1); }}>Retry image</button>
    </div>
  );
  return <img key={retry} src={`${source}${retry ? `?retry=${retry}` : ""}`} alt={alt}
    onError={() => setFailed(true)}
    className="pixelated aspect-square object-contain w-full" />;
}
