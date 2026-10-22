import Traits "../backend/types";

module {
  public type BonsaiTraits = Traits.BonsaiTraits;
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type NftRecord = {
    id : Nat; var owner : Principal; traits : BonsaiTraits;
    createdAt : Int; paymentId : Text;
  };
  public type NftPublic = {
    id : Nat; owner : Principal; traits : BonsaiTraits;
    createdAt : Int; paymentId : Text;
  };
  public type Value = {
    #Nat : Nat; #Int : Int; #Text : Text; #Blob : Blob;
    #Array : [Value]; #Map : [(Text, Value)];
  };
  public type TransferArg = {
    from_subaccount : ?Blob; to : Account; token_id : Nat;
    memo : ?Blob; created_at_time : ?Nat64;
  };
  public type TransferError = {
    #Unauthorized; #NonExistingTokenId; #InvalidRecipient;
    #GenericError : { error_code : Nat; message : Text };
  };
  public type TransferResult = { #Ok : Nat; #Err : TransferError };
  public type ApprovalInfo = {
    spender : Account; from_subaccount : ?Blob; expires_at : ?Nat64;
    memo : ?Blob; created_at_time : ?Nat64;
  };
  public type ApproveTokenArg = { token_id : Nat; approval_info : ApprovalInfo };
  public type ApproveTokenError = {
    #InvalidSpender; #Unauthorized; #NonExistingTokenId; #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #GenericError : { error_code : Nat; message : Text };
    #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type ApproveTokenResult = { #Ok : Nat; #Err : ApproveTokenError };
  public type ApproveCollectionArg = { approval_info : ApprovalInfo };
  public type ApproveCollectionError = {
    #InvalidSpender; #Unauthorized; #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #GenericError : { error_code : Nat; message : Text };
    #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type ApproveCollectionResult = { #Ok : Nat; #Err : ApproveCollectionError };
  public type RevokeTokenApprovalArg = {
    spender : ?Account; from_subaccount : ?Blob; token_id : Nat;
    memo : ?Blob; created_at_time : ?Nat64;
  };
  public type RevokeTokenApprovalError = {
    #ApprovalDoesNotExist; #Unauthorized; #NonExistingTokenId; #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #GenericError : { error_code : Nat; message : Text };
    #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type RevokeTokenApprovalResult = { #Ok : Nat; #Err : RevokeTokenApprovalError };
  public type RevokeCollectionApprovalArg = {
    spender : ?Account; from_subaccount : ?Blob; memo : ?Blob; created_at_time : ?Nat64;
  };
  public type RevokeCollectionApprovalError = {
    #ApprovalDoesNotExist; #Unauthorized; #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #GenericError : { error_code : Nat; message : Text };
    #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type RevokeCollectionApprovalResult = { #Ok : Nat; #Err : RevokeCollectionApprovalError };
  public type IsApprovedArg = { spender : Account; from_subaccount : ?Blob; token_id : Nat };
  public type TokenApproval = { token_id : Nat; approval_info : ApprovalInfo };
  public type CollectionApproval = ApprovalInfo;
  public type TransferFromArg = {
    spender_subaccount : ?Blob; from : Account; to : Account; token_id : Nat;
    memo : ?Blob; created_at_time : ?Nat64;
  };
  public type TransferFromError = {
    #InvalidRecipient; #Unauthorized; #NonExistingTokenId; #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #GenericError : { error_code : Nat; message : Text };
    #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type TransferFromResult = { #Ok : Nat; #Err : TransferFromError };
  public type ApprovalRecord = { spender : Account; expiresAt : ?Nat64; createdAt : Nat64 };
  public type GetBlocksArgs = [{ start : Nat; length : Nat }];
  public type GetBlocksResult = {
    log_length : Nat; blocks : [{ id : Nat; block : Value }];
    archived_blocks : [{ args : GetBlocksArgs; callback : shared query (GetBlocksArgs) -> async GetBlocksResult }];
  };
  public type GetArchivesArgs = { from : ?Principal };
  public type ArchiveInfo = { canister_id : Principal; start : Nat; end : Nat };
  public type DataCertificate = { certificate : Blob; hash_tree : Blob };
  public type HeaderField = (Text, Text);
  public type HttpRequest = { method : Text; url : Text; headers : [HeaderField]; body : Blob };
  public type HttpResponse = { status_code : Nat16; headers : [HeaderField]; body : Blob };
}
