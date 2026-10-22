/// Shared types for the NFT Bonsai backend canister.
///
/// Public/shared fields use only Candid-serializable types (no `var`, no
/// non-shared containers). Internal collection state lives in `main.mo`.

module {

  // 13 traits, each a small enum encoded as Nat8 to keep the payload tiny.
  // The cardinality of each trait MUST match the constants in
  // `backend/lib/Bonsai.mo` and the renderer in `frontend/src/lib/render.ts`.
  public type BonsaiTraits = {
    trunkStyle : Nat8;      // 0..4   (5)
    branchCount : Nat8;     // 3..7   (5)
    leafColor : Nat8;       // 0..7   (8)
    leafDensity : Nat8;     // 0..2   (3)
    potStyle : Nat8;        // 0..5   (6)
    potColor : Nat8;        // 0..7   (8)
    ground : Nat8;          // 0..4   (5)
    season : Nat8;          // 0..3   (4)
    sky : Nat8;             // 0..5   (6)
    moonPhase : Nat8;       // 0..8   (9)
    specialElem : Nat8;     // 0..7   (8)
    trunkThick : Nat8;      // 0..2   (3)
    trunkColor : Nat8;      // 0..4   (5)
  };

}
